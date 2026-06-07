import type { ContextProvider, ProviderSlice } from "../../types.js";
import { stubsEnabled } from "../../../stubs.js";

/**
 * Kubernetes provider — pod status, restart reasons, events, current rollout.
 * Owner: core. Replace the stub with real read-only k8s API calls.
 */

export interface KubernetesSlice {
  deployment: string;
  image: string;
  pods: { name: string; phase: string; restarts: number; lastState?: string }[];
  recentEvents: string[];
}

/** The function-call seam: replace with a read-only Kubernetes client. */
export interface KubernetesSource {
  inspect(service: string, namespace: string): Promise<KubernetesSlice>;
}

function createStubKubernetesSource(): KubernetesSource {
  return {
    async inspect(): Promise<KubernetesSlice> {
      return {
        deployment: "storefront",
        image: "registry.acme.internal/storefront:a1b2c3d",
        pods: [
          {
            name: "storefront-7d9c8b5f4-q2xkz",
            phase: "CrashLoopBackOff",
            restarts: 7,
            lastState: "OOMKilled",
          },
          {
            name: "storefront-7d9c8b5f4-m4r8t",
            phase: "CrashLoopBackOff",
            restarts: 6,
            lastState: "Error (exit 137)",
          },
        ],
        recentEvents: [
          "14:01Z Scaled up replica set storefront-7d9c8b5f4 (rollout of a1b2c3d)",
          "14:02Z Back-off restarting failed container",
          "14:03Z Readiness probe failed: HTTP 500",
        ],
      };
    },
  };
}

const source = createStubKubernetesSource();

export const provider: ContextProvider<KubernetesSlice> = {
  name: "kubernetes",
  label: "Kubernetes State",
  order: 50,
  // Simulated stub. Runs only in demo mode (ENABLE_STUBS=1), and even then
  // stands down when the real context-fetcher supplies live cluster state.
  enabled: () => stubsEnabled() && !process.env.CONTEXT_FETCHER_URL?.trim(),
  async gather(ctx): Promise<ProviderSlice<KubernetesSlice>> {
    try {
      const data = await source.inspect("storefront", "production");
      return {
        source: "kubernetes",
        status: "ok",
        simulated: true,
        data,
        summary:
          "storefront pods in CrashLoopBackOff (OOMKilled) right after the 14:01Z " +
          "rollout of image a1b2c3d.",
      };
    } catch (err) {
      return {
        source: "kubernetes",
        status: "error",
        summary: "Failed to read Kubernetes state.",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
