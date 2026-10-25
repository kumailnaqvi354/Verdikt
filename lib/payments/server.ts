import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import { NextResponse as Res } from "next/server";
import { withX402, x402ResourceServer } from "@x402/next";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { getFacilitatorUrl, getNetwork, getPayToAddress, PaymentsConfigError } from "./config";

// Seller side: protects a route handler so callers must pay before they get the response.
// The facilitator checks the payment and submits it to Solana devnet.

let resourceServer: x402ResourceServer | null = null;

function getResourceServer(): x402ResourceServer {
  resourceServer ??= new x402ResourceServer(
    new HTTPFacilitatorClient({ url: getFacilitatorUrl() }),
  ).register(getNetwork(), new ExactSvmScheme());
  return resourceServer;
}

export interface PaidRouteOptions {
  /** Price in US dollars, e.g. "$0.01". Paid in devnet USDC. */
  price: string;
  description: string;
}

type Handler = (request: NextRequest) => Promise<NextResponse>;

/**
 * Wraps a route handler with an x402 paywall.
 *
 * Built lazily on the first request so `next build` works without any env vars,
 * and payment is only settled if the handler responds with status < 400.
 */
export function paidRoute(handler: Handler, options: () => PaidRouteOptions): Handler {
  let wrapped: Handler | null = null;
  return async (request) => {
    try {
      if (!wrapped) {
        const { price, description } = options();
        wrapped = withX402(
          handler,
          {
            accepts: [{ scheme: "exact", price, network: getNetwork(), payTo: getPayToAddress() }],
            description,
          },
          getResourceServer(),
        );
      }
    } catch (err) {
      if (err instanceof PaymentsConfigError) {
        return Res.json({ error: err.message }, { status: 500 });
      }
      throw err;
    }
    return wrapped(request);
  };
}
