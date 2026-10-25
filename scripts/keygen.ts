// Creates a throwaway Solana keypair for DEVNET testing and saves it to .env.local.
//   npm run keygen              -> buyer key: sets AGENT_PRIVATE_KEY (the wallet that pays)
//   npm run keygen -- --pay-to  -> seller address: sets PAY_TO_ADDRESS (where payments arrive)
// Existing values in .env.local are never overwritten.
import { generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { getBase58Decoder } from "@solana/kit";

const ENV_FILE = ".env.local";
const payTo = process.argv.includes("--pay-to");
const key = payTo ? "PAY_TO_ADDRESS" : "AGENT_PRIVATE_KEY";

const current = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
if (new RegExp(`^${key}=\\S+`, "m").test(current)) {
  console.log(`${key} is already set in ${ENV_FILE}; leaving it alone.`);
  process.exit(0);
}

const { privateKey } = generateKeyPairSync("ed25519");
const jwk = privateKey.export({ format: "jwk" });
const seed = Buffer.from(jwk.d!, "base64url");
const pub = Buffer.from(jwk.x!, "base64url");
const base58 = getBase58Decoder();
const address = base58.decode(pub);
const secret = base58.decode(new Uint8Array([...seed, ...pub]));

const line = `${key}=${payTo ? address : secret}`;
const emptyLine = new RegExp(`^${key}=[ \\t]*$`, "m");
const updated = emptyLine.test(current)
  ? current.replace(emptyLine, line) // fill the empty line copied from .env.example
  : `${current}${current && !current.endsWith("\n") ? "\n" : ""}${line}\n`;
writeFileSync(ENV_FILE, updated);

console.log(`Saved ${key} to ${ENV_FILE} (git-ignored). DEVNET USE ONLY.`);
console.log(`Wallet address: ${address}`);
console.log("Next: send it free devnet USDC at https://faucet.circle.com (choose Solana Devnet), then run `npm run wallets`.");
if (payTo) {
  console.log("Secret key (save it only if you want to move these test tokens later):");
  console.log(`  ${secret}`);
}
