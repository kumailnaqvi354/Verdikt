// Shows whether the buyer and seller wallets are ready for devnet payments.
//   npm run wallets
import { address, createSolanaRpc, createKeyPairSignerFromBytes, getBase58Encoder, type Address } from "@solana/kit";
import { USDC_DEVNET_MINT } from "../lib/payments/config";

try {
  process.loadEnvFile(".env.local");
} catch {
  console.warn("No .env.local found; using environment variables only.");
}

const rpc = createSolanaRpc(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com");

async function usdcBalance(owner: Address): Promise<string | null> {
  const { value } = await rpc
    .getTokenAccountsByOwner(owner, { mint: address(USDC_DEVNET_MINT) }, { encoding: "jsonParsed" })
    .send();
  if (value.length === 0) return null; // no USDC token account yet
  const info = value[0].account.data.parsed.info as { tokenAmount: { uiAmountString: string } };
  return info.tokenAmount.uiAmountString;
}

async function report(label: string, owner: Address | null, missingHint: string) {
  if (!owner) {
    console.log(`✗ ${label}: not set. ${missingHint}`);
    return false;
  }
  const balance = await usdcBalance(owner);
  if (balance === null) {
    console.log(`✗ ${label} ${owner}: no devnet USDC account yet. Send it devnet USDC from https://faucet.circle.com`);
    return false;
  }
  console.log(`✓ ${label} ${owner}: ${balance} devnet USDC`);
  return true;
}

async function buyerAddress(): Promise<Address | null> {
  const raw = process.env.AGENT_PRIVATE_KEY?.trim();
  if (!raw) return null;
  const bytes = raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw) as number[]) : new Uint8Array(getBase58Encoder().encode(raw));
  return (await createKeyPairSignerFromBytes(bytes)).address;
}

const payTo = process.env.PAY_TO_ADDRESS?.trim();
const sellerOk = await report("Seller (PAY_TO_ADDRESS)", payTo ? address(payTo) : null, "Run: npm run keygen -- --pay-to");
const buyerOk = await report("Buyer  (AGENT_PRIVATE_KEY)", await buyerAddress(), "Run: npm run keygen");
console.log(
  sellerOk && buyerOk
    ? "\nReady: both wallets can send/receive devnet USDC."
    : "\nNot ready yet. Both wallets need a devnet USDC account: the buyer to pay, the seller to receive.",
);
