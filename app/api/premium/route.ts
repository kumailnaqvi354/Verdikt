import { NextResponse } from "next/server";
import { paidRoute } from "@/lib/payments/server";

export const dynamic = "force-dynamic";

const FACTS = [
  "Solana devnet tokens have no monetary value: perfect for testing.",
  "HTTP status 402 'Payment Required' was reserved in 1997 and finally has a use.",
  "x402 lets a program pay for an API call without accounts, cards or API keys.",
];

// This is the thing you are selling. Replace it with your own data or AI output.
async function handler() {
  return NextResponse.json({
    fact: FACTS[Math.floor(Math.random() * FACTS.length)],
    servedAt: new Date().toISOString(),
  });
}

export const GET = paidRoute(handler, () => ({
  price: `$${process.env.PAID_API_PRICE_USD || "0.01"}`,
  description: "One premium fact",
}));
