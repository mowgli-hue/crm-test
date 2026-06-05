import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

export async function POST(request: NextRequest) {
  const recoveryToken = String(process.env.AUTH_RECOVERY_TOKEN || "").trim();
  const body = await request.json().catch(() => ({})) as {
    token?: string;
    email?: string;
    password?: string;
    name?: string;
  };

  if (!recoveryToken || body.token !== recoveryToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return NextResponse.json({ error: "No DATABASE_URL" }, { status: 500 });

  const pool = new Pool({
    connectionString: dbUrl,
    max: 3,
    ssl: dbUrl.includes("localhost") ? false : { rejectUnauthorized: false }
  });

  try {
    // Create the snapshot table if it doesn't exist
    await pool.query(`
      create table if not exists app_store_snapshots (
        id text primary key,
        payload jsonb not null,
        updated_at timestamptz not null default now()
      )
    `);

    // Check if store already exists
    const existing = await pool.query(
      "select payload from app_store_snapshots where id = $1 limit 1",
      ["global"]
    );

    const companyId = process.env.DEFAULT_COMPANY_ID || "newton";
    const email = (body.email || "newtonimmigration@gmail.com").toLowerCase().trim();
    // Require an explicit password — never seed a privileged admin with a known
    // hardcoded default ("Newton2024!" was a guessable backdoor).
    const password = String(body.password || "").trim();
    if (password.length < 8) {
      return NextResponse.json({ error: "A password (min 8 chars) is required to bootstrap an admin." }, { status: 400 });
    }
    const name = body.name || "Admin User";

    // Hash password using app security module
    const { hashPassword } = await import("@/lib/security");
    const hashedPassword = await hashPassword(password);

    let store: any;

    if (existing.rowCount && existing.rows[0]?.payload) {
      // Store exists — update or add admin user
      store = existing.rows[0].payload;
      store.users = store.users || [];
      store.companies = store.companies || [];

      // Ensure company exists
      const companyExists = store.companies.find((c: any) => c.id === companyId);
      if (!companyExists) {
        store.companies.push({
          id: companyId,
          name: "Newton Immigration",
          slug: companyId,
          branding: {
            driveRootLink: "https://drive.google.com/drive/folders/1FAjuG-Uj4fhp9zWfVsiHoX8WbVPT_r7j?usp=drive_link"
          },
          createdAt: new Date().toISOString()
        });
      }

      const userIdx = store.users.findIndex((u: any) => u.email?.toLowerCase() === email);
      if (userIdx >= 0) {
        store.users[userIdx].password = hashedPassword;
        store.users[userIdx].active = true;
        store.users[userIdx].mfaEnabled = false;
        store.users[userIdx].mfaSecret = undefined;
      } else {
        store.users.push({
          id: `USR-${Date.now()}`,
          companyId,
          name,
          email,
          role: "Admin",
          userType: "staff",
          active: true,
          password: hashedPassword,
        });
      }
    } else {
      // Fresh store — create everything from scratch
      store = {
        companies: [{
          id: companyId,
          name: "Newton Immigration",
          slug: companyId,
          branding: {
            driveRootLink: "https://drive.google.com/drive/folders/1FAjuG-Uj4fhp9zWfVsiHoX8WbVPT_r7j?usp=drive_link"
          },
          createdAt: new Date().toISOString()
        }],
        users: [{
          id: "USR-1",
          companyId,
          name,
          email,
          role: "Admin",
          userType: "staff",
          active: true,
          password: hashedPassword,
        }],
        cases: [],
        messages: [],
        documents: [],
        tasks: [],
        sessions: [],
        invites: [],
        clients: [],
        outboundMessages: [],
        legacyResults: [],
        notifications: [],
        auditLogs: [],
        docRequests: [],
        clientCommunications: [],
        clientPortalSessions: [],
      };
    }

    // Write store
    await pool.query(
      `insert into app_store_snapshots (id, payload, updated_at)
       values ($1, $2::jsonb, now())
       on conflict (id) do update set payload = excluded.payload, updated_at = now()`,
      ["global", JSON.stringify(store)]
    );

    // Also sync Newton team with correct password
    try {
      const { NEWTON_TEAM_MEMBERS } = await import("@/lib/newton-team");
      const { hashPassword } = await import("@/lib/security");
      const teamPassword = "Newton_123";
      const hashedTeamPw = await hashPassword(teamPassword);

      store.users = store.users || [];
      for (const member of NEWTON_TEAM_MEMBERS) {
        const existingIdx = store.users.findIndex((u: any) => u.email?.toLowerCase() === member.email.toLowerCase());
        if (existingIdx >= 0) {
          // Update role, password and ensure correct companyId
          store.users[existingIdx] = {
            ...store.users[existingIdx],
            companyId,
            role: member.role,
            name: member.name,
            active: true,
            userType: "staff",
            password: hashedTeamPw,
          };
        } else {
          store.users.push({
            id: `USR-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
            companyId,
            name: member.name,
            email: member.email,
            role: member.role,
            userType: "staff",
            active: true,
            password: hashedTeamPw,
            workspaceDriveLink: member.workspaceDriveLink,
          });
        }
      }

      // Save updated store with team
      await pool.query(
        `insert into app_store_snapshots (id, payload, updated_at)
         values ($1, $2::jsonb, now())
         on conflict (id) do update set payload = excluded.payload, updated_at = now()`,
        ["global", JSON.stringify(store)]
      );
    } catch(e) { console.warn("Team sync failed:", e); }

    return NextResponse.json({ 
      ok: true, 
      action: existing.rowCount ? "updated" : "created",
      email,
      teamCreated: true,
      message: `Login: ${email} / ${password} | Team: name@newtonimmigration.com / Newton_123`
    });

  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  } finally {
    await pool.end().catch(() => {});
  }
}
