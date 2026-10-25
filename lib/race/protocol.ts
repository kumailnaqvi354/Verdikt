// ASRP/1, the Agent Studio Race Protocol: how the race verifier talks to your app.
// Full reference: https://github.com/Db0706/superteam-agent-studio/blob/main/docs/VERIFICATION_SDK.md

export const PROTOCOL = "asrp/1";

export type TaskType = "respond" | "extract" | "use_tools" | "answer_from_source" | "converse" | "run_workflow";
export const TASK_TYPES: readonly TaskType[] = ["respond", "extract", "use_tools", "answer_from_source", "converse", "run_workflow"];

export interface ToolSpec {
  name: string;
  description: string;
  /** POST JSON here with `Authorization: Bearer <task.challengeToken>`. */
  url: string;
  inputSchema: Record<string, unknown>;
}

export interface Task {
  type: TaskType;
  /** A natural-language instruction, or structured input, depending on the type. */
  input: string | Record<string, unknown>;
  /** JSON Schema that `output.data` must match (extract, run_workflow). */
  schema?: Record<string, unknown>;
  /** Conversation id (converse). Keep history per session id, never across them. */
  sessionId?: string;
  tools?: ToolSpec[];
  source?: { url: string; description: string };
  /** Send as the Bearer token when calling `tools` or `source`. */
  challengeToken?: string;
  limits?: { maxToolCalls?: number; maxSpendUsd?: number; timeoutMs?: number };
}

export interface TaskRequest {
  protocol: typeof PROTOCOL;
  nonce: string;
  attempt: { id: string; layer: string; number: number };
  task: Task;
}

export interface TaskOutput {
  /** Natural-language answer, if the task has one. */
  text?: string;
  /** Structured result. Must match `task.schema` when one is given. */
  data?: unknown;
  /** What your tools returned. The verifier checks this against the tool service's own records. */
  toolResults?: { tool: string; result: unknown }[];
}

export type ErrorCode = "invalid_input" | "upstream_unavailable" | "upstream_timeout" | "limit_exceeded" | "unauthorized" | "internal";

const HTTP_STATUS: Record<ErrorCode, number> = {
  invalid_input: 400,
  unauthorized: 401,
  limit_exceeded: 422,
  internal: 500,
  upstream_unavailable: 503,
  upstream_timeout: 504,
};

/** Throw this from a handler to answer with a protocol error (the right HTTP status is chosen for you). */
export class TaskError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
  get status(): number {
    return HTTP_STATUS[this.code];
  }
}
