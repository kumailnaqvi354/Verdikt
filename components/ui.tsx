import type { ReactNode } from "react";

// Small building blocks for the Agent Studio look (styles live in app/globals.css).
// Reuse them in your own pages, or delete this file and bring your own design.

/** A bordered panel with a labelled header strip, e.g. <Module label="A · Prompt">…</Module>. */
export function Module({ label, right, variant, children }: { label: ReactNode; right?: ReactNode; variant?: "diagram" | "inverse"; children: ReactNode }) {
  return (
    <section className={`module${variant ? ` module--${variant}` : ""}`}>
      <div className="module-strip">
        <span>{label}</span>
        {right !== undefined && <span>{right}</span>}
      </div>
      <div className="module-body">{children}</div>
    </section>
  );
}

/** A square status light. Decorative: always pair it with text. */
export function Led({ tone, blink }: { tone?: "signal" | "ok" | "fault"; blink?: boolean }) {
  return <span aria-hidden="true" className={`led${tone ? ` led--${tone}` : ""}${blink ? " led--blink" : ""}`} />;
}

/** The page heading block: a small mono label, a big title and an optional intro. */
export function PageHeader({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children?: ReactNode }) {
  return (
    <header className="stack" style={{ marginBottom: 8 }}>
      <span className="eyebrow">{eyebrow}</span>
      <h1 className="display">{title}</h1>
      {children && <p className="lead">{children}</p>}
    </header>
  );
}

/** A 20-cell meter: purple = spent, green = still available. */
export function Meter({ spent, total, label }: { spent: number; total: number; label: string }) {
  const spentCells = total > 0 ? Math.min(20, Math.round((spent / total) * 20)) : 0;
  return (
    <div className="meter" role="img" aria-label={label}>
      {Array.from({ length: 20 }, (_, i) => (
        <span key={i} className={i < spentCells ? "spent" : "left"} />
      ))}
    </div>
  );
}

/** Links a Solana devnet transaction signature to the public explorer. */
export function ExplorerLink({ signature }: { signature: string }) {
  return (
    <a href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`} target="_blank" rel="noopener noreferrer">
      {signature.slice(0, 8)}…{signature.slice(-8)} ↗
    </a>
  );
}
