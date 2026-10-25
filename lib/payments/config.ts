import { isAddress } from "@solana/kit";

/** CAIP-2 network id for Solana devnet, as used by x402 V2. */
export const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" as const;

/** Devnet USDC mint (Circle). This is the token x402 charges on devnet. */
export const USDC_DEVNET_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const USDC_DECIMALS = 6;

export const DEFAULT_FACILITATOR_URL = "https://x402.org/facilitator";

/**
 * This starter only ever talks to Solana devnet, where tokens are free test tokens.
 * Moving to mainnet (real money) is deliberately a code change, not an env change.
 */
const ALLOWED_NETWORKS = new Set<string>([SOLANA_DEVNET]);

export class PaymentsConfigError extends Error {}

export function getNetwork(): typeof SOLANA_DEVNET {
  const network = process.env.X402_NETWORK || SOLANA_DEVNET;
  if (!ALLOWED_NETWORKS.has(network)) {
    throw new PaymentsConfigError(
      `X402_NETWORK=${network} is not allowed. This template only supports Solana devnet (${SOLANA_DEVNET}).`,
    );
  }
  return SOLANA_DEVNET;
}

export function getFacilitatorUrl(): string {
  return process.env.X402_FACILITATOR_URL || DEFAULT_FACILITATOR_URL;
}

export function getPayToAddress(): string {
  const payTo = process.env.PAY_TO_ADDRESS?.trim();
  if (!payTo) {
    throw new PaymentsConfigError("PAY_TO_ADDRESS is not set. Add your Solana devnet wallet address to .env.local.");
  }
  if (!isAddress(payTo)) {
    throw new PaymentsConfigError(`PAY_TO_ADDRESS (${payTo}) is not a valid Solana address.`);
  }
  return payTo;
}
