import type { Model } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

/**
 * Context-gathering contract (Phase 1 of the orchestration pipeline).
 *
 * A {@link ContextProvider} fetches ONE incident source (Grafana, GitHub, the
 * load balancer, k8s, …) and returns a typed {@link ProviderSlice}. Providers
 * run deterministically and in parallel — no LLM is involved in this phase, so
 * every source is always attempted and the bundle is always complete.
 *
 * Authoring guide: agent/docs/context-providers.md
 */

/** Health of a single context source. */
export type SliceStatus = "ok" | "unavailable" | "error";

/**
 * Uniform envelope every provider returns. `T` is the source-specific payload
 * (defined in the provider's own folder). The envelope lets the orchestrator
 * stack heterogeneous slices into one bundle and lets the analysis agent reason
 * about gaps ("Grafana = ok, load balancer = unavailable") instead of guessing.
 */
export interface ProviderSlice<T = unknown> {
  /** Stable source key — mirrors the provider `name`, e.g. "grafana". */
  source: string;
  /** Whether the data was fetched, the source was unreachable, or it errored. */
  status: SliceStatus;
  /** Source-specific payload. Present when `status === "ok"`. */
  data?: T;
  /** One-line human/LLM-readable summary, shown even when unavailable/error. */
  summary: string;
  /** Failure detail. Populated when `status === "error"`. */
  error?: string;
  /** True when produced by a stub rather than a real integration. */
  simulated?: boolean;
}

/**
 * Runtime handed to a provider's `gather`. Deterministic providers use only
 * `trigger` and `signal`; the model fields exist for the rare provider that
 * wants to run its own LLM reasoning.
 */
export interface ProviderContext {
  /** The raw paged incident text, so a provider can scope what it fetches. */
  trigger: string;
  /** Abort signal from the orchestrator. Honor it in long-running fetches. */
  signal?: AbortSignal;
  /** Model config inherited from the parent (for LLM-backed providers). */
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  getApiKey: (provider: string) => string | undefined;
}

/**
 * A context provider: one folder under `src/context/providers/<name>/`,
 * auto-discovered (no shared file to edit). It exposes a single `gather` step.
 *
 * IMPORTANT: `gather` MUST NOT throw. Catch internally and return a slice with
 * `status: "error"` so one failing source can never abort the incident run.
 */
export interface ContextProvider<T = unknown> {
  /** Unique, stable kebab key, e.g. "load-balancer". Mirrors the slice source. */
  name: string;
  /** Human-readable label for logs/UI. */
  label: string;
  /** Render order in the analysis prompt (lower first; trigger ~0). */
  order?: number;
  /** Fetch the slice. Always resolves; never rejects. */
  gather(ctx: ProviderContext): Promise<ProviderSlice<T>>;
}

/** Minimal config used to build a {@link ProviderContext}. */
export interface ProviderRuntimeBase {
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  getApiKey: (provider: string) => string | undefined;
}
