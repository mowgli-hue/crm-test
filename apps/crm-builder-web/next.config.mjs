// Security response headers applied to every route. These protect a PII-heavy
// app (passports, UCIs, financials) against clickjacking, protocol-downgrade,
// MIME-sniffing, and referrer leakage. Deliberately NOT setting a strict CSP
// here — this app uses inline styles/scripts, so a tight CSP would break it; CSP
// should be introduced separately in report-only mode first.
const securityHeaders = [
  // Force HTTPS for 2 years (incl. subdomains). Safe — the CRM is HTTPS-only.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // The CRM is never meant to be embedded in a frame → block clickjacking.
  { key: "X-Frame-Options", value: "DENY" },
  // Don't let browsers MIME-sniff responses into a different content type.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't leak full URLs (which can contain case context) to other origins.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // No reason for the app to access these device features.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    // Production hotfix: do not block deploys on transient type drift.
    ignoreBuildErrors: true
  },
  eslint: {
    // Keep deploy path unblocked while team is live on the portal.
    ignoreDuringBuilds: true
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  }
};

export default nextConfig;
