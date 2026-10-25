import { NextResponse } from "next/server";
import { askGemini, MissingGeminiKeyError } from "@/lib/ai/gemini";

export const dynamic = "force-dynamic";

const MAX_PROMPT_CHARS = 4000;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { prompt?: unknown } | null;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json({ error: "Send JSON like { \"prompt\": \"Hello\" }" }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return NextResponse.json({ error: `Prompt is longer than ${MAX_PROMPT_CHARS} characters` }, { status: 400 });
  }

  try {
    const text = await askGemini(prompt);
    return NextResponse.json({ text });
  } catch (err) {
    if (err instanceof MissingGeminiKeyError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    console.error("Gemini request failed:", err);
    return NextResponse.json({ error: "Gemini request failed. Check the server logs." }, { status: 502 });
  }
}
