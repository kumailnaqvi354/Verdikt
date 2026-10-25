// Conversation memory for the Memory and Context layer: the turns of one session, kept apart from
// every other session.
//
// Where it's kept matters. On serverless hosting (Vercel, Netlify, Cloud Run…) each request can
// reach a different instance, so a variable in this file forgets between turns even though it
// works on your laptop. Set the two Upstash Redis variables below (free tier is plenty; on Vercel:
// Storage or Marketplace → Upstash for Redis → connect, which adds KV_REST_API_URL and
// KV_REST_API_TOKEN for you) and history is stored there. Without them it falls back to this
// process's memory, which is fine locally and on a single always-on server.
//
//   const history = await memory.history(task.sessionId);   // [{ role: "user", text: "…" }, …]
//   … answer task.input using history …
//   await memory.append(task.sessionId, { role: "user", text: String(task.input) }, { role: "assistant", text: answer });

export interface Turn {
  role: "user" | "assistant";
  text: string;
}

const MAX_TURNS = 100;
const TTL_SECONDS = 2 * 24 * 3600;

export interface Memory {
  /** True when history is stored in Upstash Redis (survives across serverless instances). */
  persistent: boolean;
  /** Earlier turns of this session, oldest first. */
  history(sessionId: string | undefined): Promise<Turn[]>;
  /** Adds turns to this session's history (keeps the latest 100; expires after two days). */
  append(sessionId: string | undefined, ...turns: Turn[]): Promise<void>;
}

type Env = Record<string, string | undefined>;

export function createMemory(env: Env = process.env, fetchImpl: typeof fetch = fetch): Memory {
  const url = (env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL ?? "").replace(/\/+$/, "");
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN ?? "";
  const persistent = Boolean(url && token);
  const local = new Map<string, Turn[]>();
  const keyFor = (sessionId: string) => `race:memory:${sessionId}`;
  let warned = false;

  async function redis(path: string, body: unknown): Promise<unknown> {
    const res = await fetchImpl(`${url}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Upstash Redis returned ${res.status}`);
    return res.json();
  }

  return {
    persistent,
    async history(sessionId) {
      if (!sessionId) return [];
      if (!persistent) {
        if (!warned && env.NODE_ENV === "production") {
          warned = true;
          console.warn("[race] Memory is in-process: on serverless hosting it is lost between turns. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (see lib/race/memory).");
        }
        return [...(local.get(sessionId) ?? [])];
      }
      const { result } = (await redis("", ["LRANGE", keyFor(sessionId), 0, -1])) as { result: string[] | null };
      return (result ?? []).map((s) => JSON.parse(s) as Turn);
    },
    async append(sessionId, ...turns) {
      if (!sessionId || turns.length === 0) return;
      if (!persistent) {
        local.set(sessionId, [...(local.get(sessionId) ?? []), ...turns].slice(-MAX_TURNS));
        return;
      }
      const key = keyFor(sessionId);
      await redis("/pipeline", [
        ["RPUSH", key, ...turns.map((t) => JSON.stringify(t))],
        ["LTRIM", key, -MAX_TURNS, -1],
        ["EXPIRE", key, TTL_SECONDS],
      ]);
    },
  };
}

/** The app's memory, configured from the environment. */
export const memory = createMemory();
