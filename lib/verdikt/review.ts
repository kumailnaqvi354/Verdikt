import "server-only";
import { randomBytes } from "node:crypto";
import { chatGroq } from "../ai/groq";
import { loadAgentSigner } from "../payments/client";
import { payUsdc } from "../payments/transfer";
import { findInsurer, recordsFor, WORKERS, type ClaimRecord, type WorkerId } from "./data";

// Agent A: turns "review <insurer> at <level>" into a plan, hires and pays worker agents in
// devnet USDC (in parallel, which is what buys speed), merges their findings into a Trust Review.

export type Level = "low" | "medium" | "high";

export const LEVELS: Record<Level, { label: string; workers: WorkerId[]; pricePerWorker: number; secondsPerTask: number }> = {
  low: { label: "Low", workers: ["claims"], pricePerWorker: 0.01, secondsPerTask: 10 },
  medium: { label: "Medium", workers: ["claims", "types", "complaints"], pricePerWorker: 0.015, secondsPerTask: 10 },
  high: { label: "High", workers: ["claims", "types", "complaints", "denials", "trends"], pricePerWorker: 0.02, secondsPerTask: 10 },
};

export type ReviewEvent =
  | { type: "plan"; insurer: string; level: Level; workers: { id: WorkerId; name: string; task: string }[]; sequentialSeconds: number; parallelSeconds: number; totalUsdc: number; reasoning: string }
  | { type: "payment"; worker: WorkerId; name: string; amountUsdc: number; signature: string; memo: string; payMs: number }
  | { type: "payment_failed"; worker: WorkerId; name: string; error: string }
  | { type: "result"; worker: WorkerId; name: string; summary: string; data: unknown; workMs: number; evidence: Evidence[] }
  | { type: "review"; score: number; confidence: "low" | "medium" | "high"; lowSample: boolean; verdict: string; metrics: Record<string, string>; records: number; spentUsdc: number; signatures: string[]; elapsedMs: number }
  | { type: "error"; message: string };

/** A record a worker used, as shown in the drill-down. */
export type Evidence = Pick<ClaimRecord, "id" | "type" | "outcome" | "daysToSettle" | "denialReason" | "year" | "source" | "attestation">;

/** Below this many verified claims a score is flagged as a low sample. */
const LOW_SAMPLE = 20;

/** The records each worker draws on (complaints come from the snapshot, not claim records). */
function evidenceFor(id: WorkerId, insurerId: string): Evidence[] {
  if (id === "complaints") return [];
  const rs = recordsFor(insurerId).filter((r) => id !== "denials" || r.denialReason);
  return rs.map(({ id, type, outcome, daysToSettle, denialReason, year, source, attestation }) => ({ id, type, outcome, daysToSettle, denialReason, year, source, attestation }));
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const pct = (n: number) => `${round(n * 100)}%`;
const payoutRate = (rs: ClaimRecord[]) => (rs.length ? rs.filter((r) => r.outcome !== "denied").length / rs.length : 0);

/** What each worker computes. Deterministic over the verified records, so the numbers are checkable. */
function runWorker(id: WorkerId, insurerId: string): { summary: string; data: Record<string, unknown> } {
  const rs = recordsFor(insurerId);
  switch (id) {
    case "claims": {
      const avgDays = rs.reduce((a, r) => a + r.daysToSettle, 0) / Math.max(1, rs.length);
      const data = { verifiedClaims: rs.length, payoutRate: round(payoutRate(rs), 3), fullyPaid: rs.filter((r) => r.outcome === "paid").length, avgDaysToSettle: round(avgDays) };
      return { summary: `${rs.length} verified claims, ${pct(data.payoutRate)} paid out (fully or partly), ${data.avgDaysToSettle} days on average to settle.`, data };
    }
    case "types": {
      const byType = Object.fromEntries(
        (["home", "motor", "travel", "pet"] as const).map((t) => {
          const sub = rs.filter((r) => r.type === t);
          return [t, { claims: sub.length, payoutRate: round(payoutRate(sub), 3) }];
        }),
      );
      const worst = Object.entries(byType).filter(([, v]) => v.claims > 0).sort((a, b) => a[1].payoutRate - b[1].payoutRate)[0];
      return { summary: `Weakest category: ${worst[0]} (${pct(worst[1].payoutRate)} paid out of ${worst[1].claims}).`, data: byType };
    }
    case "complaints": {
      const per1k = findInsurer(insurerId)!.complaintsPer1k;
      return { summary: `${per1k} upheld complaints per 1,000 policies (fictional snapshot).`, data: { upheldComplaintsPer1k: per1k } };
    }
    case "denials": {
      const counts: Record<string, number> = {};
      for (const r of rs) if (r.denialReason) counts[r.denialReason] = (counts[r.denialReason] ?? 0) + 1;
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      return { summary: top.length ? `Top reason for denied or cut claims: ${top[0][0]} (${top[0][1]} cases).` : "No denied claims.", data: Object.fromEntries(top) };
    }
    case "trends": {
      const byYear = Object.fromEntries([2023, 2024, 2025, 2026].map((y) => [y, round(payoutRate(rs.filter((r) => r.year === y)), 3)]));
      const ys = Object.values(byYear);
      const delta = ys[ys.length - 1] - ys[0];
      return { summary: `Payout rate ${delta >= 0 ? "up" : "down"} ${pct(Math.abs(delta))} from 2023 to 2026.`, data: byYear };
    }
  }
}

/** Trust score out of 100 from whatever evidence was bought: payout rate, speed, complaints. */
function score(insurerId: string, level: Level): number {
  const rs = recordsFor(insurerId);
  const payout = payoutRate(rs);
  const avgDays = rs.reduce((a, r) => a + r.daysToSettle, 0) / Math.max(1, rs.length);
  const speed = Math.min(1, Math.max(0, 1 - (avgDays - 14) / 60));
  if (level === "low") return Math.round(100 * (0.7 * payout + 0.3 * speed));
  const complaints = Math.min(1, Math.max(0, 1 - findInsurer(insurerId)!.complaintsPer1k / 3));
  return Math.round(100 * (0.55 * payout + 0.25 * speed + 0.2 * complaints));
}

async function say(system: string, user: string, fallback: string): Promise<string> {
  try {
    const reply = await chatGroq([{ role: "system", content: system }, { role: "user", content: user }], { reasoningEffort: "low" });
    return reply.content?.trim() || fallback;
  } catch {
    return fallback;
  }
}

export async function runReview(insurerQuery: string, level: Level, emit: (e: ReviewEvent) => void): Promise<void> {
  const insurer = findInsurer(insurerQuery);
  if (!insurer) return emit({ type: "error", message: `Unknown insurer "${insurerQuery}".` });
  const plan = LEVELS[level];
  const workers = plan.workers.map((id) => WORKERS.find((w) => w.id === id)!);
  const totalUsdc = round(plan.pricePerWorker * workers.length, 4);
  const sequentialSeconds = workers.length * plan.secondsPerTask;
  const parallelSeconds = plan.secondsPerTask + (workers.length - 1) * 2;

  const reasoning = await say(
    "You are Agent A, the planner in Verdikt, an insurer-reputation service. In 2 short sentences, explain your plan to the user: the scope for this level and why you hire workers in parallel (speed) and what it costs. Plain text, no markdown.",
    `Insurer: ${insurer.name}. Level: ${plan.label}. Tasks: ${workers.map((w) => w.task).join("; ")}. Each task takes ~${plan.secondsPerTask}s, so one after another: ~${sequentialSeconds}s in total. With ${workers.length} worker(s) in parallel: ~${parallelSeconds}s for ${totalUsdc} devnet USDC.`,
    `${plan.label} scope = ${workers.length} task(s). Running them one after another takes ~${sequentialSeconds}s; hiring ${workers.length} worker(s) in parallel takes ~${parallelSeconds}s for ${totalUsdc} USDC.`,
  );
  emit({ type: "plan", insurer: insurer.name, level, workers: workers.map(({ id, name, task }) => ({ id, name, task })), sequentialSeconds, parallelSeconds, totalUsdc, reasoning });

  let signer;
  try {
    signer = await loadAgentSigner();
  } catch (e) {
    return emit({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }

  // Hire every worker at once: each is paid first, then runs its task.
  const reviewId = randomBytes(4).toString("hex");
  const started = Date.now();
  const signatures: string[] = [];
  let spent = 0;
  await Promise.all(
    workers.map(async (w) => {
      const memo = `verdikt:${reviewId}:${w.id}`;
      try {
        const payStart = Date.now();
        const { signature } = await payUsdc(signer, { to: w.address, amountUsdc: plan.pricePerWorker, memo });
        signatures.push(signature);
        spent += plan.pricePerWorker;
        emit({ type: "payment", worker: w.id, name: w.name, amountUsdc: plan.pricePerWorker, signature, memo, payMs: Date.now() - payStart });
      } catch (e) {
        return emit({ type: "payment_failed", worker: w.id, name: w.name, error: e instanceof Error ? e.message : String(e) });
      }
      const workStart = Date.now();
      const out = runWorker(w.id, insurer.id);
      const evidence = evidenceFor(w.id, insurer.id);
      emit({ type: "result", worker: w.id, name: w.name, ...out, evidence, workMs: Date.now() - workStart });
    }),
  );
  if (!signatures.length) return emit({ type: "error", message: "No worker could be paid, so no evidence was gathered." });

  const records = recordsFor(insurer.id);
  const s = score(insurer.id, level);
  const findings = workers.map((w) => `${w.name}: ${runWorker(w.id, insurer.id).summary}`).join("\n");
  const verdict = await say(
    "You are Agent A in Verdikt. Write a 2-sentence verdict on how this insurer handles claims, using only the findings given. Be factual, no accusations, mention the sample size. Plain text, no markdown.",
    `Insurer: ${insurer.name}. Trust score: ${s}/100.\nFindings:\n${findings}`,
    findings,
  );
  const claims = runWorker("claims", insurer.id).data;
  emit({
    type: "review",
    score: s,
    confidence: level,
    lowSample: records.length < LOW_SAMPLE,
    verdict,
    metrics: {
      "Verified claims": String(records.length),
      "Paid out": pct(claims.payoutRate as number),
      "Avg days to settle": String(claims.avgDaysToSettle),
      ...(level !== "low" ? { "Upheld complaints / 1k": String(insurer.complaintsPer1k) } : {}),
    },
    records: records.length,
    spentUsdc: round(spent, 4),
    signatures,
    elapsedMs: Date.now() - started,
  });
}
