import "server-only";
import { createKeyPairSignerFromBytes, getBase58Encoder, type KeyPairSigner } from "@solana/kit";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { getNetwork, PaymentsConfigError } from "./config";

// Buyer side: a `fetch` that automatically pays when a server answers 402 Payment Required.
// It signs with AGENT_PRIVATE_KEY, so it must only ever run on the server or in a script.

export async function loadAgentSigner(): Promise<KeyPairSigner> {
  const raw = process.env.AGENT_PRIVATE_KEY?.trim();
  if (!raw) {
    throw new PaymentsConfigError(
      "AGENT_PRIVATE_KEY is not set. Create a throwaway devnet keypair (see README) and add it to .env.local.",
    );
  }
  let bytes: Uint8Array;
  try {
    // Accept either the JSON array that `solana-keygen` writes or a base58 string that wallets export.
    bytes = raw.startsWith("[")
      ? Uint8Array.from(JSON.parse(raw) as number[])
      : new Uint8Array(getBase58Encoder().encode(raw));
  } catch {
    throw new PaymentsConfigError("AGENT_PRIVATE_KEY is not valid base58 or a JSON byte array.");
  }
  if (bytes.length !== 64) {
    throw new PaymentsConfigError(`AGENT_PRIVATE_KEY must be a 64-byte secret key (got ${bytes.length} bytes).`);
  }
  return createKeyPairSignerFromBytes(bytes);
}

/** An x402 client that can pay on Solana devnet. Add spending limits before using it. */
export function createPaymentClient(signer: KeyPairSigner): x402Client {
  const rpcUrl = process.env.SOLANA_RPC_URL || undefined;
  return new x402Client().register(getNetwork(), new ExactSvmScheme(signer, rpcUrl ? { rpcUrl } : undefined));
}

export function createPayingFetch(client: x402Client): typeof fetch {
  return wrapFetchWithPayment(fetch, client) as typeof fetch;
}

/** Reads the PAYMENT-RESPONSE header (settlement receipt) from a paid response, if any. */
export function readPaymentReceipt(response: Response) {
  const header = response.headers.get("PAYMENT-RESPONSE");
  return header ? decodePaymentResponseHeader(header) : null;
}

/** If the server still answered 402 after we paid, this says why (e.g. not enough devnet USDC). */
export function readPaymentError(response: Response): string | null {
  if (response.status !== 402) return null;
  const header = response.headers.get("PAYMENT-REQUIRED");
  if (!header) return "Payment required";
  try {
    const reason = decodePaymentRequiredHeader(header).error ?? "Payment required";
    return /insufficient|simulation_failed/.test(reason)
      ? `${reason} (usually a wallet is not funded yet: run "npm run wallets")`
      : reason;
  } catch {
    return "Payment required (could not decode PAYMENT-REQUIRED header)";
  }
}
