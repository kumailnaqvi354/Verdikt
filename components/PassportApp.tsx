"use client";

import { useState } from "react";
import { Led, Module } from "./ui";

export type PassportView = {
  id: string;
  name: string;
  passportNo: string;
  memberSince: number;
  claims: { id: string; insurer: string; type: string; outcome: string; year: number; hash: string }[];
  summary: { verifiedClaims: number; paidOrPartly: number; denied: number; insurers: number; yearsOnRecord: number };
};

const OUTCOME: Record<string, string> = { paid: "Paid", partially_paid: "Partly paid", denied: "Denied" };

/** Machine-readable-zone style lines (decorative, fictional format). */
function mrz(p: PassportView): [string, string] {
  const [given, ...rest] = p.name.toUpperCase().split(" ");
  const line1 = `VDK<CLAIMANT<<${rest.join("<")}<<${given}`.padEnd(44, "<").slice(0, 44);
  const line2 = `${p.passportNo.replace("-", "")}<${p.memberSince}<<CLAIMS${String(p.summary.verifiedClaims).padStart(2, "0")}<<DEMO`.padEnd(44, "<").slice(0, 44);
  return [line1, line2];
}

function PassportCard({ p }: { p: PassportView }) {
  const [given, ...rest] = p.name.split(" ");
  const initials = p.name.split(" ").map((s) => s[0]).join("");
  const [l1, l2] = mrz(p);
  const field = (label: string, value: string) => (
    <div>
      <div style={{ font: "500 9px/1.4 var(--mono)", letterSpacing: "0.08em", textTransform: "uppercase", color: "#5b6170" }}>{label}</div>
      <div style={{ font: "600 15px/1.3 var(--sans)", color: "#16182a" }}>{value}</div>
    </div>
  );
  return (
    <div
      role="img"
      aria-label={`Demo Claimant Passport for ${p.name}, ${p.passportNo}`}
      style={{
        maxWidth: 640,
        borderRadius: 14,
        overflow: "hidden",
        border: "1px solid #1d2340",
        boxShadow: "0 1px 0 #1d2340, 0 12px 30px rgba(20, 24, 50, 0.18)",
        background: "repeating-linear-gradient(135deg, #f6f3ea 0 6px, #f1ede1 6px 7px), #f6f3ea",
      }}
    >
      <div style={{ background: "#1d2340", color: "#e9d9a6", padding: "10px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ font: "700 13px/1 var(--mono)", letterSpacing: "0.14em" }}>CLAIMANT PASSPORT</span>
        <span style={{ font: "600 11px/1 var(--mono)", letterSpacing: "0.12em" }}>VERDIKT · DEMO</span>
      </div>
      <div style={{ display: "flex", gap: 18, padding: 18, flexWrap: "wrap" }}>
        <svg width="112" height="140" viewBox="0 0 112 140" aria-hidden="true" style={{ flex: "0 0 auto", borderRadius: 6, border: "1px solid #c9c2ad", background: "#dfe3ec" }}>
          <circle cx="56" cy="52" r="24" fill="#9aa3b8" />
          <path d="M14 140c4-30 22-46 42-46s38 16 42 46z" fill="#9aa3b8" />
          <text x="56" y="58" textAnchor="middle" fontFamily="var(--mono)" fontSize="16" fontWeight="700" fill="#f6f3ea">{initials}</text>
        </svg>
        <div style={{ flex: "1 1 260px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 18px", alignContent: "start" }}>
          {field("Surname", rest.join(" "))}
          {field("Given name", given)}
          {field("Passport no.", p.passportNo)}
          {field("On record since", String(p.memberSince))}
          {field("Verified claims", String(p.summary.verifiedClaims))}
          {field("Paid / denied", `${p.summary.paidOrPartly} / ${p.summary.denied}`)}
          {field("Insurers", String(p.summary.insurers))}
          {field("Issued by", "Verdikt (devnet)")}
        </div>
      </div>
      <div style={{ background: "#ece6d4", borderTop: "1px solid #c9c2ad", padding: "10px 18px", font: "600 13px/1.5 var(--mono)", letterSpacing: "0.12em", color: "#2a2d3a", overflowX: "auto", whiteSpace: "pre" }}>
        {l1}
        {"\n"}
        {l2}
      </div>
    </div>
  );
}

export function PassportApp({ passports }: { passports: PassportView[] }) {
  const [id, setId] = useState(passports[0]?.id ?? "");
  const p = passports.find((x) => x.id === id);
  if (!p) return null;
  return (
    <>
      <Module label="A · Choose a demo passport" right={`${passports.length} demo claimants`}>
        <label className="stack small">
          <span className="label">Claimant</span>
          <select value={id} onChange={(e) => setId(e.target.value)}>
            {passports.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} · {x.passportNo}
              </option>
            ))}
          </select>
        </label>
      </Module>

      <Module label="B · Claimant Passport" right={<><Led tone="ok" /> {p.summary.verifiedClaims} verified claims</>}>
        <PassportCard p={p} />
      </Module>

      <Module label="C · Verified claim history" right={`${p.summary.yearsOnRecord} years on record`}>
        <ul className="steps">
          {p.claims.map((c) => (
            <li key={c.id}>
              <Led tone={c.outcome === "denied" ? "fault" : "ok"} />
              <div className="stack" style={{ gap: 4 }}>
                <span>
                  <b>{c.insurer}</b> <span className="muted">· {c.type} claim · {c.year}</span>{" "}
                  <span className={`tag ${c.outcome === "denied" ? "tag--warn" : "tag--ok"}`}>{OUTCOME[c.outcome] ?? c.outcome}</span>
                </span>
                <span className="small muted" style={{ wordBreak: "break-all" }}>Record hash: {c.hash}</span>
              </div>
            </li>
          ))}
        </ul>
      </Module>
    </>
  );
}
