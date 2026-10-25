import "server-only";
import { GoogleGenAI } from "@google/genai";

// `server-only` makes the build fail if a client component imports this file,
// so GEMINI_API_KEY can never end up in browser JavaScript.

const DEFAULT_MODEL = "gemini-flash-latest";

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new MissingGeminiKeyError();
  }
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

export class MissingGeminiKeyError extends Error {
  constructor() {
    super("GEMINI_API_KEY is not set. Add it to .env.local and restart `npm run dev`.");
  }
}

export async function askGemini(prompt: string): Promise<string> {
  const response = await getClient().models.generateContent({
    model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
    contents: prompt,
  });
  return response.text ?? "";
}
