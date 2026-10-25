// Minesweeper challenge: call the bureau program's mint_code (no IDL, Anchor-style) plus an SPL Memo.
//   npx tsx --env-file=.env.local --conditions=react-server scripts/bureau-mint.ts <challengeId> [order] [--send]
// <order> is a comma list of the main accounts, e.g. signer,config,holdings,deed,ixsysvar,system.
// Without --send it only simulates and prints the program logs.
import { createHash } from "node:crypto";
import {
  AccountRole, address, appendTransactionMessageInstructions, createSolanaRpc, createTransactionMessage, getAddressDecoder,
  getBase64EncodedWireTransaction, getProgramDerivedAddress, getSignatureFromTransaction, getUtf8Encoder, pipe,
  setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners, type Instruction, type Signature,
} from "@solana/kit";
import { findAssociatedTokenPda, getTransferCheckedInstruction, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { loadAgentSigner } from "../lib/payments/client";
import { MEMO_PROGRAM_ADDRESS } from "../lib/payments/transfer";

const RPC = process.env.BUREAU_RPC_URL || "https://api.devnet.solana.com";
const PROGRAM = address("H2wWqEUUbQ3LJGWLAYyLK8vop4zxeX69r1cXeNpY4XXk");
const SALT = "830797a34fd3";
const IX_SYSVAR = address("Sysvar1nstructions1111111111111111111111111");
const SYSTEM = address("11111111111111111111111111111111");
const CRED_MINT = address("AwPoLn4inVqixYn9Uab2JonLBqdKZDC6poXHtjWcBnG3");
const PRESENTATION = address("HdMsqBdAW8mbrhJzHztqr1XVP1km3fXWHm7u8DpJeD9e");

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const send = process.argv.includes("--send");
const [challengeId, orderArg] = args;
if (!challengeId) throw new Error("usage: bureau-mint.ts <challengeId> [order] [--send]");
const order = (orderArg || "signer,holdings,deed,ixsysvar,system").split(",");

const rpc = createSolanaRpc(RPC);
const signer = await loadAgentSigner();
const pda = async (...seeds: string[]) => (await getProgramDerivedAddress({ programAddress: PROGRAM, seeds })) [0];
const config = await pda("config");
const holdings = await pda("holdings", challengeId);
const deed = await pda("deed", challengeId);

const holdingsInfo = await rpc.getAccountInfo(holdings, { encoding: "base64" }).send();
if (!holdingsInfo.value) throw new Error(`No holdings record at ${holdings}: the team isn't seeded.`);
const registrar = getAddressDecoder().decode(Buffer.from(holdingsInfo.value.data[0], "base64").subarray(8, 40));

const memoHash = createHash("sha256").update(Buffer.from(challengeId + SALT, "utf8")).digest();
const disc = createHash("sha256").update("global:mint_code").digest().subarray(0, 8);
const idBytes = Buffer.from(challengeId, "utf8");
const len = Buffer.alloc(4);
len.writeUInt32LE(idBytes.length);
const data = Buffer.concat([disc, len, idBytes, memoHash]);

const roles: Record<string, { address: ReturnType<typeof address>; role: AccountRole; signer?: typeof signer }> = {
  signer: { address: signer.address, role: AccountRole.WRITABLE_SIGNER, signer },
  config: { address: config, role: AccountRole.READONLY },
  holdings: { address: holdings, role: AccountRole.WRITABLE },
  deed: { address: deed, role: AccountRole.WRITABLE },
  ixsysvar: { address: IX_SYSVAR, role: AccountRole.READONLY },
  system: { address: SYSTEM, role: AccountRole.READONLY },
};
const accounts = [...order.map((k) => roles[k]), { address: registrar, role: AccountRole.READONLY }];
const instructions: Instruction[] = [
  { programAddress: PROGRAM, accounts: accounts as never, data: new Uint8Array(data) },
  { programAddress: MEMO_PROGRAM_ADDRESS, accounts: [], data: new Uint8Array(getUtf8Encoder().encode(memoHash.toString("hex"))) },
];
console.log({ config, holdings, deed, registrar, registrarIsSigner: registrar === signer.address, memoHex: memoHash.toString("hex"), order });

const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
const message = pipe(
  createTransactionMessage({ version: 0 }),
  (m) => setTransactionMessageFeePayerSigner(signer, m),
  (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
  (m) => appendTransactionMessageInstructions(instructions, m),
);
const tx = await signTransactionMessageWithSigners(message);
const wire = getBase64EncodedWireTransaction(tx);

if (!send) {
  const sim = await rpc.simulateTransaction(wire, { encoding: "base64", commitment: "confirmed" }).send();
  console.log("simulation err:", JSON.stringify(sim.value.err, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  console.log((sim.value.logs ?? []).join("\n"));
  process.exit(0);
}

const big = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);
async function sendAndConfirm(signed: typeof tx): Promise<Signature> {
  const sig = getSignatureFromTransaction(signed);
  await rpc.sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: "base64", preflightCommitment: "confirmed" }).send();
  for (let i = 0; i < 45; i++) {
    const status = (await rpc.getSignatureStatuses([sig]).send()).value[0];
    if (status?.err) throw new Error(`Failed on chain: ${JSON.stringify(status.err, big)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return sig;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Not confirmed in time: ${sig}`);
}

const signature = await sendAndConfirm(tx);
const d = await rpc.getAccountInfo(deed, { encoding: "base64", commitment: "confirmed" }).send();
const b = Buffer.from(d.value!.data[0], "base64");
const n = b.readUInt32LE(8);
const code = b.subarray(12 + n, 20 + n).toString("utf8");
const issuedSlot = b.readBigUInt64LE(20 + n);
console.log("minted:", signature, { operative: b.subarray(12, 12 + n).toString("utf8"), code, issuedSlot: issuedSlot.toString() });

if (process.argv.includes("--present")) {
  // Present at once (Fast hands: within ~150 slots): 1 base unit of CRED to the presentation account, memo "<id>:<code>".
  const [source] = await findAssociatedTokenPda({ owner: signer.address, mint: CRED_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const { value: bh } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const present = await signTransactionMessageWithSigners(
    pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(signer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(bh, m),
      (m) =>
        appendTransactionMessageInstructions(
          [
            getTransferCheckedInstruction({ source, mint: CRED_MINT, destination: PRESENTATION, authority: signer, amount: BigInt(1), decimals: 6 }),
            { programAddress: MEMO_PROGRAM_ADDRESS, accounts: [], data: new Uint8Array(getUtf8Encoder().encode(`${challengeId}:${code}`)) },
          ],
          m,
        ),
    ),
  );
  const presented = await sendAndConfirm(present);
  const tx2 = await rpc.getTransaction(presented, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }).send();
  console.log("presented:", presented, { memo: `${challengeId}:${code}`, slotsAfterMint: tx2 ? (BigInt(tx2.slot) - issuedSlot).toString() : "unknown" });
}
