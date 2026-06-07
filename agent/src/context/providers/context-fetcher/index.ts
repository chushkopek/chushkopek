import type { ContextProvider, ProviderSlice } from "../../types.js";
import { deriveServiceName } from "../../../service-catalog/index.js";

/**
 * Context-fetcher provider — the real, in-cluster replacement for the kubernetes
 * / grafana / load-balancer stubs, all in one slice.
 *
 * It calls the `context-fetcher` HTTP service (see the `context-fetcher/`
 * submodule at the repo root), which, given a `<namespace>/<name>` service id,
 * gathers over a look-back window: the live Deployment/Service/HTTPRoute
 * manifest, pod/workload state + k8s events, curated Prometheus metrics, Loki
 * access logs, and recent pod logs — and returns one structured bundle.
 *
 * OPT-IN: enabled only when `CONTEXT_FETCHER_URL` is set, so stub-only demo runs
 * and offline typecheck/build are unaffected. When on, it supersedes the
 * kubernetes/grafana/load-balancer stubs as the source of real cluster truth.
 *
 *   CONTEXT_FETCHER_URL         base url, e.g. http://context-fetcher.ai-agent:8080
 *                               (in-cluster) or http://localhost:8080 (port-forward)
 *   CONTEXT_FETCHER_SERVICE     explicit "<ns/name>" (or bare name) override;
 *                               otherwise the service name is derived from the trigger
 *   CONTEXT_FETCHER_NAMESPACE   namespace to pair with a derived bare name
 *   CONTEXT_FETCHER_WINDOW_SECONDS  look-back window (default 180 = 3 min)
 *   CONTEXT_FETCHER_TIMEOUT_MS  request timeout (default 30000)
 */

/** A compact projection of the context-fetcher JSON bundle for the analysis prompt. */
export interface ContextFetcherSlice {
  service: string;
  generatedAt?: string;
  windowSeconds: number;
  manifest: {
    hostnames: string[];
    deployment?: string;
    image?: string;
  };
  pods: {
    name: string;
    phase: string;
    ready: string;
    restarts: number;
    state: string;
  }[];
  events: {
    type: string;
    reason: string;
    object: string;
    count: number;
    message: string;
  }[];
  prometheus: Record<string, string>;
  loki: {
    count: number;
    byStatus?: Record<string, number>;
    topClientIps?: Record<string, number>;
  };
  /** Per-source collection warnings the service reported (`errors` in the bundle). */
  collectionWarnings: string[];
}

/** The raw shape the context-fetcher `/context?format=json` endpoint returns. */
interface RawBundle {
  service?: { namespace?: string; name?: string };
  window?: { seconds?: number };
  now_iso?: string;
  manifest?: Record<string, any>;
  events?: any[];
  pods?: any[];
  prometheus?: Record<string, any>;
  loki?: Record<string, any>;
  errors?: string[];
}

const DEFAULT_WINDOW_SECONDS = 180;
const DEFAULT_TIMEOUT_MS = 30_000;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Match a bare `<namespace>/<name>` service identifier (the contract's id form,
 * e.g. `demo/whoami`) inside free text, anchored on a boundary so it doesn't
 * grab URL paths like `/healthz` or `https://…`.
 */
const SERVICE_ID_RE = /(?:^|[\s"'(=])([a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*)(?=[\s"'),.;:]|$)/;

/**
 * Resolve the `<ns/name>` (or bare name) the brief should cover. Order:
 *   1. explicit `CONTEXT_FETCHER_SERVICE` override
 *   2. a `<namespace>/<name>` token found in the trigger (works for any service,
 *      e.g. the demo cluster's `demo/whoami`)
 *   3. a known catalog name derived from the trigger (+ optional namespace)
 */
function resolveService(trigger: string): string | undefined {
  const override = process.env.CONTEXT_FETCHER_SERVICE?.trim();
  if (override) return override;

  const idMatch = trigger.match(SERVICE_ID_RE);
  if (idMatch) return idMatch[1];

  const name = deriveServiceName(trigger);
  if (!name) return undefined;

  const ns = process.env.CONTEXT_FETCHER_NAMESPACE?.trim();
  return ns ? `${ns}/${name}` : name;
}

/** Combine the orchestrator's abort signal with a request timeout. */
function requestSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function topN(counts: Record<string, number> | undefined, n: number): Record<string, number> | undefined {
  if (!counts) return undefined;
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** Project the verbose JSON bundle down to the compact, promptable slice. */
function project(raw: RawBundle, fallbackService: string, windowSeconds: number): ContextFetcherSlice {
  const service =
    raw.service?.namespace && raw.service?.name
      ? `${raw.service.namespace}/${raw.service.name}`
      : fallbackService;

  const manifestImage = (() => {
    const containers = raw.manifest?.deployment?.spec?.template?.spec?.containers;
    if (Array.isArray(containers) && containers[0]?.image) return String(containers[0].image);
    // fall back to the running container image off the first pod
    const podImage = raw.pods?.[0]?.containers?.[0]?.image;
    return podImage ? String(podImage) : undefined;
  })();

  const pods = (raw.pods ?? []).map((p: any) => {
    const containers: any[] = Array.isArray(p?.containers) ? p.containers : [];
    const ready = containers.filter((c) => c?.ready).length;
    const total = containers.length || 1;
    const state = containers.map((c) => c?.state).filter(Boolean).join("; ") || "-";
    return {
      name: String(p?.name ?? "?"),
      phase: String(p?.phase ?? "?"),
      ready: `${ready}/${total}`,
      restarts: Number(p?.restarts ?? 0),
      state,
    };
  });

  const events = (raw.events ?? []).slice(0, 20).map((e: any) => ({
    type: String(e?.type ?? ""),
    reason: String(e?.reason ?? ""),
    object: String(e?.object ?? ""),
    count: Number(e?.count ?? 1),
    message: String(e?.message ?? "").replace(/\s+/g, " ").slice(0, 200),
  }));

  const prometheus: Record<string, string> = {};
  const curated = raw.prometheus?.curated;
  if (curated && typeof curated === "object") {
    for (const [name, res] of Object.entries<any>(curated)) {
      if (res?.error) {
        prometheus[name] = `error: ${res.error}`;
        continue;
      }
      const samples: any[] = Array.isArray(res?.samples) ? res.samples : [];
      if (!samples.length) prometheus[name] = "—";
      else if (samples.length === 1) prometheus[name] = String(samples[0]?.value ?? "—");
      else prometheus[name] = samples.slice(0, 6).map((s) => String(s?.value ?? "?")).join("; ");
    }
  }

  return {
    service,
    generatedAt: raw.now_iso,
    windowSeconds: raw.window?.seconds ?? windowSeconds,
    manifest: {
      hostnames: Array.isArray(raw.manifest?.hostnames) ? raw.manifest!.hostnames.map(String) : [],
      deployment: raw.manifest?.deployment?.metadata?.name
        ? String(raw.manifest.deployment.metadata.name)
        : undefined,
      image: manifestImage,
    },
    pods,
    events,
    prometheus,
    loki: {
      count: Number(raw.loki?.count ?? 0),
      byStatus: topN(raw.loki?.by_status, 8),
      topClientIps: topN(raw.loki?.by_client_ip, 5),
    },
    collectionWarnings: Array.isArray(raw.errors) ? raw.errors.map(String) : [],
  };
}

/** One-line, LLM-readable health summary derived from the projected slice. */
function summarize(s: ContextFetcherSlice): string {
  const total = s.pods.length;
  const unhealthy = s.pods.filter(
    (p) => !["Running", "Succeeded"].includes(p.phase) || p.restarts > 0,
  );
  const podPart = total
    ? unhealthy.length
      ? `${unhealthy.length}/${total} pods unhealthy (${unhealthy
          .map((p) => p.phase)
          .filter((v, i, a) => a.indexOf(v) === i)
          .join(", ")})`
      : `${total}/${total} pods healthy`
    : "no pods found";

  const errStatuses = Object.entries(s.loki.byStatus ?? {}).filter(([code]) => /^[45]/.test(code));
  const lokiPart = errStatuses.length
    ? `${errStatuses.map(([c, n]) => `${c}×${n}`).join(", ")} in ${s.windowSeconds}s`
    : `${s.loki.count} access-log lines in ${s.windowSeconds}s`;

  const imagePart = s.manifest.image ? `; image ${s.manifest.image}` : "";
  const warnPart = s.collectionWarnings.length ? ` (${s.collectionWarnings.length} collection warnings)` : "";

  return `${s.service}: ${podPart}; ${lokiPart}${imagePart}${warnPart}.`;
}

export const provider: ContextProvider<ContextFetcherSlice> = {
  name: "context-fetcher",
  label: "Cluster Context (k8s + Prometheus + Loki)",
  order: 45,
  enabled: () => Boolean(process.env.CONTEXT_FETCHER_URL?.trim()),
  async gather(ctx): Promise<ProviderSlice<ContextFetcherSlice>> {
    const base = process.env.CONTEXT_FETCHER_URL!.trim().replace(/\/+$/, "");
    const service = resolveService(ctx.trigger);

    if (!service) {
      return {
        source: "context-fetcher",
        status: "unavailable",
        summary:
          "Could not determine which service to fetch context for (no match in the " +
          "trigger and no CONTEXT_FETCHER_SERVICE override set).",
      };
    }

    const windowSeconds = envInt("CONTEXT_FETCHER_WINDOW_SECONDS", DEFAULT_WINDOW_SECONDS);
    const timeoutMs = envInt("CONTEXT_FETCHER_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
    const url = `${base}/context?service=${encodeURIComponent(service)}&seconds=${windowSeconds}&format=json`;

    try {
      const res = await fetch(url, {
        headers: { accept: "application/json" },
        signal: requestSignal(ctx.signal, timeoutMs),
      });
      if (!res.ok) {
        return {
          source: "context-fetcher",
          status: "error",
          summary: `context-fetcher returned HTTP ${res.status} for ${service}.`,
          error: `HTTP ${res.status} ${res.statusText} from ${url}`,
        };
      }

      const raw = (await res.json()) as RawBundle;
      const data = project(raw, service, windowSeconds);
      return {
        source: "context-fetcher",
        status: "ok",
        data,
        summary: summarize(data),
      };
    } catch (err) {
      return {
        source: "context-fetcher",
        status: "error",
        summary: `Failed to reach context-fetcher at ${base} for ${service}.`,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
