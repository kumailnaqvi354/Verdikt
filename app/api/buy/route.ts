import { NextResponse } from "next/server";
import { buy, getSpendingTracker } from "@/lib/paidapi/buyer";

export const dynamic = "force-dynamic";

// The server-side agent buys from this app's own paid API. The URL is fixed
// (not taken from the request) so nobody can make your agent pay other sites.

export async function GET() {
  try {
    return NextResponse.json({ spending: getSpendingTracker().snapshot() });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const target = new URL("/api/premium", request.url).toString();
  try {
    return NextResponse.json(await buy(target));
  } catch (err) {
    console.error("Purchase failed:", err);
    return NextResponse.json(
      { error: errorMessage(err), spending: safeSnapshot() },
      { status: 400 },
    );
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function safeSnapshot() {
  try {
    return getSpendingTracker().snapshot();
  } catch {
    return null;
  }
}
