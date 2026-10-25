"use client";

import { useEffect, useState } from "react";
import { ExplorerLink, Led, Meter, Module, PageHeader } from "@/components/ui";

type Spending = { budgetUsd: string; maxPaymentUsd: string; spentUsd: string; payments: number };
type Receipt = { success?: boolean; transaction?: string; payer?: string; network?: string };
type Purchase = { status?: number; paymentError?: string | null; data?: unknown; receipt?: Receipt | null; spending?: Spending | null; error?: string };
type Quote = { status: number; price?: string; payTo?: string; network?: string };

export default function PremiumPage() {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [spending, setSpending] = useState<Spending | null>(null);
  const [loading, setLoading] = useState<"quote" | "buy" | null>(null);

  useEffect(() => {
    fetch("/api/buy")
      .then((r) => r.json())
      .then((d: Purchase) => d.spending && setSpending(d.spending))
      .catch(() => {});
  }, []);

  // Step 1: call the paid API without paying, to see the 402 and its PAYMENT-REQUIRED header.
  async function tryWithoutPaying() {
    setLoading("quote");
    try {
      const res = await fetch("/api/premium");
      const header = res.headers.get("PAYMENT-REQUIRED");
      const required = header ? JSON.parse(atob(header)) : null;
      const offer = required?.accepts?.[0];
      setQuote({
        status: res.status,
        // USDC has 6 decimals: 10000 atomic units = $0.01.
        price: offer?.amount ? `$${(Number(offer.amount) / 1e6).toFixed(2)}` : undefined,
        payTo: offer?.payTo,
        network: offer?.network,
      });
    } finally {
      setLoading(null);
    }
  }

  // Step 2: ask our server-side agent to pay for it (its devnet key never leaves the server).
  async function buyAsAgent() {
    setLoading("buy");
    try {
      const res = await fetch("/api/buy", { method: "POST" });
      const data = (await res.json()) as Purchase;
      setPurchase(data);
      if (data.spending) setSpending(data.spending);
    } finally {
      setLoading(null);
    }
  }

  const paid = purchase?.status === 200 && purchase.receipt?.success;
  const failed = purchase && !paid;

  return (
    <>
      <PageHeader eyebrow="Module · Paid API" title={<>Pay per<br />request.</>}>
        <code>/api/premium</code> costs a few cents of <strong>devnet test USDC</strong> per call (no real money). It answers
        HTTP 402 with a price until someone pays.
      </PageHeader>

      <div className="cols">
        <Module label="A · Ask for the price" right={quote ? <><Led tone="signal" /> HTTP {quote.status}</> : "Step 1"}>
          <p className="small muted" style={{ margin: 0 }}>Call the paid API without paying and look at what comes back.</p>
          <div className="row">
            <button className="btn btn--secondary" onClick={tryWithoutPaying} disabled={loading !== null}>
              {loading === "quote" ? "Calling…" : "Call without paying"}
            </button>
          </div>
          {quote && (
            <dl className="kv" aria-live="polite">
              <dt>Status</dt>
              <dd>{quote.status === 402 ? "402 Payment Required" : quote.status}</dd>
              {quote.price && (<><dt>Price</dt><dd>{quote.price} USDC</dd></>)}
              {quote.payTo && (<><dt>Pay to</dt><dd>{quote.payTo}</dd></>)}
              {quote.network && (<><dt>Network</dt><dd>{quote.network}</dd></>)}
            </dl>
          )}
          {quote && quote.status === 500 && (
            <p className="notice" style={{ margin: 0 }}>The server isn&apos;t set up to charge yet: set <code>PAY_TO_ADDRESS</code> in <code>.env.local</code>.</p>
          )}
        </Module>

        <Module label="B · Let the agent pay" right={paid ? <><Led tone="ok" /> Paid</> : failed ? <><Led tone="fault" /> Not paid</> : "Step 2"}>
          <p className="small muted" style={{ margin: 0 }}>
            The server-side agent pays with its own devnet key, inside the spending limits, then fetches the data.
          </p>
          <div className="row">
            <button className="btn btn--primary" onClick={buyAsAgent} disabled={loading !== null}>
              {loading === "buy" ? "Paying…" : "Let the agent pay ▸"}
            </button>
          </div>
          <div aria-live="polite" className="stack">
            {paid && purchase?.receipt?.transaction && (
              <>
                <p className="notice notice--ok" style={{ margin: 0 }}>
                  Payment settled on Solana devnet: <ExplorerLink signature={purchase.receipt.transaction} />
                </p>
                <pre className="code">{JSON.stringify(purchase.data, null, 2)}</pre>
              </>
            )}
            {failed && (
              <p className="notice notice--fault" style={{ margin: 0 }}>
                {purchase?.error ?? purchase?.paymentError ?? `The paid API answered ${purchase?.status}.`}
              </p>
            )}
          </div>
        </Module>
      </div>

      {spending && (
        <Module label="Agent spending limits" right={`${spending.payments} ${spending.payments === 1 ? "payment" : "payments"}`}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="label">Spent of budget</span>
            <span className="metric">
              ${spending.spentUsd} <span className="muted" style={{ fontSize: 16 }}>/ ${spending.budgetUsd}</span>
            </span>
          </div>
          <Meter spent={Number(spending.spentUsd)} total={Number(spending.budgetUsd)} label={`Spent $${spending.spentUsd} of $${spending.budgetUsd}`} />
          <span className="small muted">
            Never more than ${spending.maxPaymentUsd} per payment. Change the limits with <code>AGENT_BUDGET_USD</code> and{" "}
            <code>MAX_PAYMENT_USD</code>.
          </span>
        </Module>
      )}
    </>
  );
}
