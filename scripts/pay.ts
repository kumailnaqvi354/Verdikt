// Command-line buyer: pays for a x402-protected URL using AGENT_PRIVATE_KEY from .env.local.
//   npm run pay                                  -> buys http://localhost:3000/api/premium
//   npm run pay -- http://localhost:3000/api/premium 3   -> buys 3 times (watch the budget)
import { buy } from "../lib/paidapi/buyer";

try {
  process.loadEnvFile(".env.local");
} catch {
  console.warn("No .env.local found; using environment variables only.");
}

const url = process.argv[2] ?? "http://localhost:3000/api/premium";
const times = Number(process.argv[3] ?? 1);

for (let i = 1; i <= times; i++) {
  try {
    const result = await buy(url);
    console.log(`#${i} status ${result.status}`);
    if (result.paymentError) console.log("  payment rejected:", result.paymentError);
    console.log("  data:", result.data);
    if (result.receipt) console.log("  receipt:", result.receipt);
    console.log("  spending:", result.spending);
  } catch (err) {
    console.error(`#${i} refused/failed:`, err instanceof Error ? err.message : err);
    process.exitCode = 1;
    break;
  }
}
