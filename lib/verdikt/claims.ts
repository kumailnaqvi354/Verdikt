import "server-only";
import { randomBytes } from "node:crypto";
import {
  appendTransactionMessageInstructions, createSolanaRpc, createTransactionMessage, getBase64EncodedWireTransaction, getSignatureFromTransaction,
  getUtf8Encoder, pipe, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners,
} from "@solana/kit";
import { chatGroq } from "../ai/groq";
import { loadAgentSigner } from "../payments/client";
import { MEMO_PROGRAM_ADDRESS } from "../payments/transfer";
import { addAttestedRecord, INSURERS, recordHash, type ClaimRecord, type ClaimType, type Outcome } from "./data";

// Claim intake: AI turns a decision letter into a structured record; once the claimant confirms it,
// only its SHA-256 hash goes on chain (a memo), never the letter or any personal data.

export type ExtractedClaim = Pick<ClaimRecord, "insurerId" | "type" | "outcome" | "daysToSettle" | "denialReason" | "year">;

const TYPES: ClaimType[] = ["home", "motor", "travel", "pet"];
const OUTCOMES: Outcome[] = ["paid", "partially_paid", "denied"];

export class ClaimError extends Error {}

export async function extractClaim(letter: string): Promise<ExtractedClaim> {
  if (letter.trim().length < 40) throw new ClaimError("Paste the full decision letter (at least a couple of sentences).");
  const reply = await chatGroq(
    [
      {
        role: "system",
        content:
          "You extract the outcome of an insurance claim from a decision letter. Reply with only a JSON object: " +
          `{"insurer": one of ${JSON.stringify(INSURERS.map((i) => i.name))} or null, "type": one of ${JSON.stringify(TYPES)}, "outcome": one of ${JSON.stringify(OUTCOMES)}, ` +
          '"daysToSettle": whole days from the claim being made to the decision (number), "denialReason": short reason if denied or partly paid, else null, "year": year of the decision (number)}. ' +
          "Never include names, addresses, policy numbers or other personal data.",
      },
      { role: "user", content: letter.slice(0, 6000) },
    ],
    { json: true, reasoningEffort: "low" },
  );
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(reply.content ?? "{}");
  } catch {
    throw new ClaimError("The AI couldn't read that letter. Try pasting it again.");
  }
  const insurer = INSURERS.find((i) => i.name.toLowerCase() === String(raw.insurer ?? "").toLowerCase());
  if (!insurer) throw new ClaimError(`The letter isn't from one of the demo insurers (${INSURERS.map((i) => i.name).join(", ")}).`);
  return validate({ insurerId: insurer.id, type: raw.type, outcome: raw.outcome, daysToSettle: raw.daysToSettle, denialReason: raw.denialReason, year: raw.year });
}

/** Checks a record (from the AI or edited by the claimant) before anything is attested. */
export function validate(c: Record<string, unknown>): ExtractedClaim {
  const insurer = INSURERS.find((i) => i.id === c.insurerId);
  const type = TYPES.find((t) => t === c.type);
  const outcome = OUTCOMES.find((o) => o === c.outcome);
  const days = Math.round(Number(c.daysToSettle));
  const year = Math.round(Number(c.year));
  if (!insurer || !type || !outcome) throw new ClaimError("The record needs a demo insurer, a claim type and an outcome.");
  if (!Number.isFinite(days) || days < 0 || days > 1000) throw new ClaimError("Days to settle must be a number between 0 and 1000.");
  if (!Number.isFinite(year) || year < 2000 || year > 2100) throw new ClaimError("Year must be a year.");
  const denialReason = outcome === "paid" ? null : String(c.denialReason ?? "Not stated").slice(0, 80);
  return { insurerId: insurer.id, type, outcome, daysToSettle: days, denialReason, year };
}

/** Writes the record's hash to devnet in a memo, signed by the app's wallet, and adds the record to the store. */
export async function attestClaim(claim: ExtractedClaim): Promise<ClaimRecord> {
  const base = { id: `${claim.insurerId}-u${randomBytes(3).toString("hex")}`, ...claim };
  const hash = recordHash(base);
  const signer = await loadAgentSigner();
  const rpc = createSolanaRpc(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com");
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions([{ programAddress: MEMO_PROGRAM_ADDRESS, accounts: [], data: new Uint8Array(getUtf8Encoder().encode(`verdikt:attest:${hash}`)) }], m),
  );
  const tx = await signTransactionMessageWithSigners(message);
  const signature = getSignatureFromTransaction(tx);
  await rpc.sendTransaction(getBase64EncodedWireTransaction(tx), { encoding: "base64", preflightCommitment: "confirmed" }).send();
  for (let i = 0; i < 45; i++) {
    const status = (await rpc.getSignatureStatuses([signature]).send()).value[0];
    if (status?.err) throw new ClaimError(`The attestation failed on chain: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      const record: ClaimRecord = { ...base, hash, source: "attested", attestation: signature };
      addAttestedRecord(record);
      return record;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new ClaimError(`The attestation wasn't confirmed in time (signature ${signature}).`);
}
