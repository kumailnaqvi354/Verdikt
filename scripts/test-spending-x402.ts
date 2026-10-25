// Offline test: the spending limits wired into a real x402 client, against a fake paid server.
// No network, no wallet, no money. Run: npm run test:spending
import assert from "node:assert/strict";
import { test } from "node:test";
import { encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentRequired, SchemeNetworkClient } from "@x402/core/types";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { findDefaultAsset } from "@x402/svm";
import { SOLANA_DEVNET, USDC_DEVNET_MINT } from "../lib/payments/config";
import { attachSpendingLimits } from "../lib/spending/attach";
import { readSpendingPolicy } from "../lib/spending/policy";
import { SpendingTracker } from "../lib/spending/tracker";

/** Signs nothing: just lets us see which payments the client agreed to make. */
const fakeScheme: SchemeNetworkClient = {
  scheme: "exact",
  findDefaultAsset,
  async createPaymentPayload(x402Version) {
    return { x402Version, payload: { transaction: "fake" } };
  },
};

function paymentRequired(amount: string, asset = USDC_DEVNET_MINT): PaymentRequired {
  return {
    x402Version: 2,
    error: "Payment required",
    resource: { url: "http://test/paid", description: "test", mimeType: "application/json" },
    accepts: [{ scheme: "exact", network: SOLANA_DEVNET, asset, amount, payTo: "x", maxTimeoutSeconds: 60, extra: {} }],
  };
}

/** A fake seller: 402 without payment; with payment, settles (or not) according to `settle`. */
function fakeServer(amount: string, settle: "ok" | "reject", asset?: string): typeof fetch {
  return async (input) => {
    const req = input as Request;
    if (!req.headers.get("PAYMENT-SIGNATURE")) {
      return new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(paymentRequired(amount, asset)) } });
    }
    if (settle === "reject") {
      const pr = { ...paymentRequired(amount, asset), error: "insufficient_funds" };
      return new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(pr) } });
    }
    const receipt = encodePaymentResponseHeader({ success: true, transaction: "tx", network: SOLANA_DEVNET });
    return new Response('{"ok":true}', { status: 200, headers: { "PAYMENT-RESPONSE": receipt } });
  };
}

function setup(budget: string, max: string, server: typeof fetch) {
  const tracker = new SpendingTracker(readSpendingPolicy({ AGENT_BUDGET_USD: budget, MAX_PAYMENT_USD: max }));
  const client = attachSpendingLimits(new x402Client().register(SOLANA_DEVNET, fakeScheme), tracker);
  return { tracker, pay: wrapFetchWithPayment(server, client) };
}

test("settled payments count towards the budget until it runs out", async () => {
  const { tracker, pay } = setup("0.03", "0.01", fakeServer("10000", "ok")); // $0.01 each
  for (let i = 0; i < 3; i++) assert.equal((await pay("http://test/paid")).status, 200);
  assert.equal(tracker.snapshot().spentUsd, "0.03");
  await assert.rejects(pay("http://test/paid"), /exceed the budget/);
  assert.equal(tracker.snapshot().payments, 3);
});

test("payments the seller rejects are given back to the budget", async () => {
  const { tracker, pay } = setup("1", "0.10", fakeServer("10000", "reject"));
  assert.equal((await pay("http://test/paid")).status, 402);
  assert.equal(tracker.snapshot().spentUsd, "0.00");
});

test("a price above the per-payment cap is refused before signing", async () => {
  const { tracker, pay } = setup("1", "0.05", fakeServer("60000", "ok")); // $0.06
  await assert.rejects(pay("http://test/paid"), /maxAmountPerPayment|per-payment cap/);
  assert.equal(tracker.snapshot().spentUsd, "0.00");
});

test("unknown tokens are refused", async () => {
  const otherMint = "So11111111111111111111111111111111111111112";
  const { tracker, pay } = setup("1", "0.10", fakeServer("1", "ok", otherMint));
  await assert.rejects(pay("http://test/paid"));
  assert.equal(tracker.snapshot().payments, 0);
});
