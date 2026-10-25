"use client";

import { useState } from "react";
import { ExplorerLink, Led, Module } from "./ui";

type Option = { id: string; name: string };
type LevelOption = { id: string; label: string; workers: number; totalUsdc: number };
type Worker = { id: string; name: string; task: string };
type Event =
  | { type: "plan"; insurer: string; workers: Worker[]; sequentialSeconds: number; parallelSeconds: number; totalUsdc: number; reasoning: string }
  | { type: "payment"; worker: string; name: string; amountUsdc: number; signature: string; memo: string; payMs: number }
  | { type: "payment_failed"; worker: string; name: string; error: string }
  | { type: "result"; worker: string; name: string; summary: string; workMs: number; evidence: Evidence[] }
  | { type: "review"; score: number; confidence: string; lowSample: boolean; verdict: string; metrics: Record<string, string>; records: number; spentUsdc: number; signatures: string[]; elapsedMs: number }
  | { type: "error"; message: string };

type Evidence = { id: string; type: string; outcome: string; daysToSettle: number; denialReason: string | null; year: number; source: string; attestation?: string };
type WorkerState = Worker & { status: "hiring" | "paid" | "done" | "failed"; signature?: string; amountUsdc?: number; payMs?: number; summary?: string; workMs?: number; evidence?: Evidence[]; error?: string };

const OUTCOME: Record<string, string> = { paid: "Paid", partially_paid: "Partly paid", denied: "Denied" };

export function ReviewApp({ insurers, levels }: { insurers: Option[]; levels: LevelOption[] }) {
  const [insurer, setInsurer] = useState(insurers[0]?.id ?? "");
  const [level, setLevel] = useState("medium");
  const [running, setRunning] = useState(false);
  const [plan, setPlan] = useState<Extract<Event, { type: "plan" }> | null>(null);
  const [workers, setWorkers] = useState<WorkerState[]>([]);
  const [review, setReview] = useState<Extract<Event, { type: "review" }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  const update = (id: string, patch: Partial<WorkerState>) => setWorkers((ws) => ws.map((w) => (w.id === id ? { ...w, ...patch } : w)));

  function handle(e: Event) {
    if (e.type === "plan") {
      setPlan(e);
      setWorkers(e.workers.map((w) => ({ ...w, status: "hiring" })));
    } else if (e.type === "payment") update(e.worker, { status: "paid", signature: e.signature, amountUsdc: e.amountUsdc, payMs: e.payMs });
    else if (e.type === "payment_failed") update(e.worker, { status: "failed", error: e.error });
    else if (e.type === "result") update(e.worker, { status: "done", summary: e.summary, workMs: e.workMs, evidence: e.evidence });
    else if (e.type === "review") setReview(e);
    else if (e.type === "error") setError(e.message);
  }

  async function run() {
    setRunning(true);
    setPlan(null);
    setWorkers([]);
    setReview(null);
    setError(null);
    setElapsed(null);
    const started = Date.now();
    try {
      const res = await fetch("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ insurer, level }) });
      if (!res.ok || !res.body) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
      // Read the NDJSON stream line by line as Agent A works.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) handle(JSON.parse(line) as Event);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setElapsed((Date.now() - started) / 1000);
      setRunning(false);
    }
  }

  return (
    <>
      <Module label="A · Ask for a review" right={running ? <><Led tone="signal" blink /> Agent A working</> : "Step 1"}>
        <div className="cols">
          <label className="stack small">
            <span className="label">Insurer</span>
            <select value={insurer} onChange={(e) => setInsurer(e.target.value)} disabled={running}>
              {insurers.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
          </label>
          <fieldset className="stack small" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label">Depth</legend>
            <div className="row">
              {levels.map((l) => (
                <label key={l.id} className={`tag ${level === l.id ? "tag--signal" : ""}`} style={{ cursor: "pointer", padding: "8px 10px" }}>
                  <input type="radio" name="level" value={l.id} checked={level === l.id} onChange={() => setLevel(l.id)} disabled={running} style={{ marginRight: 6 }} />
                  {l.label} · {l.workers} {l.workers === 1 ? "worker" : "workers"} · {l.totalUsdc} USDC
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="row">
          <button className="btn btn--primary" onClick={run} disabled={running || !insurer}>
            {running ? "Reviewing…" : "Review ▸"}
          </button>
        </div>
      </Module>

      {plan && (
        <Module label="B · Agent A's plan" right={`${plan.workers.length} ${plan.workers.length === 1 ? "worker" : "workers"} · ${plan.totalUsdc} USDC`}>
          <p style={{ margin: 0 }}>{plan.reasoning}</p>
          <dl className="kv">
            <dt>One after another</dt>
            <dd>~{plan.sequentialSeconds}s</dd>
            <dt>Workers in parallel</dt>
            <dd>~{plan.parallelSeconds}s</dd>
            <dt>Agent pays</dt>
            <dd>{plan.totalUsdc} devnet USDC</dd>
          </dl>
        </Module>
      )}

      {workers.length > 0 && (
        <Module label="C · Worker agents" right={`${workers.filter((w) => w.status === "done").length} / ${workers.length} done`}>
          <ul className="steps">
            {workers.map((w) => (
              <li key={w.id}>
                <Led tone={w.status === "done" ? "ok" : w.status === "failed" ? "fault" : "signal"} blink={w.status === "hiring" || w.status === "paid"} />
                <div className="stack" style={{ gap: 4 }}>
                  <span>
                    <b>{w.name}</b> <span className="muted">· {w.task}</span>
                  </span>
                  {w.status === "hiring" && <span className="small muted">Agent A is paying this worker…</span>}
                  {w.signature && (
                    <span className="small">
                      Paid {w.amountUsdc} USDC: <ExplorerLink signature={w.signature} />
                      {w.payMs !== undefined && <span className="muted"> · paid in {(w.payMs / 1000).toFixed(1)}s</span>}
                      {w.workMs !== undefined && <span className="muted"> · worked in {w.workMs} ms</span>}
                    </span>
                  )}
                  {w.summary && <span className="small">{w.summary}</span>}
                  {w.evidence && w.evidence.length > 0 && (
                    <details className="small">
                      <summary style={{ cursor: "pointer" }}>Show the {w.evidence.length} records behind this</summary>
                      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6, fontSize: 12 }}>
                        <thead>
                          <tr style={{ textAlign: "left" }}>
                            <th>Record</th><th>Type</th><th>Outcome</th><th>Days</th><th>Reason</th><th>Year</th><th>Source</th>
                          </tr>
                        </thead>
                        <tbody>
                          {w.evidence.map((r) => (
                            <tr key={r.id} style={{ borderTop: "1px solid var(--hairline)" }}>
                              <td>{r.id}</td><td>{r.type}</td><td>{OUTCOME[r.outcome] ?? r.outcome}</td><td>{r.daysToSettle}</td><td>{r.denialReason ?? "—"}</td><td>{r.year}</td>
                              <td>{r.attestation ? <ExplorerLink signature={r.attestation} /> : "seeded"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  )}
                  {w.error && <span className="small notice notice--fault">Payment failed: {w.error}</span>}
                </div>
              </li>
            ))}
          </ul>
        </Module>
      )}

      {review && (
        <Module label="D · Trust Review" right={<><Led tone="ok" /> {review.confidence} confidence</>} variant="inverse">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
            <span className="label">{plan?.insurer}</span>
            <span className="metric">
              {review.score}
              <span className="muted" style={{ fontSize: 16 }}> / 100</span>
            </span>
          </div>
          {review.lowSample && (
            <p className="notice" style={{ margin: 0, color: "var(--ink)" }}>
              Low sample: only {review.records} verified claims. Treat this score as indicative, not conclusive.
            </p>
          )}
          <p style={{ margin: 0 }}>{review.verdict}</p>
          <dl className="kv">
            {Object.entries(review.metrics).map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <span className="small">
            Built from {review.records} verified claim records · Agent A spent {review.spentUsdc} USDC in {review.signatures.length}{" "}
            {review.signatures.length === 1 ? "payment" : "payments"}
            {` · agents finished in ${(review.elapsedMs / 1000).toFixed(1)}s (estimate ~${plan?.parallelSeconds}s)`}
            {elapsed !== null && ` · ${elapsed.toFixed(1)}s end to end`}
          </span>
        </Module>
      )}

      {error && <p className="notice notice--fault">{error}</p>}
    </>
  );
}
