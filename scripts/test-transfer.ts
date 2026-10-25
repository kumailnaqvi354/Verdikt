// Offline tests for lib/payments/transfer.ts (no network). Run: npm run test:transfer
import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPairSigner } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { buildUsdcTransferInstructions, MEMO_PROGRAM_ADDRESS, payUsdc, TransferError, usdcToMicros } from "../lib/payments/transfer";

test("builds create-account, transfer and memo instructions", async () => {
  const signer = await generateKeyPairSigner();
  const to = (await generateKeyPairSigner()).address;
  const ixs = await buildUsdcTransferInstructions(signer, { to, amountUsdc: 0.01, memo: "agent-studio-abc" });
  assert.equal(ixs.length, 3);
  assert.equal(ixs[1].programAddress, TOKEN_PROGRAM_ADDRESS);
  assert.equal(ixs[2].programAddress, MEMO_PROGRAM_ADDRESS);
  assert.equal(new TextDecoder().decode(Uint8Array.from(ixs[2].data ?? [])), "agent-studio-abc");
  assert.equal(usdcToMicros(0.01), 10_000n);
  assert.equal((await buildUsdcTransferInstructions(signer, { to, amountUsdc: 1 })).length, 2);
});

test("rejects bad input before touching the network", async () => {
  const signer = await generateKeyPairSigner();
  await assert.rejects(buildUsdcTransferInstructions(signer, { to: "not-an-address", amountUsdc: 1 }), TransferError);
  await assert.rejects(buildUsdcTransferInstructions(signer, { to: signer.address, amountUsdc: 0 }), TransferError);
});

test("a spending guard can block the payment", async () => {
  const signer = await generateKeyPairSigner();
  const guard = { tryReserve: () => ({ ok: false as const, reason: "over budget" }), release: () => {}, commit: () => {} };
  await assert.rejects(payUsdc(signer, { to: signer.address, amountUsdc: 5 }, { guard }), /spending limits: over budget/);
});
