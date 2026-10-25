import {
  address,
  appendTransactionMessageInstructions,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  getUtf8Encoder,
  type Instruction,
  type KeyPairSigner,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { USDC_DECIMALS, USDC_DEVNET_MINT } from "./config";

// A direct devnet USDC transfer with an optional memo, signed by the agent's wallet
// (AGENT_PRIVATE_KEY). This is what the AI Race's on-chain payment stage asks for:
//
//   const signer = await loadAgentSigner();
//   const { signature } = await payUsdc(signer, { to: "<address>", amountUsdc: 0.01, memo: "<memo from the task>" });
//   return { data: { signature } };
//
// x402 (client.ts) is for paying APIs that answer 402; this is for paying an address directly.
// Devnet only: the agent wallet needs devnet SOL for fees and devnet USDC (see the README; "npm run wallets" checks).

export const MEMO_PROGRAM_ADDRESS = address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const DEFAULT_RPC = "https://api.devnet.solana.com";

/** Optional spending guard (the spending module's SpendingTracker fits this shape). */
export interface SpendGuard {
  tryReserve(amountMicros: bigint): { ok: true; reservationId: number } | { ok: false; reason: string };
  release(reservationId: number): void;
  commit(reservationId: number): void;
}

export interface UsdcTransfer {
  /** Recipient wallet address (not their token account: that's derived, and created if missing). */
  to: string;
  amountUsdc: number;
  memo?: string;
}

export class TransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransferError";
  }
}

export function usdcToMicros(amountUsdc: number): bigint {
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) throw new TransferError("amountUsdc must be a positive number.");
  return BigInt(Math.round(amountUsdc * 10 ** USDC_DECIMALS));
}

/** The instructions for the transfer: create the recipient's USDC account if needed, transfer, memo. */
export async function buildUsdcTransferInstructions(signer: KeyPairSigner, transfer: UsdcTransfer): Promise<Instruction[]> {
  const mint = address(USDC_DEVNET_MINT);
  let to;
  try {
    to = address(transfer.to);
  } catch {
    throw new TransferError(`"${transfer.to}" is not a Solana address.`);
  }
  const [source] = await findAssociatedTokenPda({ owner: signer.address, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const [destination] = await findAssociatedTokenPda({ owner: to, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const instructions: Instruction[] = [
    getCreateAssociatedTokenIdempotentInstruction({ payer: signer, ata: destination, owner: to, mint }),
    getTransferCheckedInstruction({ source, mint, destination, authority: signer, amount: usdcToMicros(transfer.amountUsdc), decimals: USDC_DECIMALS }),
  ];
  if (transfer.memo) {
    instructions.push({ programAddress: MEMO_PROGRAM_ADDRESS, accounts: [], data: new Uint8Array(getUtf8Encoder().encode(transfer.memo)) });
  }
  return instructions;
}

/**
 * Sends the transfer and waits until devnet confirms it. Returns the signature. With a guard,
 * the amount is reserved against your budget first and released if the transfer doesn't land.
 */
export async function payUsdc(signer: KeyPairSigner, transfer: UsdcTransfer, opts: { guard?: SpendGuard; rpcUrl?: string; timeoutMs?: number } = {}): Promise<{ signature: string }> {
  const instructions = await buildUsdcTransferInstructions(signer, transfer);
  const reservation = opts.guard?.tryReserve(usdcToMicros(transfer.amountUsdc));
  if (reservation && !reservation.ok) throw new TransferError(`Payment blocked by your spending limits: ${reservation.reason}`);
  const rpc = createSolanaRpc(opts.rpcUrl ?? process.env.SOLANA_RPC_URL ?? DEFAULT_RPC);
  try {
    const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(signer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions(instructions, m),
    );
    const tx = await signTransactionMessageWithSigners(message);
    const signature = getSignatureFromTransaction(tx);
    await rpc.sendTransaction(getBase64EncodedWireTransaction(tx), { encoding: "base64", preflightCommitment: "confirmed" }).send();
    const deadline = Date.now() + (opts.timeoutMs ?? 45_000);
    for (;;) {
      const { value } = await rpc.getSignatureStatuses([signature]).send();
      const status = value[0];
      if (status?.err) throw new TransferError(`The transfer failed on chain: ${JSON.stringify(status.err)}`);
      if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") break;
      if (Date.now() > deadline) throw new TransferError(`Not confirmed in time (signature ${signature}).`);
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (reservation?.ok) opts.guard!.commit(reservation.reservationId);
    return { signature };
  } catch (err) {
    if (reservation?.ok) opts.guard!.release(reservation.reservationId);
    throw err instanceof TransferError ? err : new TransferError(explain(err));
  }
}

/** Turns an RPC or simulation failure into a message that says what to do. */
function explain(err: unknown): string {
  const e = err as { message?: string; cause?: { message?: string }; context?: { logs?: string[] } };
  const logs = e.context?.logs ?? [];
  const detail = [e.message, e.cause?.message, ...logs.slice(-3)].filter(Boolean).join(" · ");
  if (/no record of a prior credit/i.test(detail)) return `${detail} (the agent wallet has no devnet SOL for fees: get some at faucet.solana.com, then check with "npm run wallets")`;
  if (/insufficient funds|custom program error: 0x1\b/i.test(detail)) return `${detail} (the agent wallet doesn't have enough devnet USDC: get some at faucet.circle.com (Solana Devnet), then check with "npm run wallets")`;
  if (/could not find account|InvalidAccountData|AccountNotFound/i.test(detail)) return `${detail} (the agent wallet has no devnet USDC yet: get some at faucet.circle.com (Solana Devnet), then check with "npm run wallets")`;
  return detail || "The transfer failed.";
}
