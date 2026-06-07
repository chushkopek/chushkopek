import type { ContextProvider, ProviderSlice } from "../../types.js";
import { stubsEnabled } from "../../../stubs.js";

/**
 * Grafana provider — metrics & dashboards around the incident window.
 * Owner: Mitko. Replace the stub with real Grafana/Prometheus queries.
 */

export interface GrafanaSlice {
  window: string;
  panels: { title: string; observation: string }[];
  dashboards: { name: string; url: string }[];
}

/** The function-call seam: replace with real Grafana/Prometheus client calls. */
export interface GrafanaSource {
  /** @param service service name from the trigger, used to scope queries. */
  query(service: string): Promise<GrafanaSlice>;
}

function createStubGrafanaSource(): GrafanaSource {
  return {
    async query(): Promise<GrafanaSlice> {
      return {
        window: "2026-06-07T13:50Z – 14:10Z",
        panels: [
          { title: "HTTP 5xx rate", observation: "0.3% → 47% starting 14:02Z" },
          { title: "Memory (working set)", observation: "210MB → 1.4GB then OOM" },
          { title: "Pod restarts", observation: "0 → 7 in 6 minutes" },
          { title: "Request latency p99", observation: "180ms → 4.2s on POST /profile" },
        ],
        dashboards: [
          {
            name: "storefront / overview",
            url: "https://grafana.acme.internal/d/storefront/overview",
          },
        ],
      };
    },
  };
}

const source = createStubGrafanaSource();

export const provider: ContextProvider<GrafanaSlice> = {
  name: "grafana",
  label: "Grafana Metrics",
  order: 10,
  // Simulated stub. Runs only in demo mode (ENABLE_STUBS=1), and even then
  // stands down when the real context-fetcher supplies live Prometheus signals.
  enabled: () => stubsEnabled() && !process.env.CONTEXT_FETCHER_URL?.trim(),
  async gather(ctx): Promise<ProviderSlice<GrafanaSlice>> {
    try {
      const data = await source.query("storefront");
      return {
        source: "grafana",
        status: "ok",
        simulated: true,
        data,
        summary: "5xx and memory both spiked at 14:02Z; pod OOMed and restarted 7×.",
      };
    } catch (err) {
      return {
        source: "grafana",
        status: "error",
        summary: "Failed to query Grafana.",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
