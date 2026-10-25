import type { PaymentPayload, PaymentRequirements, x402Client } from "@x402/fetch";
import { USDC_DECIMALS, USDC_DEVNET_MINT } from "@/lib/payments/config";
import { microsToUsd } from "./policy";
import type { SpendingTracker } from "./tracker";

/**
 * Connects a SpendingTracker to an x402 client:
 *  1. x402's built-in spend controls cap every single payment (defence in depth).
 *  2. Before signing, the tracker must approve the amount, or the payment is aborted.
 *  3. If the payment fails or is not settled, the amount goes back into the budget.
 */
export function attachSpendingLimits(client: x402Client, tracker: SpendingTracker): x402Client {
  if (USDC_DECIMALS !== 6) throw new Error("Spending limits assume a 6-decimal USD stablecoin");

  const byRequirements = new WeakMap<PaymentRequirements, number>();
  const byPayload = new WeakMap<PaymentPayload, number>();

  return client
    .setSpendControls({ maxAmountPerPayment: `$${microsToUsd(tracker.policy.maxPaymentMicros)}` })
    .onBeforePaymentCreation(async ({ selectedRequirements: req }) => {
      // Only devnet USDC is priced in dollars here; refuse anything else rather than guess its value.
      if (req.asset !== USDC_DEVNET_MINT) {
        return { abort: true, reason: `Refusing to pay in unknown asset ${req.asset}` };
      }
      const decision = tracker.tryReserve(BigInt(req.amount));
      if (!decision.ok) return { abort: true, reason: decision.reason };
      byRequirements.set(req, decision.reservationId);
    })
    .onAfterPaymentCreation(async ({ selectedRequirements, paymentPayload }) => {
      const id = byRequirements.get(selectedRequirements);
      if (id !== undefined) byPayload.set(paymentPayload, id);
    })
    .onPaymentCreationFailure(async ({ selectedRequirements }) => {
      const id = byRequirements.get(selectedRequirements);
      if (id !== undefined) tracker.release(id);
    })
    .onPaymentResponse(async ({ paymentPayload, settleResponse, paymentRequired }) => {
      const id = byPayload.get(paymentPayload);
      if (id === undefined) return; // Unknown: keep it counted (safe default).
      if (settleResponse?.success) tracker.commit(id);
      // Rejected at verify or settle: no money moved, so give it back.
      else if (settleResponse || paymentRequired) tracker.release(id);
      // Network error: we can't tell whether it settled, so it stays counted.
    });
}
