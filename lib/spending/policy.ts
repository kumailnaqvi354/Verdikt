// Reads spending limits from env. Amounts are in US dollars (paid as USDC, 6 decimals).

export interface SpendingPolicy {
  /** Total allowed spend, in micro-dollars (1 USD = 1_000_000). */
  budgetMicros: bigint;
  /** Largest single payment, in micro-dollars. */
  maxPaymentMicros: bigint;
}

const DEFAULT_BUDGET_USD = "1.00";
const DEFAULT_MAX_PAYMENT_USD = "0.10";

/** "0.25" -> 250000n. Rejects negatives, more than 6 decimals and non-numbers. */
export function usdToMicros(usd: string): bigint {
  const value = usd.trim();
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) throw new Error(`"${usd}" is not a valid dollar amount (e.g. 0.25)`);
  const [, whole, frac = ""] = match;
  return BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, "0"));
}

/** 250000n -> "0.25" */
export function microsToUsd(micros: bigint): string {
  const whole = micros / 1_000_000n;
  const frac = (micros % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${whole}.${frac}`;
}

export function readSpendingPolicy(env: Record<string, string | undefined> = process.env): SpendingPolicy {
  const budgetMicros = usdToMicros(env.AGENT_BUDGET_USD || DEFAULT_BUDGET_USD);
  const maxPaymentMicros = usdToMicros(env.MAX_PAYMENT_USD || DEFAULT_MAX_PAYMENT_USD);
  if (maxPaymentMicros <= 0n) throw new Error("MAX_PAYMENT_USD must be greater than 0");
  if (maxPaymentMicros > budgetMicros) throw new Error("MAX_PAYMENT_USD cannot be larger than AGENT_BUDGET_USD");
  return { budgetMicros, maxPaymentMicros };
}
