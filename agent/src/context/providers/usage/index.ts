import type { ContextProvider, ProviderSlice } from "../../types.js";
import { stubsEnabled } from "../../../stubs.js";

/**
 * Usage provider — answers "is this organic load (e.g. Black Friday) or
 * something else?". Owner: Kalata. Replace the stub with real product-analytics
 * queries (PostHog, etc.) comparing current traffic to baseline.
 */

export interface UsageSlice {
  classification: "organic_surge" | "likely_attack" | "inconclusive";
  rationale: string;
  metrics: {
    requestsPerMin: number;
    baselineRequestsPerMin: number;
    uniqueIps: number;
    geoSpread: string;
  };
}

/** The function-call seam: replace with real analytics queries. */
export interface UsageSource {
  classify(service: string): Promise<UsageSlice>;
}

function createStubUsageSource(): UsageSource {
  return {
    async classify(): Promise<UsageSlice> {
      return {
        classification: "likely_attack",
        rationale:
          "Overall traffic is within normal baseline (no surge), but a tight " +
          "cluster of crafted POST /profile requests from a handful of IPs " +
          "coincides exactly with the crash. Not organic growth.",
        metrics: {
          requestsPerMin: 1320,
          baselineRequestsPerMin: 1250,
          uniqueIps: 6,
          geoSpread: "single ASN, 6 IPs",
        },
      };
    },
  };
}

const source = createStubUsageSource();

export const provider: ContextProvider<UsageSlice> = {
  name: "usage",
  label: "Application Usage",
  order: 30,
  // Simulated stub (hardcoded traffic verdict) — only runs in demo mode.
  enabled: () => stubsEnabled(),
  async gather(ctx): Promise<ProviderSlice<UsageSlice>> {
    try {
      const data = await source.classify("storefront");
      return {
        source: "usage",
        status: "ok",
        simulated: true,
        data,
        summary:
          "Traffic is at baseline — NOT a real surge. A small cluster of crafted " +
          "requests lines up with the crash: looks like exploitation, not load.",
      };
    } catch (err) {
      return {
        source: "usage",
        status: "error",
        summary: "Failed to classify application usage.",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
