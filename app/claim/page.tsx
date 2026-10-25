"use client";

import Link from "next/link";
import { useState } from "react";
import { ExplorerLink, Led, Module, PageHeader } from "@/components/ui";

type Claim = { insurerId: string; type: string; outcome: string; daysToSettle: number; denialReason: string | null; year: number };
type Record = Claim & { id: string; hash: string; attestation: string };

const SAMPLE =
  "Dear policyholder, Re: your home insurance claim submitted on 3 March 2026. Kestrel Direct has completed its assessment of your claim for water damage to your kitchen. " +
  "We regret to inform you that your claim has been declined because the damage resulted from gradual wear and tear, which is excluded under section 4.2 of your policy. " +
  "This decision was made on 14 April 2026. Yours sincerely, Claims Team, Kestrel Direct";

const LABELS: { [k in keyof Claim]: string } = { insurerId: "Insurer", type: "Claim type", outcome: "Outcome", daysToSettle: "Days to decision", denialReason: "Denial reason", year: "Year" };

export default function ClaimPage() {
  const [letter, setLetter] = useState("");
  const [claim, setClaim] = useState<Claim | null>(null);
  const [insurerName, setInsurerName] = useState<string | null>(null);
  const [record, setRecord] = useState<Record | null>(null);
  const [loading, setLoading] = useState<"extract" | "attest" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const edit = (patch: Partial<Claim>) => setClaim((c) => (c ? { ...c, ...patch } : c));

  async function call(action: "extract" | "attest") {
    setLoading(action);
    setError(null);
    try {
      const res = await fetch("/api/claims", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(action === "extract" ? { action, letter } : { action, claim, letter }) });
      const data = (await res.json()) as { claim?: Claim; insurerName?: string; record?: Record; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.claim) {
        setClaim(data.claim);
        setInsurerName(data.insurerName ?? null);
        setRecord(null);
      }
      if (data.record) setRecord(data.record);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(null);
    }
  }

  return (
    <>
      <PageHeader eyebrow="Verdikt · Add a proven claim" title={<>Your claim,<br />on the record.</>}>
        Paste your insurer&apos;s decision letter. AI turns it into a structured record, you confirm it, and only its SHA-256 hash is
        written to Solana devnet: never the letter, your name or your policy number.
      </PageHeader>

      <Module label="A · Decision letter" right="Step 1">
        <textarea rows={7} value={letter} onChange={(e) => setLetter(e.target.value)} placeholder="Paste the letter or email from your insurer…" disabled={loading !== null} />
        <div className="row">
          <button className="btn btn--primary" onClick={() => call("extract")} disabled={loading !== null || !letter.trim()}>
            {loading === "extract" ? "Reading…" : "Extract with AI ▸"}
          </button>
          <button className="btn btn--secondary" onClick={() => setLetter(SAMPLE)} disabled={loading !== null}>
            Use a sample letter
          </button>
        </div>
      </Module>

      {claim && (
        <Module label="B · Check the record" right={record ? <><Led tone="ok" /> Attested</> : "Step 2"}>
          {record ? (
            <dl className="kv">
              {(Object.keys(LABELS) as (keyof Claim)[]).map((k) => (
                <div key={k} style={{ display: "contents" }}>
                  <dt>{LABELS[k]}</dt>
                  <dd>{k === "insurerId" ? insurerName ?? claim[k] : claim[k] ?? "—"}</dd>
                </div>
              ))}
            </dl>
          ) : (
            // Editable: the claimant corrects anything the AI misread before it's attested.
            <div className="stack">
              <span className="small muted">Check what the AI read and correct anything wrong before attesting.</span>
              <div className="cols">
                <label className="stack small">
                  <span className="label">{LABELS.insurerId}</span>
                  <input value={insurerName ?? claim.insurerId} disabled />
                </label>
                <label className="stack small">
                  <span className="label">{LABELS.type}</span>
                  <select value={claim.type} onChange={(e) => edit({ type: e.target.value })} disabled={loading !== null}>
                    {["home", "motor", "travel", "pet"].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <label className="stack small">
                  <span className="label">{LABELS.outcome}</span>
                  <select value={claim.outcome} onChange={(e) => edit({ outcome: e.target.value })} disabled={loading !== null}>
                    {["paid", "partially_paid", "denied"].map((o) => <option key={o} value={o}>{o.replace("_", " ")}</option>)}
                  </select>
                </label>
              </div>
              <div className="cols">
                <label className="stack small">
                  <span className="label">{LABELS.daysToSettle}</span>
                  <input type="number" min={0} value={claim.daysToSettle} onChange={(e) => edit({ daysToSettle: Number(e.target.value) })} disabled={loading !== null} />
                </label>
                <label className="stack small">
                  <span className="label">{LABELS.year}</span>
                  <input type="number" value={claim.year} onChange={(e) => edit({ year: Number(e.target.value) })} disabled={loading !== null} />
                </label>
                <label className="stack small">
                  <span className="label">{LABELS.denialReason}</span>
                  <input value={claim.denialReason ?? ""} placeholder={claim.outcome === "paid" ? "Not needed when paid" : ""} onChange={(e) => edit({ denialReason: e.target.value || null })} disabled={loading !== null || claim.outcome === "paid"} />
                </label>
              </div>
            </div>
          )}
          {!record && (
            <div className="row">
              <button className="btn btn--primary" onClick={() => call("attest")} disabled={loading !== null}>
                {loading === "attest" ? "Writing to devnet…" : "Confirm and attest ▸"}
              </button>
            </div>
          )}
          {record && (
            <div className="stack">
              <p className="notice notice--ok" style={{ margin: 0 }}>
                Attested on Solana devnet: <ExplorerLink signature={record.attestation} />
              </p>
              <span className="small muted" style={{ wordBreak: "break-all" }}>Hash on chain: {record.hash}</span>
              <Link href="/" className="small">Review this insurer now ▸</Link>
            </div>
          )}
        </Module>
      )}

      {error && <p className="notice notice--fault">{error}</p>}
      <p className="small muted">Demo: only letters from the six fictional demo insurers are accepted.</p>
    </>
  );
}
