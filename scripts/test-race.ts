// Offline tests for the race adapter's protocol handling. Run: npm run test:race
// They check the envelope, the token and the nonce, not your AI logic: the race verifier does that.
import assert from "node:assert/strict";
import { test } from "node:test";
import { handleHealth, handleTask } from "../lib/race/adapter";
import { handlers } from "../lib/race/handlers";
import { TaskError } from "../lib/race/protocol";
import { createMemory } from "../lib/race/memory";

const env = { AGENT_STUDIO_VERIFIER_TOKEN: "test-token-0123456789" };
const auth = `Bearer ${env.AGENT_STUDIO_VERIFIER_TOKEN}`;
const request = (task: unknown) => ({ protocol: "asrp/1", nonce: "nonce-0123456789abcdef", attempt: { id: "a", layer: "l", number: 1 }, task });

test("health needs the token", () => {
  assert.equal(handleHealth(undefined, {}).status, 503);
  assert.equal(handleHealth("Bearer wrong", env).status, 401);
  const ok = handleHealth(auth, env);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.protocol, "asrp/1");
  assert.equal(ok.body.status, "ready");
});

test("tasks reject unknown callers and malformed requests", async () => {
  const noAuth = await handleTask("Bearer nope", request({ type: "respond", input: "hi" }), env);
  assert.equal(noAuth.status, 401);
  assert.deepEqual((noAuth.body.error as { code: string }).code, "unauthorized");
  const bad = await handleTask(auth, { nonce: "n".repeat(16), task: { type: "dance" } }, env);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.nonce, "n".repeat(16));
});

test("answers are wrapped with the echoed nonce", async () => {
  const original = handlers.respond;
  handlers.respond = async (task) => ({ text: `echo: ${String(task.input)}` });
  try {
    const r = await handleTask(auth, request({ type: "respond", input: "hi" }), env);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { protocol: "asrp/1", nonce: "nonce-0123456789abcdef", status: "ok", output: { text: "echo: hi" } });
  } finally {
    handlers.respond = original;
  }
});

test("TaskError becomes the matching protocol error", async () => {
  const original = handlers.extract;
  handlers.extract = async () => {
    throw new TaskError("invalid_input", "no schema");
  };
  try {
    const r = await handleTask(auth, request({ type: "extract", input: "" }), env);
    assert.equal(r.status, 400);
    assert.deepEqual(r.body.error, { code: "invalid_input", message: "no schema" });
  } finally {
    handlers.extract = original;
  }
});

test("unbuilt task types say so instead of guessing", async () => {
  const r = await handleTask(auth, request({ type: "converse", input: "hi", sessionId: "s" }), env);
  assert.equal(r.status, 500);
  assert.match((r.body.error as { message: string }).message, /doesn't handle "converse" tasks yet/);
});

test("memory keeps sessions apart (in-process fallback)", async () => {
  const m = createMemory({});
  assert.equal(m.persistent, false);
  await m.append("a", { role: "user", text: "codename is fox-12" });
  await m.append("b", { role: "user", text: "something else" });
  assert.deepEqual(await m.history("a"), [{ role: "user", text: "codename is fox-12" }]);
  assert.deepEqual(await m.history("missing"), []);
});

test("memory uses Upstash Redis when its env vars are set", async () => {
  const calls: { url: string; body: unknown }[] = [];
  const store: string[] = [];
  const fakeFetch = (async (url: string, init: { body: string; headers: Record<string, string> }) => {
    assert.equal(init.headers.authorization, "Bearer tok");
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    if (url.endsWith("/pipeline")) store.push(...body[0].slice(2));
    return new Response(JSON.stringify(url.endsWith("/pipeline") ? [] : { result: store }));
  }) as unknown as typeof fetch;
  const m = createMemory({ KV_REST_API_URL: "https://eu1.upstash.io/", KV_REST_API_TOKEN: "tok" }, fakeFetch);
  assert.equal(m.persistent, true);
  await m.append("s1", { role: "user", text: "hi" }, { role: "assistant", text: "hello" });
  assert.deepEqual(await m.history("s1"), [{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }]);
  assert.equal(calls[0].url, "https://eu1.upstash.io/pipeline");
  assert.deepEqual((calls[0].body as unknown[][]).map((c) => c[0]), ["RPUSH", "LTRIM", "EXPIRE"]);
  assert.deepEqual(calls[1].body, ["LRANGE", "race:memory:s1", 0, -1]);
});
