// Diagnostic endpoint removed.
//
// This endpoint was used during debugging on May 2-3 to verify env var
// routing and template approval status. Now that the WABA / template
// configuration is verified working, the endpoint is gone.
//
// Returning 410 Gone (not 404) so any future bug reports referencing this
// path get a clear "this is intentionally removed" rather than thinking
// it's a missing route bug.

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { error: "Endpoint removed", reason: "Diagnostic-only, no longer needed in production" },
    { status: 410 }
  );
}
