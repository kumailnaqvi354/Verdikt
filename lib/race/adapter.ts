// The protocol plumbing: authentication, the nonce, the envelope and routing by task type.
// You shouldn't need to change this file. Your logic goes in handlers.ts.
import { timingSafeEqual } from "node:crypto";
import { handlers } from "./handlers";
import { PROTOCOL, TASK_TYPES, TaskError, type TaskRequest, type TaskType } from "./protocol";

export interface AdapterResponse {
  status: number;
  body: Record<string, unknown>;
}

export const APP_NAME = process.env.AGENT_STUDIO_APP_NAME || "agent-studio-app";

/** True when the request carries this app's verifier token (from your team page). */
export function isVerifier(authorization: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  const token = env.AGENT_STUDIO_VERIFIER_TOKEN;
  if (!token) return false;
  const expected = Buffer.from(`Bearer ${token}`);
  const given = Buffer.from(authorization ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function handleHealth(authorization: string | null | undefined, env: Record<string, string | undefined> = process.env): AdapterResponse {
  if (!env.AGENT_STUDIO_VERIFIER_TOKEN) {
    return { status: 503, body: { protocol: PROTOCOL, status: "starting", error: "AGENT_STUDIO_VERIFIER_TOKEN is not set. Copy it from your team page into your environment." } };
  }
  if (!isVerifier(authorization, env)) return { status: 401, body: { protocol: PROTOCOL, status: "error", error: { code: "unauthorized", message: "unknown caller" } } };
  return { status: 200, body: { protocol: PROTOCOL, status: "ready", name: APP_NAME, capabilities: implementedTaskTypes() } };
}

export async function handleTask(authorization: string | null | undefined, body: unknown, env: Record<string, string | undefined> = process.env): Promise<AdapterResponse> {
  const request = body as Partial<TaskRequest> | null;
  const nonce = typeof request?.nonce === "string" ? request.nonce : undefined;
  const error = (e: TaskError): AdapterResponse => ({ status: e.status, body: { protocol: PROTOCOL, nonce, status: "error", error: { code: e.code, message: e.message } } });

  if (!isVerifier(authorization, env)) return error(new TaskError("unauthorized", "unknown caller"));
  const task = request?.task;
  if (!nonce || !task || typeof task !== "object" || !TASK_TYPES.includes(task.type as TaskType)) {
    return error(new TaskError("invalid_input", `Expected { protocol: "${PROTOCOL}", nonce, task: { type, input } } with type one of ${TASK_TYPES.join(", ")}.`));
  }
  try {
    const output = await handlers[task.type](task, request as TaskRequest);
    return { status: 200, body: { protocol: PROTOCOL, nonce, status: "ok", output: output ?? {} } };
  } catch (e) {
    if (e instanceof TaskError) return error(e);
    console.error(`[race] ${task.type} handler failed:`, e);
    return error(new TaskError("internal", e instanceof Error ? e.message : "handler failed"));
  }
}

/** Task types whose handler you have written (reported in the health response). */
export function implementedTaskTypes(): TaskType[] {
  return TASK_TYPES.filter((t) => !(handlers[t] as { notImplemented?: boolean }).notImplemented);
}
