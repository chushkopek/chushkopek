import type { ContextProvider, ProviderSlice } from "../../types.js";
import {
  investigateExternalEvents,
  type ExternalEventsResult,
} from "../../../external-events/investigate.js";
import {
  createStubServiceCatalog,
  deriveServiceName,
  summarizeService,
} from "../../../service-catalog/index.js";

/**
 * External-events provider (OPT-IN) — the same external-events core as the
 * `external_events` subagent, surfaced as a deterministic Gather slice. Proof
 * that the capability fits the context-provider abstraction.
 *
 * Disabled by default (the agent-pulled subagent is the default path). Flip on
 * with `EXTERNAL_EVENTS_PROVIDER=1` to always rule the organic/external
 * hypothesis in/out during Gather.
 *
 * Note: providers run in parallel and only see the raw trigger, so this passes
 * a best-effort service + the trigger as the symptom. The agent-pulled subagent
 * gets richer inputs (named affected component) from the analysis.
 */

const catalog = createStubServiceCatalog();

export const provider: ContextProvider<ExternalEventsResult> = {
  name: "external-events",
  label: "External Events & Trends",
  order: 35, // alongside usage/traffic signals
  enabled: () => Boolean(process.env.EXTERNAL_EVENTS_PROVIDER?.trim()),
  async gather(ctx): Promise<ProviderSlice<ExternalEventsResult>> {
    try {
      // Ground the search in the service profile from the shared catalog (the
      // provider can't see the service-context slice, so it looks it up too).
      const service = deriveServiceName(ctx.trigger) ?? "the affected service";
      const profile = await catalog.lookup(service);
      const result = await investigateExternalEvents(
        {
          service,
          symptom: ctx.trigger,
          serviceDescription: profile ? summarizeService(profile) : undefined,
        },
        ctx,
      );
      return {
        source: "external-events",
        status: "ok",
        data: result,
        summary: `external_factor=${result.externalFactor}: ${result.answer}`,
      };
    } catch (err) {
      return {
        source: "external-events",
        status: "error",
        summary: "Failed to investigate external events.",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
