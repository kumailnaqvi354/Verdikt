import { NextResponse } from "next/server";
import { handleHealth } from "@/lib/race/adapter";

export const dynamic = "force-dynamic";

// GET /agent-studio/v1/health: the race verifier checks this before every attempt.
export function GET(request: Request) {
  const { status, body } = handleHealth(request.headers.get("authorization"));
  return NextResponse.json(body, { status });
}
