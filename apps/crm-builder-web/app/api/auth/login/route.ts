import { NextResponse } from "next/server";
import { applySessionCookie } from "@/lib/auth";
import { addAuditLog, createSessionWithContext, findCompanyById, findUserByCredentials, findActiveUserByEmail, verifyUserPin } from "@/lib/store";
import { recordDayCheckIn } from "@/lib/checkin";
import { createPreAuthToken, verifyTotp } from "@/lib/mfa";
import { clearAuthRateLimit, consumeAuthRateLimit } from "@/lib/auth-rate-limit";
import { isValidEmail, normalizeEmail } from "@/lib/validation";
import { dailyCodeLoginEnabled, verifyTodayCode, endOfPacificDayISO } from "@/lib/daily-code";

export async function POST(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  const ipAddress = forwarded.split(",")[0]?.trim() || "";
  const userAgent = request.headers.get("user-agent") || "";
  const body = await request.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  const password = String(body.password ?? "");
  const mfaCode = String(body.mfaCode ?? "").trim();
  // Passwordless morning check-in (CHECKIN_PIN_LOGIN): today's office code + the
  // person's own PIN. These come as separate fields; the rest of the flow is
  // unchanged and the owner's real password still works.
  const checkinCode = String(body.code ?? "").trim();
  const checkinPin = String(body.pin ?? "").trim();
  const checkinMode = String(process.env.CHECKIN_PIN_LOGIN || "").toLowerCase() === "true" && Boolean(checkinCode);

  if (!email || (!password && !checkinMode)) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Invalid email format." }, { status: 400 });
  }

  const limiterKey = `auth:login:${email}:${ipAddress || "unknown"}`;
  try {
    const limitCheck = await consumeAuthRateLimit({
      key: limiterKey,
      maxAttempts: Number(process.env.AUTH_LOGIN_MAX_ATTEMPTS || 8),
      windowSeconds: Number(process.env.AUTH_LOGIN_WINDOW_SECONDS || 300)
    });
    if (!limitCheck.allowed) {
      const response = NextResponse.json(
        { error: "Too many login attempts. Please retry shortly." },
        { status: 429 }
      );
      if (limitCheck.retryAfterSeconds) {
        response.headers.set("Retry-After", String(limitCheck.retryAfterSeconds));
      }
      return response;
    }
  } catch {
    // Keep authentication available even if rate-limit persistence is unavailable.
  }

  // Primary path: email + password (unchanged).
  let user = await findUserByCredentials(email, password);

  // Daily-code path (only when DAILY_CODE_LOGIN=true): if the password didn't
  // match, accept today's shared office code in its place. The user is still
  // identified by their own email, so per-user identity is preserved. The
  // owner's real password always works above, so a missed/late code email can
  // never lock the office out.
  let codeUsed = false;
  let mustSetPin = false;
  if (!user && dailyCodeLoginEnabled()) {
    const candidate = await findActiveUserByEmail(email);
    if (candidate && (await verifyTodayCode(password))) {
      user = candidate;
      codeUsed = true;
    }
  }

  // Passwordless check-in path (CHECKIN_PIN_LOGIN): today's office code + the
  // person's own PIN. First time (no PIN set yet) we accept just the valid code
  // and flag the UI to make them set a PIN. The owner's password path above is
  // untouched, so no one is ever locked out.
  if (!user && checkinMode) {
    const candidate = await findActiveUserByEmail(email);
    if (candidate && (await verifyTodayCode(checkinCode))) {
      if (candidate.pinHash) {
        if (await verifyUserPin(candidate.id, checkinPin)) {
          user = candidate;
          codeUsed = true;
        }
      } else {
        // No PIN yet — let them in on the valid code and force PIN setup.
        user = candidate;
        codeUsed = true;
        mustSetPin = true;
      }
    }
  }

  // Authenticator-app path (MFA_PASSWORDLESS): staff log in with their email and
  // the 6-digit code from their authenticator app IN PLACE of a password — one
  // login in the morning, and the session lasts the Pacific day (set below).
  // The owner's real password still works above, so nobody is ever locked out.
  if (!user && String(process.env.MFA_PASSWORDLESS || "").toLowerCase() === "true") {
    const candidate = await findActiveUserByEmail(email);
    if (
      candidate &&
      candidate.mfaEnabled &&
      String(candidate.mfaSecret || "").trim() &&
      verifyTotp(String(candidate.mfaSecret), password, { window: 1 })
    ) {
      user = candidate;
      codeUsed = true; // end-of-day session + skip the separate MFA step
    }
  }

  if (!user) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  const forceStaffMfa =
    String(process.env.FORCE_STAFF_MFA || (process.env.NODE_ENV === "production" ? "true" : "false")).toLowerCase() ===
    "true";
  const isStaff = user.userType === "staff";
  // When the daily office code was used, it IS the access control for the day —
  // don't additionally demand a TOTP code.
  if (isStaff && forceStaffMfa && !codeUsed) {
    if (!user.mfaEnabled || !String(user.mfaSecret || "").trim()) {
      const preAuthToken = createPreAuthToken({
        userId: user.id,
        companyId: user.companyId,
        purpose: "mfa_setup",
        ttlSeconds: 15 * 60
      });
      return NextResponse.json(
        {
          error: "MFA setup required.",
          mfaSetupRequired: true,
          preAuthToken
        },
        { status: 403 }
      );
    }

    if (!mfaCode) {
      const preAuthToken = createPreAuthToken({
        userId: user.id,
        companyId: user.companyId,
        purpose: "mfa_login",
        ttlSeconds: 10 * 60
      });
      return NextResponse.json(
        {
          error: "MFA code required.",
          mfaRequired: true,
          preAuthToken
        },
        { status: 401 }
      );
    }

    const ok = verifyTotp(String(user.mfaSecret || ""), mfaCode, { window: 1 });
    if (!ok) {
      await addAuditLog({
        companyId: user.companyId,
        actorUserId: user.id,
        actorName: user.name,
        action: "auth.mfa.failed",
        resourceType: "user",
        resourceId: user.id,
        metadata: {
          email: user.email,
          ipAddress: ipAddress || "unknown"
        }
      });
      return NextResponse.json({ error: "Invalid MFA code." }, { status: 401 });
    }
  }

  // Daily-code logins expire at the end of the Pacific day, so a fresh code is
  // required tomorrow. Password logins keep the normal rolling session.
  const session = await createSessionWithContext(user, {
    ipAddress,
    userAgent,
    expiresAt: codeUsed ? endOfPacificDayISO() : undefined,
  });
  try {
    await clearAuthRateLimit(limiterKey);
  } catch {
    // Ignore clear failures if auth rate-limit table is unavailable.
  }
  // Morning attendance — stamp the day check-in for any staff login (first of
  // the day wins). Non-fatal so it can never block a login.
  if (user.userType === "staff") {
    await recordDayCheckIn(user.id, user.name, codeUsed ? "code" : "password").catch(() => {});
  }

  const company = await findCompanyById(user.companyId);
  const response = NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      userType: user.userType
    },
    mustSetPin,
    company
  });

  applySessionCookie(response, session.token);
  try {
    await addAuditLog({
      companyId: user.companyId,
      actorUserId: user.id,
      actorName: user.name,
      action: "auth.login",
      resourceType: "case",
      resourceId: user.id,
      metadata: {
        email: user.email,
        userType: user.userType,
        method: codeUsed ? "daily_code" : "password",
        ipAddress: ipAddress || "unknown"
      }
    });
  } catch {
    // Ignore audit failures to avoid blocking login.
  }

  return response;
}
