// Calling the race's tools and knowledge source. The tool service records every call: that record,
// not what you put in toolResults, is how the verifier knows a tool was really used.
import type { Task, ToolSpec } from "./protocol";

export class ToolCallError extends Error {
  constructor(
    readonly tool: string,
    /** HTTP status from the tool, or null if it didn't answer (timeout, network). */
    readonly httpStatus: number | null,
    message: string,
  ) {
    super(message);
  }
}

/**
 * POSTs `input` to a tool and returns its JSON. One try only: deciding when to retry, how long to
 * wait and when to give up is part of building a reliable agent, so that's yours to write.
 */
export async function callTool(tool: ToolSpec, task: Task, input: Record<string, unknown>, timeoutMs = task.limits?.timeoutMs ?? 10_000): Promise<unknown> {
  if (!task.challengeToken) throw new ToolCallError(tool.name, null, "The task has no challengeToken.");
  const res = await fetch(tool.url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${task.challengeToken}` },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((e: Error) => {
    throw new ToolCallError(tool.name, null, e.name === "TimeoutError" ? `${tool.name} did not answer within ${timeoutMs} ms` : `${tool.name}: ${e.message}`);
  });
  const text = await res.text();
  if (!res.ok) throw new ToolCallError(tool.name, res.status, `${tool.name} returned HTTP ${res.status}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new ToolCallError(tool.name, res.status, `${tool.name} returned something that isn't JSON`);
  }
}

/** Searches the task's knowledge source. Returns its JSON (documents with ids you can cite). */
export async function searchSource(task: Task, query: string, timeoutMs?: number): Promise<unknown> {
  if (!task.source) throw new ToolCallError("source", null, "The task has no source.");
  return callTool({ name: "source", description: task.source.description, url: task.source.url, inputSchema: {} }, task, { query }, timeoutMs);
}
