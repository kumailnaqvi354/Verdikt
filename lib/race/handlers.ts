// Your race logic. The verifier sends one task at a time; each function below answers one task type.
// Return the output (text, data, toolResults) or throw a TaskError. adapter.ts does the rest:
// checking the verifier token, echoing the nonce and wrapping your answer in the ASRP/1 envelope.
//
// Each race layer tests a capability, and building it is the challenge. The race page shows each
// layer's instructions and what must work. Use any AI model you like.
import { TaskError, type Task, type TaskOutput, type TaskRequest, type TaskType } from "./protocol";
// import { callTool, searchSource, ToolCallError } from "./tools";
// If you added the Gemini module: import { askGemini } from "../ai/gemini";

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
  respond: notYet("respond", "handlers.respond"),

  // Structured Outputs: turn task.input into JSON matching task.schema exactly, in output.data.
  // Missing input or schema? throw new TaskError("invalid_input", "...").
  extract: notYet("extract", "handlers.extract"),

  // Tool Calling and Reliability: decide which of task.tools to call (callTool), use their results
  // in your answer, and report them in output.toolResults. Map tool failures to
  // upstream_unavailable / upstream_timeout.
  use_tools: notYet("use_tools", "handlers.use_tools"),

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
  run_workflow: notYet("run_workflow", "handlers.run_workflow"),
};
