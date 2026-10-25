// Offline unit tests for the spending limits. Run: npm run test:spending
import assert from "node:assert/strict";
import { test } from "node:test";
import { microsToUsd, readSpendingPolicy, usdToMicros } from "../lib/spending/policy";
import { SpendingTracker } from "../lib/spending/tracker";

test("dollar parsing is exact", () => {
  assert.equal(usdToMicros("0.01"), 10_000n);
  assert.equal(usdToMicros("1"), 1_000_000n);
  assert.equal(usdToMicros("0.000001"), 1n);
  assert.equal(microsToUsd(250_000n), "0.25");
  assert.equal(microsToUsd(1_000_000n), "1.00");
  assert.throws(() => usdToMicros("-1"));
  assert.throws(() => usdToMicros("0.0000001"));
  assert.throws(() => usdToMicros("abc"));
});

test("policy defaults and validation", () => {
  assert.deepEqual(readSpendingPolicy({}), { budgetMicros: 1_000_000n, maxPaymentMicros: 100_000n });
  assert.throws(() => readSpendingPolicy({ AGENT_BUDGET_USD: "0.05", MAX_PAYMENT_USD: "0.10" }));
  assert.throws(() => readSpendingPolicy({ MAX_PAYMENT_USD: "0" }));
});

test("per-payment cap", () => {
  const t = new SpendingTracker(readSpendingPolicy({ AGENT_BUDGET_USD: "1", MAX_PAYMENT_USD: "0.10" }));
  assert.equal(t.tryReserve(usdToMicros("0.11")).ok, false);
  assert.equal(t.tryReserve(usdToMicros("0.10")).ok, true);
});

test("total budget, release and commit", () => {
  const t = new SpendingTracker(readSpendingPolicy({ AGENT_BUDGET_USD: "0.03", MAX_PAYMENT_USD: "0.01" }));
  const a = t.tryReserve(10_000n);
  const b = t.tryReserve(10_000n);
  const c = t.tryReserve(10_000n);
  assert.ok(a.ok && b.ok && c.ok);
  const d = t.tryReserve(10_000n);
  assert.equal(d.ok, false);
  assert.match(!d.ok ? d.reason : "", /exceed the budget/);

  if (a.ok) t.commit(a.reservationId);
  if (b.ok) t.release(b.reservationId);
  assert.equal(t.snapshot().spentUsd, "0.02");
  assert.equal(t.snapshot().payments, 2);
  assert.equal(t.tryReserve(10_000n).ok, true);
  // Releasing a committed payment does nothing.
  if (a.ok) t.release(a.reservationId);
  assert.equal(t.snapshot().remainingUsd, "0.00");
});
