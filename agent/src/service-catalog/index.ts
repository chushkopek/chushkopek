/**
 * Shared service catalog — the single source of "what a service IS".
 *
 * Both the `service-context` context provider and the external-events search
 * core read from here, so the search query can be **grounded in the service
 * profile** (domain, components, audience) regardless of which surface invokes
 * it. Replace the in-code CATALOG with a real catalog (Backstage / service.yaml /
 * config map) without touching either consumer.
 */

export interface ServiceComponent {
  name: string;
  description: string;
  /** Routes/endpoints this component owns, used to pinpoint the affected part. */
  routes?: string[];
}

export interface ServiceProfile {
  name: string;
  description: string;
  tier: string;
  /** Short domain keywords used to ground external-events searches. */
  domain: string[];
  components: ServiceComponent[];
  dependencies: { upstream: string[]; downstream: string[] };
  ownerTeam?: string;
}

const CATALOG: Record<string, ServiceProfile> = {
  storefront: {
    name: "storefront",
    description:
      "Customer-facing web storefront: browse catalog, manage profile, cart, and checkout.",
    tier: "tier-1 (user-facing, revenue-critical)",
    domain: ["e-commerce", "online shopping", "retail checkout", "consumer web app"],
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

/** The function-call seam: replace with a real service-catalog lookup. */
export interface ServiceCatalogSource {
  lookup(service: string): Promise<ServiceProfile | undefined>;
}

export function createStubServiceCatalog(): ServiceCatalogSource {
  return {
    async lookup(service) {
      return CATALOG[service?.toLowerCase()?.trim()];
    },
  };
}

/** Best-effort: pull a known service name out of raw trigger/alert text. */
export function deriveServiceName(text: string): string | undefined {
  const lower = text.toLowerCase();
  return Object.keys(CATALOG).find((svc) => lower.includes(svc));
}

/** A compact, search-groundable description of the service. */
export function summarizeService(p: ServiceProfile): string {
  return (
    `${p.name} — ${p.description} ` +
    `Domain: ${p.domain.join(", ")}. ` +
    `Components: ${p.components.map((c) => c.name).join(", ")}.`
  );
}
