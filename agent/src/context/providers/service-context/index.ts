import type { ContextProvider, ProviderSlice } from "../../types.js";
import {
  createStubServiceCatalog,
  deriveServiceName,
  type ServiceProfile,
} from "../../../service-catalog/index.js";
import { stubsEnabled } from "../../../stubs.js";

/**
 * Service-context provider — answers "what IS this service, and which part is
 * affected?". Supplies a semantic profile (description, components, deps, tier)
 * so the analysis agent can reason about the blast surface and name the affected
 * component (by correlating these components with the LB route + k8s — providers
 * run in parallel and can't see each other, so the agent makes the final call).
 *
 * Reads the shared service catalog (`src/service-catalog/`), which the
 * external-events search also uses to ground its queries. Owner: Kalata.
 */

const source = createStubServiceCatalog();

export const provider: ContextProvider<ServiceProfile> = {
  name: "service-context",
  label: "Service Context",
  order: 5, // right after the trigger, framing everything below
  // Simulated stub (in-code storefront catalog) — only runs in demo mode.
  enabled: () => stubsEnabled(),
  async gather(ctx): Promise<ProviderSlice<ServiceProfile>> {
    try {
      const service = deriveServiceName(ctx.trigger) ?? "storefront";
      const data = await source.lookup(service);
      if (!data) {
        return {
          source: "service-context",
          status: "unavailable",
          summary: `No service catalog entry for "${service}".`,
        };
      }
      return {
        source: "service-context",
        status: "ok",
        simulated: true,
        data,
        summary: `${data.name} — ${data.description} (${data.tier}). Components: ${data.components
          .map((c) => c.name)
          .join(", ")}.`,
      };
    } catch (err) {
      return {
        source: "service-context",
        status: "error",
        summary: "Failed to look up service context.",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
