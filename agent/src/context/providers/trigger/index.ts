import type { ContextProvider, ProviderSlice } from "../../types.js";
import { stubsEnabled } from "../../../stubs.js";

/**
 * Trigger provider — the k8s event / probe failure that paged us. This is the
 * incident's "patient zero". Owner: core. Order 0 so it renders first.
 *
 * Replace the stub by parsing the real alert payload (Alertmanager webhook,
 * k8s event, etc.) that fires `runOrchestrator`.
 */

export interface TriggerSlice {
  kind: "k8s_probe_failure";
  service: string;
  namespace: string;
  pod?: string;
  probe: "liveness" | "readiness" | "startup";
  reason: string;
  message: string;
  firstSeen: string;
}

/** The function-call seam: replace with a parser over the real alert payload. */
export interface TriggerSource {
  resolve(trigger: string): Promise<TriggerSlice>;
}

function createStubTriggerSource(): TriggerSource {
  return {
    async resolve(): Promise<TriggerSlice> {
      return {
        kind: "k8s_probe_failure",
        service: "storefront",
        namespace: "production",
        pod: "storefront-7d9c8b5f4-q2xkz",
        probe: "readiness",
        reason: "CrashLoopBackOff",
        message:
          "Readiness probe failed: HTTP 500 on /healthz; container restarted 7 times.",
        firstSeen: "2026-06-07T14:02:11Z",
      };
    },
  };
}

const source = createStubTriggerSource();

export const provider: ContextProvider<TriggerSlice> = {
  name: "trigger",
  label: "Incident Trigger",
  order: 0,
  // Simulated stub — only runs in demo mode (ENABLE_STUBS=1). The raw trigger
  // text still flows to the analysis regardless; this just adds a fake slice.
  enabled: () => stubsEnabled(),
  async gather(ctx): Promise<ProviderSlice<TriggerSlice>> {
    try {
      const data = await source.resolve(ctx.trigger);
      return {
        source: "trigger",
        status: "ok",
        simulated: true,
        data,
        summary: `${data.probe} probe ${data.reason} on ${data.service} (${data.namespace}).`,
      };
    } catch (err) {
      return {
        source: "trigger",
        status: "error",
        summary: "Failed to resolve the incident trigger.",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
