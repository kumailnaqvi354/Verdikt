// Operation challenge: send CRED from the agent wallet to our team's clearance account.
//   npx tsx --env-file=.env.local --conditions=react-server scripts/bureau-send.ts <challengeId> <rawAmount> [memo] [--send]
// <rawAmount> is in base units (CRED has 6 decimals). Without --send it only prints the plan.
import {
  address, appendTransactionMessageInstructions, createSolanaRpc, createTransactionMessage, getAddressDecoder,
  getBase64EncodedWireTransaction, getProgramDerivedAddress, getSignatureFromTransaction, getUtf8Encoder, pipe,
  setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners, type Instruction,
} from "@solana/kit";
import { findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstruction, getTransferCheckedInstruction, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { loadAgentSigner } from "../lib/payments/client";
import { MEMO_PROGRAM_ADDRESS } from "../lib/payments/transfer";

const RPC = process.env.BUREAU_RPC_URL || "https://api.devnet.solana.com";
const PROGRAM = address("H2wWqEUUbQ3LJGWLAYyLK8vop4zxeX69r1cXeNpY4XXk");
const CRED_MINT = address("AwPoLn4inVqixYn9Uab2JonLBqdKZDC6poXHtjWcBnG3");
const CRED_DECIMALS = 6;

const args = process.argv.slice(2).filter((a) => a !== "--send");
const send = process.argv.includes("--send");
const [challengeId, rawAmount, memo] = args;
if (!challengeId || !rawAmount) throw new Error("usage: bureau-send.ts <challengeId> <rawAmount> [memo] [--send]");

const rpc = createSolanaRpc(RPC);
const signer = await loadAgentSigner();
const [record] = await getProgramDerivedAddress({ programAddress: PROGRAM, seeds: ["claim", challengeId.toLowerCase()] });
const info = await rpc.getAccountInfo(record, { encoding: "base64" }).send();
if (!info.value) throw new Error(`No verification record at ${record}: the team isn't seeded on chain yet.`);
const bytes = Buffer.from(info.value.data[0], "base64");
const nonce = bytes.readBigUInt64LE(41);
const clearance = getAddressDecoder().decode(bytes.subarray(49, 81));

// The clearance account may itself be a CRED token account, or a wallet whose CRED account we derive.
const target = await rpc.getAccountInfo(clearance, { encoding: "base64" }).send();
const isTokenAccount = target.value?.owner === TOKEN_PROGRAM_ADDRESS;
const [source] = await findAssociatedTokenPda({ owner: signer.address, mint: CRED_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS });
const destination = isTokenAccount ? clearance : (await findAssociatedTokenPda({ owner: clearance, mint: CRED_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0];

const instructions: Instruction[] = [
  ...(isTokenAccount ? [] : [getCreateAssociatedTokenIdempotentInstruction({ payer: signer, ata: destination, owner: clearance, mint: CRED_MINT })]),
  getTransferCheckedInstruction({ source, mint: CRED_MINT, destination, authority: signer, amount: BigInt(rawAmount), decimals: CRED_DECIMALS }),
  ...(memo ? [{ programAddress: MEMO_PROGRAM_ADDRESS, accounts: [], data: new Uint8Array(getUtf8Encoder().encode(memo)) }] : []),
];

console.log({ record, nonce: nonce.toString(), clearance, clearanceIsTokenAccount: isTokenAccount, source, destination, rawAmount, memo: memo ?? null, signer: signer.address });
if (!send) {
  console.log("Dry run. Add --send to send it.");
  process.exit(0);
}

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
for (let i = 0; i < 45; i++) {
  const status = (await rpc.getSignatureStatuses([signature]).send()).value[0];
  if (status?.err) throw new Error(`Failed on chain: ${JSON.stringify(status.err)}`);
  if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
    console.log("confirmed:", signature);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 1000));
}
throw new Error(`Not confirmed in time: ${signature}`);
