# Follow-up implementation — who builds what

The **orchestration layer is done and runnable on stubs** (this is the
`L1-Engineer` branch). The pipeline gathers 6 context sources, runs the L1
analysis, and fans out to 3 channels — today, with simulated data. Each section
below is a teammate's follow-up: **replace a stub with the real thing.** Because
every piece is an auto-discovered folder, you can all work in parallel with zero
merge conflicts.

Read first: [orchestration-spec.md](./orchestration-spec.md) (the flow),
[context-providers.md](./context-providers.md) (add/replace a source),
[dispatchers.md](./dispatchers.md) (add/replace a channel),
[subagents.md](./subagents.md) (LLM workers).

The demo scenario the stubs encode: a frontend vuln (unsanitized profile bio
rendered as HTML, PR #482 / commit `a1b2c3d`) crashes the `storefront` service
in `production`; traffic is at baseline (NOT Black Friday) — it's exploitation,
not load.

---

## 1. Grafana context — Mitko

**File:** [src/context/providers/grafana/index.ts](../src/context/providers/grafana/index.ts)
**Replace:** `createStubGrafanaSource()` → a real Grafana/Prometheus client.
**Keep:** the `GrafanaSlice` payload shape (or extend it) and the `provider` object.
**Done when:** `gather` returns real error-rate / latency / saturation / restart
metrics for the failing service, scoped to the incident window; `status:"error"`
on query failure; `simulated` dropped.

## 2. GitHub context — Bojo

**File:** [src/context/providers/github/index.ts](../src/context/providers/github/index.ts)
**Replace:** `createStubGithubSource()` → real GitHub data via the shared auth +
sandbox stack in [src/github/](../src/github/) (`mintInstallationToken`) and
[src/sandbox/](../src/sandbox/) (podman sandbox with authenticated `gh` CLI).
**Done when:** returns real recent commits/PRs, the suspected change, and the
**CODEOWNERS → `resolvedOwner` + `ownerSource`** resolution (the diagram's
"service owner resolved via CODEOWNERS"). This owner flows into the escalation
and routes PagerDuty.

## 3. App-usage/World context — Kalata

**File:** [src/context/providers/usage/index.ts](../src/context/providers/usage/index.ts)
**Replace:** `createStubUsageSource()` → real product-analytics queries (PostHog
etc.) comparing current traffic to baseline.
**Done when:** `classification` is computed for real (`organic_surge` vs
`likely_attack` vs `inconclusive`) with a rationale — this is the "is it really
Black Friday?" verdict the agent uses to distinguish a legit surge from an attack.

## 4. Load-balancer context — Iva

**File:** [src/context/providers/load-balancer/index.ts](../src/context/providers/load-balancer/index.ts)
**Replace:** `createStubLoadBalancerSource()` → real ingress/LB log queries.
**Done when:** returns real request rates, 4xx/5xx breakdown, latency, and the
top offending route from in-cluster ingress logs.

## 5. Kubernetes context — core / Dimitar

**File:** [src/context/providers/kubernetes/index.ts](../src/context/providers/kubernetes/index.ts)
**Replace:** `createStubKubernetesSource()` → a read-only k8s client.
**Done when:** returns real pod status, restart reasons, recent events, and the
current rollout image/version.

## 6. Incident trigger — Strato (plot twist + entry point)

**File:** [src/context/providers/trigger/index.ts](../src/context/providers/trigger/index.ts)
**Replace:** `createStubTriggerSource()` → parse the real alert payload
(Alertmanager webhook / k8s event) that fires `runOrchestrator`.
**Also:** wire whatever pages the agent (the crashing deployed app) to call
`runOrchestrator(trigger)` — see `src/cli.ts` for the current entry point.

---

## Escalation channels

### Slack — Iva

**File:** [src/escalation/channels/slack/index.ts](../src/escalation/channels/slack/index.ts)
**Replace:** `createStubSlackClient()` → Slack Web API (`chat.postMessage`).
**Keep:** `renderSlackText(report)` (tune the formatting as you like).
**Done when:** a real message lands in the incidents channel with the full
summary/timeline/next-steps; `ref` is the real permalink.

### PagerDuty — Strato

**File:** [src/escalation/channels/pagerduty/index.ts](../src/escalation/channels/pagerduty/index.ts)
**Replace:** `createStubPagerDutyClient()` → PagerDuty Events API v2.
**Done when:** one real alert is raised, routed to the owner from the report
(`suggested_owner`), with the dynamic description; `ref` is the real incident URL.

### GitHub issue + suggested-fix PR — Bojo (DONE)

**Files:** subagent [src/subagents/github/](../src/subagents/github/)
(`index.ts`, `prompt.ts`) + the thin adapter
[src/escalation/channels/github/index.ts](../src/escalation/channels/github/index.ts).
**Status:** real, not stubbed. The `github` dispatcher maps the report → subagent
input → outcome; the subagent mints a repo-scoped installation token
(`issues` + `contents` + `pull_requests` write) via [src/github/](../src/github/),
clones the repo into a [src/sandbox/](../src/sandbox/) podman sandbox so it
operates from the **root of a checkout**, then files one issue and — when the
context clearly implies a concrete low-risk fix — creates a branch, commits, and
opens a draft suggested-fix PR linking the issue.
**Constraint — open-only:** the PR is opened for a human to review and is **never
merged** (no merge, auto-merge, or approve). Enforced by the prompt + `--draft`.
Note: an installation token with `contents`/`pull_requests` write is inherently
merge-capable, so open-only rests on the prompt + draft, not the token scope.
**Note:** this subagent sets `exposeToParent: false`, so it runs only in the
guaranteed Phase 3 dispatch, never as an ad-hoc Phase 2 tool — no duplicate
filings.

---

## Investigative tools (optional, agent-pulled during Analyze)

### Web search — owner TBD

**Files:** [src/subagents/web-search/](../src/subagents/web-search/)
**Replace:** `createWebSearchClient()` stub → a real provider (Brave/Tavily/Bing).
**Done when:** the Analyze agent can research a focused question (e.g. "known CVE
for this signature") and get live, cited results. This is the example of the
"deterministic pipeline with options exposed to the agent" model — any subagent
dropped in `src/subagents/` becomes a tool the analysis can pull on demand.

---

## The orchestration layer — Kaloyan (this branch, done)

**Files:** [src/orchestrator/](../src/orchestrator/), [src/context/](../src/context/)
(types + registry), [src/escalation/](../src/escalation/) (types + registry +
dispatch), extended [src/tools/escalate.ts](../src/tools/escalate.ts),
[src/agent.ts](../src/agent.ts), [src/cli.ts](../src/cli.ts).
**Status:** complete. The pipeline, contracts, registries, render, capture, and
fan-out all work on stubs. Your job as a teammate above is to swap your stub —
nothing in this layer should need to change.

---

## Verify your piece

```bash
cd agent
npm run typecheck      # contracts line up
npm run build          # registry .js resolution works
# full run (needs OPENROUTER_API_KEY or another provider key in .env for Analyze):
echo "storefront readiness probe failing, CrashLoopBackOff in production" | npm run dev:sonnet
```

Expect: 6 Gather lines → the Analyze agent streaming + an `escalate` call → 3
Dispatch outcome lines. The markdown handoff lands in `agent/escalations/`.
Without an API key, the deterministic Gather + Dispatch phases still run; only
the Analyze step and the github subagent (issue + fix PR) need the model.
