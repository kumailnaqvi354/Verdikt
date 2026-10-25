import { NextResponse } from "next/server";
import { handleTask } from "@/lib/race/adapter";

export const dynamic = "force-dynamic";
// Workflow tasks can take a while. Raise this if your host allows longer functions.
export const maxDuration = 60;

// POST /agent-studio/v1/tasks: the race verifier sends tasks here. Your logic is in lib/race/handlers.ts.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { status, body: out } = await handleTask(request.headers.get("authorization"), body);
  return NextResponse.json(out, { status });
}
