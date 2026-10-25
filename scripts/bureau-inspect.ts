// Read-only: decode our team's Operation verification record and show the agent wallet's CRED.
import { address, getAddressDecoder, getAddressEncoder, getProgramDerivedAddress, createSolanaRpc } from "@solana/kit";

const RPC = process.env.BUREAU_RPC_URL || "https://api.devnet.solana.com";
const PROGRAM = address("H2wWqEUUbQ3LJGWLAYyLK8vop4zxeX69r1cXeNpY4XXk");
const CRED_MINT = "AwPoLn4inVqixYn9Uab2JonLBqdKZDC6poXHtjWcBnG3";
const CHALLENGE_ID = (process.argv[2] || "").toLowerCase();
const WALLET = address(process.argv[3] || "EGzaZVRDYGYzCLJk6hq6nRUyYH8kEpq1CH9p6uF4DEMR");

const rpc = createSolanaRpc(RPC);
const [record] = await getProgramDerivedAddress({ programAddress: PROGRAM, seeds: ["claim", CHALLENGE_ID] });
console.log("record PDA:", record);
const info = await rpc.getAccountInfo(record, { encoding: "base64" }).send();
if (!info.value) {
  console.log("record: NOT FOUND (team not seeded on chain yet)");
} else {
  const bytes = Buffer.from(info.value.data[0], "base64");
  console.log("record: owner", info.value.owner, "len", bytes.length);
  console.log("clearance nonce (u64 LE, bytes 41-49):", bytes.readBigUInt64LE(41).toString());
  console.log("clearance account (bytes 49-81):", getAddressDecoder().decode(bytes.subarray(49, 81)));
  console.log("raw hex:", bytes.toString("hex"));
}
const tokens = await rpc.getTokenAccountsByOwner(WALLET, { mint: address(CRED_MINT) }, { encoding: "jsonParsed" }).send();
console.log("wallet SOL:", Number((await rpc.getBalance(WALLET).send()).value) / 1e9);
console.log("wallet CRED accounts:", tokens.value.map((t) => ({ account: t.pubkey, amount: (t.account.data as any).parsed.info.tokenAmount })));
void getAddressEncoder;
