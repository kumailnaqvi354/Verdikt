import { microsToUsd, type SpendingPolicy } from "./policy";

export type SpendDecision = { ok: true; reservationId: number } | { ok: false; reason: string };

export interface SpendingSnapshot {
  budgetUsd: string;
  maxPaymentUsd: string;
  spentUsd: string;
  remainingUsd: string;
  payments: number;
}

/**
 * Keeps a running total of what has been spent and refuses payments that would
 * break the policy. A payment is reserved *before* it is signed and only released
 * again if it definitely failed, so the total can never be under-counted.
 *
 * State lives in memory: it resets when the process restarts.
 */
export class SpendingTracker {
  private spent = 0n;
  private payments = 0;
  private nextId = 1;
  private readonly reservations = new Map<number, bigint>();

  constructor(readonly policy: SpendingPolicy) {}

  tryReserve(amountMicros: bigint): SpendDecision {
    if (amountMicros <= 0n) return { ok: false, reason: "Payment amount must be positive" };
    if (amountMicros > this.policy.maxPaymentMicros) {
      return {
        ok: false,
        reason: `Payment of $${microsToUsd(amountMicros)} is above the per-payment cap of $${microsToUsd(this.policy.maxPaymentMicros)}`,
      };
    }
    if (this.spent + amountMicros > this.policy.budgetMicros) {
      return {
        ok: false,
        reason: `Payment of $${microsToUsd(amountMicros)} would exceed the budget ($${microsToUsd(this.remaining())} left of $${microsToUsd(this.policy.budgetMicros)})`,
      };
    }
    const reservationId = this.nextId++;
    this.reservations.set(reservationId, amountMicros);
    this.spent += amountMicros;
    this.payments++;
    return { ok: true, reservationId };
  }

  /** Gives the money back to the budget, e.g. when the payment was never settled. */
  release(reservationId: number): void {
    const amount = this.reservations.get(reservationId);
    if (amount === undefined) return;
    this.reservations.delete(reservationId);
    this.spent -= amount;
    this.payments--;
  }

  /** Marks a reservation as final (settled on-chain). */
  commit(reservationId: number): void {
    this.reservations.delete(reservationId);
  }

  remaining(): bigint {
    return this.policy.budgetMicros - this.spent;
  }

  snapshot(): SpendingSnapshot {
    return {
      budgetUsd: microsToUsd(this.policy.budgetMicros),
      maxPaymentUsd: microsToUsd(this.policy.maxPaymentMicros),
      spentUsd: microsToUsd(this.spent),
      remainingUsd: microsToUsd(this.remaining()),
      payments: this.payments,
    };
  }
}
