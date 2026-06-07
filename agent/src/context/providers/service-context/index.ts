import type { ContextProvider, ProviderSlice } from "../../types.js";

/**
 * Service-context provider — answers "what IS this service, and which part is
 * affected?". Supplies a semantic profile (description, components, deps, tier)
 * so the analysis agent can reason about the blast surface and name the affected
 * component (by correlating these components with the LB route + k8s — providers
 * run in parallel and can't see each other, so the agent makes the final call).
 *
 * Owner: Kalata (world/service context). Replace the stub catalog with a real
 * source (Backstage, a `service.yaml`, or a config map).
 */

export interface ServiceComponent {
  name: string;
  description: string;
  /** Routes/endpoints this component owns, used to pinpoint the affected part. */
  routes?: string[];
}

export interface ServiceContextSlice {
  name: string;
  description: string;
  tier: string;
  components: ServiceComponent[];
  dependencies: { upstream: string[]; downstream: string[] };
  ownerTeam?: string;
  /** Best-effort guess of the affected component from the trigger text only. */
  affectedComponentGuess?: string;
}

/** The function-call seam: replace with a real service catalog lookup. */
export interface ServiceCatalogSource {
  lookup(service: string): Promise<ServiceContextSlice | undefined>;
}

const CATALOG: Record<string, ServiceContextSlice> = {
  storefront: {
    name: "storefront",
    description:
      "Customer-facing web storefront: browse catalog, manage profile, cart, and checkout.",
    tier: "tier-1 (user-facing, revenue-critical)",
    components: [
      { name: "home", description: "Landing & product browsing.", routes: ["/", "/catalog"] },
      { name: "profile", description: "User profile incl. editable bio.", routes: ["/profile"] },
      { name: "cart", description: "Shopping cart.", routes: ["/cart"] },
      { name: "checkout", description: "Payment & order placement.", routes: ["/checkout"] },
    ],
    dependencies: {
      upstream: ["cdn", "ingress-lb"],
      downstream: ["checkout-api", "catalog-api", "session-store"],
    },
    ownerTeam: "@acme/frontend-team",
  },
};

/** Naive service extraction from the raw trigger text (stub heuristic). */
function deriveService(trigger: string): string | undefined {
  const lower = trigger.toLowerCase();
  return Object.keys(CATALOG).find((svc) => lower.includes(svc));
}

function createStubServiceCatalog(): ServiceCatalogSource {
  return {
    async lookup(service) {
      return CATALOG[service];
    },
  };
}

const source = createStubServiceCatalog();

export const provider: ContextProvider<ServiceContextSlice> = {
  name: "service-context",
  label: "Service Context",
  order: 5, // right after the trigger, framing everything below
  async gather(ctx): Promise<ProviderSlice<ServiceContextSlice>> {
    try {
      const service = deriveService(ctx.trigger) ?? "storefront";
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
