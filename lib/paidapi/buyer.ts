import "server-only";
import {
  createPaymentClient,
  createPayingFetch,
  loadAgentSigner,
  readPaymentError,
  readPaymentReceipt,
} from "@/lib/payments/client";
import { attachSpendingLimits } from "@/lib/spending/attach";
import { readSpendingPolicy } from "@/lib/spending/policy";
import { SpendingTracker, type SpendingSnapshot } from "@/lib/spending/tracker";

// The "agent" that buys from paid APIs. One per server process, so the budget
// is shared by every request until the process restarts.

let tracker: SpendingTracker | null = null;
let payingFetch: Promise<typeof fetch> | null = null;

export function getSpendingTracker(): SpendingTracker {
  tracker ??= new SpendingTracker(readSpendingPolicy());
  return tracker;
}

async function getPayingFetch(): Promise<typeof fetch> {
  payingFetch ??= loadAgentSigner()
    .then((signer) => createPayingFetch(attachSpendingLimits(createPaymentClient(signer), getSpendingTracker())))
    .catch((err) => {
      payingFetch = null; // let the next call retry after .env.local is fixed
      throw err;
    });
  return payingFetch;
}

export interface PurchaseResult {
  status: number;
  /** Set when the seller rejected our payment, e.g. "insufficient_funds". */
  paymentError: string | null;
  data: unknown;
  receipt: ReturnType<typeof readPaymentReceipt>;
  spending: SpendingSnapshot;
}

export async function buy(url: string): Promise<PurchaseResult> {
  const pay = await getPayingFetch();
  const response = await pay(url);
  const text = await response.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {}
  return {
    status: response.status,
    paymentError: readPaymentError(response),
    data,
    receipt: readPaymentReceipt(response),
    spending: getSpendingTracker().snapshot(),
  };
}
