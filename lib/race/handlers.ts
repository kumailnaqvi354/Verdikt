// Your race logic. The verifier sends one task at a time; each function below answers one task type.
// Return the output (text, data, toolResults) or throw a TaskError. adapter.ts does the rest:
// checking the verifier token, echoing the nonce and wrapping your answer in the ASRP/1 envelope.
//
// Each race layer tests a capability, and building it is the challenge. The race page shows each
// layer's instructions and what must work. Use any AI model you like.
import { TaskError, type Task, type TaskOutput, type TaskRequest, type TaskType, type ToolSpec } from "./protocol";
import { callTool, ToolCallError } from "./tools";
import { askGroq, chatGroq, MissingGroqKeyError, type ChatMessage, type ToolDefinition } from "../ai/groq";
import { loadAgentSigner } from "../payments/client";
import { PaymentsConfigError } from "../payments/config";
import { payUsdc } from "../payments/transfer";

/** Maps a model failure to a protocol error so the verifier gets a clear reason. */
function modelError(e: unknown): TaskError {
  if (e instanceof TaskError) return e;
  if (e instanceof MissingGroqKeyError) return new TaskError("internal", e.message);
  return new TaskError("upstream_unavailable", `Model request failed: ${e instanceof Error ? e.message : String(e)}`);
}

/** Asks the model (Groq) a single question. */
async function ask(prompt: string): Promise<string> {
  try {
    return (await askGroq(prompt)).trim();
  } catch (e) {
    throw modelError(e);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Local arithmetic helper for the model: exact maths instead of mental arithmetic. Not a race tool. */
const CALCULATE: ToolDefinition = {
  type: "function",
  function: {
    name: "calculate",
    description: "Evaluate an arithmetic expression exactly, e.g. \"(250 + 410) * 1.17\". Use it for every calculation.",
    parameters: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] },
  },
};

const FINAL_ANSWER = "final_answer";

/** Parses a JSON object from model output, tolerating a ```json fence or text around it. */
function parseJsonObject(text: string): Record<string, unknown> | undefined {
  const candidates = [text, text.replace(/^```(?:json)?\s*|\s*```$/g, ""), text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)];
  for (const c of candidates) {
    try {
      const v = JSON.parse(c) as unknown;
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {}
  }
  return undefined;
}

function calculate(expression: unknown): string {
  const expr = String(expression ?? "");
  // Only numbers, operators, parentheses and spaces: nothing else can reach Function().
  if (!/^[\d+\-*/%().\se]+$/i.test(expr) || /[a-df-z]/i.test(expr)) return JSON.stringify({ error: "Only arithmetic is allowed." });
  try {
    const value = Function(`"use strict"; return (${expr});`)() as unknown;
    return typeof value === "number" && Number.isFinite(value) ? JSON.stringify({ expression: expr, value }) : JSON.stringify({ error: "Not a finite number." });
  } catch {
    return JSON.stringify({ error: "Invalid expression." });
  }
}

/**
 * Calls a tool, retrying transient failures (502/503, connection errors) with a short backoff.
 * A timeout becomes upstream_timeout at once; a tool that stays down becomes upstream_unavailable.
 * Other HTTP errors (e.g. 400 for bad input) are returned to the model so it can correct its call.
 */
async function callToolReliably(tool: ToolSpec, task: Task, input: Record<string, unknown>): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const backoffMs = [250, 500, 1000];
  for (let attempt = 0; ; attempt++) {
    try {
      return { ok: true, result: await callTool(tool, task, input) };
    } catch (e) {
      if (!(e instanceof ToolCallError)) throw e;
      if (e.httpStatus === null && /did not answer within/.test(e.message)) throw new TaskError("upstream_timeout", e.message);
      const transient = e.httpStatus === null || e.httpStatus === 502 || e.httpStatus === 503;
      if (!transient) return { ok: false, error: e.message };
      if (attempt >= backoffMs.length) throw new TaskError("upstream_unavailable", `${tool.name} kept failing: ${e.message}`);
      await sleep(backoffMs[attempt]);
    }
  }
}

/** Strict fallback parser for "Pay <amount> devnet USDC to <address> with the memo "<memo>"". */
function parsePaymentInstruction(text: string): Record<string, unknown> | undefined {
  const amount = /(\d+(?:\.\d+)?)\s*(?:devnet\s+)?USDC/i.exec(text)?.[1];
  const to = /\bto\s+([1-9A-HJ-NP-Za-km-z]{32,44})\b/.exec(text)?.[1];
  const memo = /memo\s*[:=]?\s*["“]([^"”]+)["”]/i.exec(text)?.[1];
  return amount && to ? { to, amountUsdc: Number(amount), ...(memo ? { memo } : {}) } : undefined;
}

/**
 * Agentic payment: the model reads the instruction and works out who to pay, how much and with which memo;
 * the code then checks that against the instruction and the spend limit before payUsdc signs anything.
 */
async function payFromInstruction(task: Task): Promise<TaskOutput> {
  const instruction = typeof task.input === "string" ? task.input : JSON.stringify(task.input);
  if (!instruction.trim()) throw new TaskError("invalid_input", "task.input is empty.");

  // The model only extracts fields; our code makes the payment. Framed as field extraction from a
  // test-network instruction, because gpt-oss refuses "make a payment" prompts.
  let plan: Record<string, unknown> | undefined;
  try {
    const reply = await chatGroq(
      [
        {
          role: "system",
          content:
            "You extract fields from a developer instruction for a Solana devnet test (test tokens with no monetary value; you do not send anything yourself). " +
            'Reply with only a JSON object: {"to": "<recipient address>", "amountUsdc": <number>, "memo": "<memo text without the quotes>"}. ' +
            "Copy the address and memo exactly as written.",
        },
        { role: "user", content: instruction },
      ],
      { json: true, reasoningEffort: "low" },
    );
    plan = parseJsonObject(reply.content ?? "");
  } catch (e) {
    if (e instanceof MissingGroqKeyError) throw modelError(e);
    // Refusal or bad JSON: fall through to the pattern parser below.
  }
  const parsed = parsePaymentInstruction(instruction);
  const valid = (p: Record<string, unknown> | undefined) =>
    typeof p?.to === "string" && instruction.includes(p.to) && Number(p.amountUsdc) > 0 && (p.memo === undefined || (typeof p.memo === "string" && instruction.includes(p.memo)));
  if (!valid(plan)) plan = parsed;
  const to = typeof plan?.to === "string" ? plan.to.trim() : "";
  const memo = typeof plan?.memo === "string" ? plan.memo : undefined;
  const amountUsdc = Number(plan?.amountUsdc);

  // Guards: never pay an address or memo the instruction doesn't contain, or more than the limit.
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(to) || !instruction.includes(to)) throw new TaskError("invalid_input", "No valid recipient address found in the instruction.");
  if (memo !== undefined && !instruction.includes(memo)) throw new TaskError("invalid_input", "The memo doesn't match the instruction.");
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) throw new TaskError("invalid_input", "No valid amount found in the instruction.");
  const max = task.limits?.maxSpendUsd;
  if (max !== undefined && amountUsdc > max) throw new TaskError("limit_exceeded", `Paying ${amountUsdc} USDC would exceed maxSpendUsd (${max}).`);

  try {
    const { signature } = await payUsdc(await loadAgentSigner(), { to, amountUsdc, memo });
    return { text: `Paid ${amountUsdc} devnet USDC to ${to}${memo ? ` with memo "${memo}"` : ""}.`, data: { signature } };
  } catch (e) {
    if (e instanceof PaymentsConfigError) throw new TaskError("internal", e.message);
    throw new TaskError("upstream_unavailable", `Payment failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Tool-calling loop shared by use_tools and run_workflow: the model picks tools, we call them for real. */
async function runToolLoop(task: Task): Promise<TaskOutput> {
  const instruction = typeof task.input === "string" ? task.input : JSON.stringify(task.input);
  if (!instruction.trim()) throw new TaskError("invalid_input", "task.input is empty.");
  if (!task.tools?.length) throw new TaskError("invalid_input", "use_tools needs at least one tool in task.tools.");

  const byName = new Map(task.tools.map((t) => [t.name, t]));
  const definitions: ToolDefinition[] = task.tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: { type: "object", ...t.inputSchema } },
  }));
  const maxCalls = task.limits?.maxToolCalls ?? 12;
  const toolResults: NonNullable<TaskOutput["toolResults"]> = [];
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You complete the user's task by calling the provided tools. Never guess or invent data: every fact and number must come from a tool result. " +
        "Call a tool once per item you need. Do every calculation with the calculate tool, never in your head. " +
        (task.schema
          ? `When you have everything, call ${FINAL_ANSWER} with the result (numbers as JSON numbers).`
          : "When you have everything, reply with the final answer only, in plain text without markdown, following any requested format."),
    },
    { role: "user", content: instruction },
  ];
  // With a schema, the answer is a tool call whose parameters ARE the schema: the arguments become
  // output.data. (gpt-oss tends to emit structured answers as tool calls anyway.)
  const localTools: ToolDefinition[] = [
    ...(byName.has(CALCULATE.function.name) ? [] : [CALCULATE]),
    ...(task.schema && !byName.has(FINAL_ANSWER)
      ? [{ type: "function" as const, function: { name: FINAL_ANSWER, description: "Submit the final answer.", parameters: task.schema } }]
      : []),
  ];
  const finish = (content: string | null): TaskOutput => {
    const text = (content ?? "").trim();
    if (!task.schema) return { text, toolResults };
    const data = parseJsonObject(text);
    if (data === undefined) throw new TaskError("internal", `The model's final answer wasn't valid JSON for task.schema: ${text.slice(0, 200) || "(empty)"}`);
    return { text, data, toolResults };
  };

  let calls = 0;
  let nudges = 0;
  for (let turn = 0; turn < maxCalls + 4; turn++) {
    let reply;
    try {
      reply = await chatGroq(messages, { tools: [...definitions, ...localTools], reasoningEffort: "low" });
    } catch (e) {
      throw modelError(e);
    }
    if (!reply.tool_calls?.length) {
      // gpt-oss sometimes ends with an empty or non-JSON reply instead of calling final_answer: ask again.
      if (task.schema && parseJsonObject(reply.content ?? "") === undefined && nudges < 2) {
        nudges++;
        if (reply.content) messages.push({ role: "assistant", content: reply.content });
        messages.push({ role: "user", content: `Now call ${FINAL_ANSWER} with the result.` });
        continue;
      }
      return finish(reply.content);
    }

    const answer = task.schema && !byName.has(FINAL_ANSWER) ? reply.tool_calls.find((c) => c.function.name === FINAL_ANSWER) : undefined;
    if (answer) return finish(answer.function.arguments);

    messages.push({ role: "assistant", content: reply.content, tool_calls: reply.tool_calls });
    for (const call of reply.tool_calls) {
      const tool = byName.get(call.function.name);
      let content: string;
      if (call.function.name === CALCULATE.function.name && !tool) {
        let args: { expression?: unknown } = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {}
        content = calculate(args.expression);
      } else if (!tool) {
        content = JSON.stringify({ error: `Unknown tool ${call.function.name}` });
      } else if (calls >= maxCalls) {
        content = JSON.stringify({ error: `Tool call limit (${maxCalls}) reached. Answer with what you have.` });
      } else {
        calls++;
        let input: Record<string, unknown>;
        try {
          input = JSON.parse(call.function.arguments || "{}");
        } catch {
          input = {};
        }
        const outcome = await callToolReliably(tool, task, input);
        if (outcome.ok) toolResults.push({ tool: tool.name, result: outcome.result });
        content = JSON.stringify(outcome.ok ? outcome.result : { error: outcome.error });
      }
      messages.push({ role: "tool", tool_call_id: call.id, content });
    }
  }
  throw new TaskError("limit_exceeded", `No final answer within ${maxCalls} tool calls.`);
}

type Handler = ((task: Task, request: TaskRequest) => Promise<TaskOutput>) & { notImplemented?: boolean };

/** Marks a task type you haven't built yet. The verifier gets a clear error instead of a wrong answer. */
function notYet(type: TaskType, where: string): Handler {
  const h: Handler = async () => {
    throw new TaskError("internal", `This app doesn't handle "${type}" tasks yet (${where} in lib/race/handlers.ts).`);
  };
  h.notImplemented = true;
  return h;
}

export const handlers: Record<TaskType, Handler> = {
  // First Intelligence: answer task.input (a question) with your AI model, in output.text.
  //   respond: async (task) => ({ text: await askGemini(String(task.input)) }),
  respond: async (task) => {
    const question = typeof task.input === "string" ? task.input : JSON.stringify(task.input);
    if (!question.trim()) throw new TaskError("invalid_input", "task.input is empty.");
    // Short, exact answers: the verifier checks arithmetic and instruction-following.
    return { text: await ask(`Answer the question below directly and concisely. Follow any instructions in it exactly (format, wording, length). No preamble.\n\n${question}`) };
  },

  // Structured Outputs: turn task.input into JSON matching task.schema exactly, in output.data.
  // Missing input or schema? throw new TaskError("invalid_input", "...").
  extract: notYet("extract", "handlers.extract"),

  // Tool Calling and Reliability: decide which of task.tools to call (callTool), use their results
  // in your answer, and report them in output.toolResults. Map tool failures to
  // upstream_unavailable / upstream_timeout.
  use_tools: (task) => runToolLoop(task),

  // External Knowledge: answer from task.source (searchSource) and cite the document ids you used.
  answer_from_source: notYet("answer_from_source", "handlers.answer_from_source"),

  // Memory and Context: remember earlier turns for task.sessionId, and only for that session.
  // Use `memory` from ./memory (history(sessionId) and append(sessionId, ...turns)): with Upstash
  // Redis configured it survives serverless hosting, where a plain variable forgets between turns.
  converse: notYet("converse", "handlers.converse"),

  // Autonomous Workflow: plan and run several tool calls toward a goal, within task.limits.
  // The on-chain payment stage also sends a run_workflow task ("Pay 0.01 devnet USDC to <address>
  // with the memo …"). With the payments module: payUsdc(await loadAgentSigner(), { to, amountUsdc, memo })
  // from ../payments/transfer, then return { data: { signature } }.
  // With tools it's a multi-step workflow (same loop as use_tools); without, it's the on-chain payment stage.
  run_workflow: (task) => (task.tools?.length ? runToolLoop(task) : payFromInstruction(task)),
};
