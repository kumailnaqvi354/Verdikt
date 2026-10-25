import { LEVELS, runReview, type Level, type ReviewEvent } from "@/lib/verdikt/review";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Streams Agent A's progress as newline-delimited JSON, one ReviewEvent per line,
// so the page can show the plan, each payment and each worker's result as they land.

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { insurer?: string; level?: string };
  const level = body.level as Level;
  if (!body.insurer || !(level in LEVELS)) {
    return Response.json({ error: "Send { insurer, level: low | medium | high }." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: ReviewEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        await runReview(body.insurer!, level, emit);
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
