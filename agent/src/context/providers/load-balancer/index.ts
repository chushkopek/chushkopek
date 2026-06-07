import type { ContextProvider, ProviderSlice } from "../../types.js";
import { stubsEnabled } from "../../../stubs.js";

/**
 * Load-balancer provider — in-cluster ingress traffic logs: request rates,
 * error breakdown, latency, top offending routes. Owner: Iva. Replace the stub
 * with real ingress/LB log queries.
 */

export interface LoadBalancerSlice {
  healthyTargets: number;
  totalTargets: number;
  observations: string[];
  topOffendingRoute: { route: string; method: string; errorRate: string };
}

/** The function-call seam: replace with a real LB/ingress log client. */
export interface LoadBalancerSource {
  inspect(service: string): Promise<LoadBalancerSlice>;
}

function createStubLoadBalancerSource(): LoadBalancerSource {
  return {
    async inspect(): Promise<LoadBalancerSlice> {
      return {
        healthyTargets: 0,
        totalTargets: 3,
        observations: [
          "5xx concentrated on POST /profile (98% of errors).",
          "All 3 storefront targets unhealthy since 14:03Z.",
          "Requests carry oversized HTML payloads in the `bio` field.",
        ],
        topOffendingRoute: {
          route: "/profile",
          method: "POST",
          errorRate: "96%",
        },
      };
    },
  };
}

const source = createStubLoadBalancerSource();

export const provider: ContextProvider<LoadBalancerSlice> = {
  name: "load-balancer",
  label: "Load Balancer Traffic",
  order: 40,
  // Simulated stub. Runs only in demo mode (ENABLE_STUBS=1), and even then
  // stands down when the real context-fetcher supplies live ingress/Loki signals.
  enabled: () => stubsEnabled() && !process.env.CONTEXT_FETCHER_URL?.trim(),
  async gather(ctx): Promise<ProviderSlice<LoadBalancerSlice>> {
    try {
      const data = await source.inspect("storefront");
      return {
        source: "load-balancer",
        status: "ok",
        simulated: true,
        data,
        summary:
          "0/3 targets healthy; errors concentrated on POST /profile with oversized " +
          "`bio` payloads.",
      };
    } catch (err) {
      return {
        source: "load-balancer",
        status: "error",
        summary: "Failed to read load-balancer traffic.",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
