# Authoring context providers (Phase 1 — Gather)

A **context provider** fetches ONE incident source (Grafana, GitHub, the load
balancer, k8s, app usage, …) and returns a typed slice of evidence. The
orchestrator runs every provider in parallel and assembles their slices into the
`IncidentContext` the analysis agent reasons over.

Same convention as subagents: **drop a folder, it's auto-discovered, no shared
file to edit** — so teammates add sources concurrently without merge conflicts.

## TL;DR

1. Create `src/context/providers/<your-source>/`.
2. Add `index.ts` exporting a `provider` satisfying `ContextProvider`.
3. Done — it's auto-discovered and runs in Phase 1.

## The contract (`src/context/types.ts`)

```ts
interface ContextProvider<T> {
  name: string;     // unique kebab key, e.g. "load-balancer" = the slice source
  label: string;    // human-readable
  order?: number;   // prompt render order (lower first; trigger ~0)
  gather(ctx: ProviderContext): Promise<ProviderSlice<T>>;
}
```

Your `gather` returns a `ProviderSlice<T>`:

```ts
interface ProviderSlice<T> {
  source: string;                         // = your provider name
  status: "ok" | "unavailable" | "error";
  data?: T;                               // your typed payload, when status==="ok"
  summary: string;                        // one-liner, shown even when not ok
  error?: string;                         // when status==="error"
  simulated?: boolean;                    // true while stubbed
}
```

- `T` is **your** payload shape — define it in your folder. The analysis agent
  reads it as evidence, so include the fields that matter (metrics, commits,
  request rates, …).
- `summary` is always shown, even for `unavailable`/`error`. Make it a useful
  one-liner.
- **`gather` MUST NOT throw.** Catch internally and return `status: "error"`.
  One failing source must never abort the incident run — the registry defends
  against throws too, but owning it keeps your `summary`/`error` meaningful.

### `ProviderContext`

`gather` receives `{ trigger, signal, model, thinkingLevel, getApiKey }`. Use
`trigger` (the raw paged text) to scope your fetch and `signal` for
cancellation. The model fields are only for the rare provider that wants its own
LLM reasoning — most providers ignore them.

## The replacement seam (stub → real)

Ship a **stub** now, swap the **real** integration later without touching the
orchestrator. Put the real call behind a small client interface — the "function
call schema" — exactly like the subagent stub clients
(`src/subagents/github-issue/github-client.ts`):

```ts
// the function-call seam
export interface GrafanaSource {
  query(service: string): Promise<GrafanaSlice>;
}

function createStubGrafanaSource(): GrafanaSource {
  return { async query() { return { /* simulated demo data */ }; } };
}
```

Later, replace `createStubGrafanaSource` with a real Prometheus/Grafana client.
The `provider` object and the rest of the pipeline stay unchanged.

## Reference implementations

All six demo providers live in `src/context/providers/`. Read
`grafana/index.ts` as the canonical example — it shows the payload type, the
client seam, the stub, and the three status returns.

## Conventions

- **One source per provider.** If it grows two, split it.
- **Never fabricate.** Stubs return clearly-labelled `simulated: true` demo data;
  real providers return only what the source actually says.
- **Pick a sensible `order`** so your slice renders near related evidence
  (trigger 0, metrics 10–20, traffic 40, infra 50).
