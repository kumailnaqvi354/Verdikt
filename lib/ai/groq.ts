import "server-only";

// Groq's API is OpenAI-compatible, so plain fetch is enough (no SDK dependency).
// `server-only` makes the build fail if a client component imports this file,
// so GROQ_API_KEY can never end up in browser JavaScript.

const DEFAULT_MODEL = "openai/gpt-oss-120b";
const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

export class MissingGroqKeyError extends Error {
  constructor() {
    super("GROQ_API_KEY is not set. Add it to .env.local and restart `npm run dev`.");
  }
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One chat completion. Returns the assistant message (text and/or tool calls).
 * Retries a few times on rate limits (429, waiting as Groq suggests) and on a malformed tool call
 * (400 tool_use_failed, e.g. the model calling a tool that doesn't exist), which usually succeeds on retry.
 */
export async function chatGroq(
  messages: ChatMessage[],
  options: { tools?: ToolDefinition[]; json?: boolean; temperature?: number; reasoningEffort?: "low" | "medium" | "high" } = {},
): Promise<{ content: string | null; tool_calls?: ToolCall[] }> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new MissingGroqKeyError();
  const model = process.env.GROQ_MODEL || DEFAULT_MODEL;

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0,
        ...(options.tools?.length ? { tools: options.tools, tool_choice: "auto" } : {}),
        ...(options.json ? { response_format: { type: "json_object" } } : {}),
        // Only gpt-oss models take reasoning_effort; lower effort uses fewer tokens per minute.
        ...(options.reasoningEffort && model.startsWith("openai/gpt-oss") ? { reasoning_effort: options.reasoningEffort } : {}),
      }),
    });
    if (res.ok) {
      const body = (await res.json()) as { choices: { message: { content: string | null; tool_calls?: ToolCall[] } }[] };
      return body.choices[0].message;
    }
    const text = await res.text();
    const retryable = res.status === 429 || (res.status === 400 && text.includes("tool_use_failed"));
    if (!retryable || attempt >= 3) throw new Error(`Groq ${res.status}: ${text.slice(0, 300)}`);
    // Groq says e.g. "Please try again in 712.5ms" or "in 2.3s".
    const hint = /try again in ([\d.]+)(ms|s)/.exec(text);
    const waitMs = hint ? Number(hint[1]) * (hint[2] === "s" ? 1000 : 1) : 1000;
    await sleep(Math.min(waitMs + 250, 8000));
  }
}

export async function askGroq(prompt: string): Promise<string> {
  return (await chatGroq([{ role: "user", content: prompt }])).content ?? "";
}
