import { NextResponse } from "next/server";
import { attestClaim, ClaimError, extractClaim, validate } from "@/lib/verdikt/claims";
import { INSURERS } from "@/lib/verdikt/data";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST { action: "extract", letter } → the AI's structured record (nothing is saved).
// POST { action: "attest", claim }   → the confirmed record's hash goes to devnet; the record joins the store.

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { action?: string; letter?: string; claim?: Record<string, unknown> };
  try {
    if (body.action === "extract") {
      const claim = await extractClaim(String(body.letter ?? ""));
      return NextResponse.json({ claim, insurerName: INSURERS.find((i) => i.id === claim.insurerId)?.name });
    }
    if (body.action === "attest") return NextResponse.json({ record: await attestClaim(validate(body.claim ?? {})) });
    return NextResponse.json({ error: 'Send { action: "extract", letter } or { action: "attest", claim }.' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: err instanceof ClaimError ? 400 : 500 });
  }
}
