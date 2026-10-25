// Sends one task to your running app, the way the race verifier does. Run: npm run race:try -- respond "What is 6 x 7?"
// Uses AGENT_STUDIO_VERIFIER_TOKEN from .env.local and RACE_APP_URL (default http://localhost:3000).
import { randomBytes } from "node:crypto";

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: use the environment as it is.
}

const [type = "respond", ...rest] = process.argv.slice(2);
const input = rest.join(" ") || "What is the capital of France?";
const base = (process.env.RACE_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
const token = process.env.AGENT_STUDIO_VERIFIER_TOKEN;
if (!token) {
  console.error("AGENT_STUDIO_VERIFIER_TOKEN is not set. Copy it from your team page into .env.local.");
  process.exit(1);
}
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

const health = await fetch(`${base}/agent-studio/v1/health`, { headers });
console.log(`GET /agent-studio/v1/health -> ${health.status}`, await health.json().catch(() => null));

const nonce = randomBytes(16).toString("hex");
const started = Date.now();
const res = await fetch(`${base}/agent-studio/v1/tasks`, {
  method: "POST",
  headers,
  body: JSON.stringify({ protocol: "asrp/1", nonce, attempt: { id: "local-try", layer: "local", number: 1 }, task: { type, input } }),
});
const body = (await res.json().catch(() => null)) as { nonce?: string } | null;
console.log(`POST /agent-studio/v1/tasks (${type}) -> ${res.status} in ${Date.now() - started} ms`);
console.log(JSON.stringify(body, null, 2));
if (body?.nonce !== nonce) console.log("Note: the nonce was not echoed. The verifier would reject this answer.");
