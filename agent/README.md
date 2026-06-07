# chushkopek — L1 DevOps on-call agent

An autonomous agent that does the work of a **first-line (L1) on-call DevOps
engineer** in response to production incidents. It triages, gathers evidence,
attempts only safe runbook-level remediation, and **always ends by escalating**
with a structured handoff to a higher tier.

Built on the [pi SDK](https://github.com/badlogic/pi-mono)
(`@earendil-works/pi-ai` + `@earendil-works/pi-agent-core`).

## Why "escalate is the goal"

An L1 engineer is deliberately not authorized to own resolution of a real
incident end to end. This agent mirrors that: it acts only within tight,
reversible guardrails and treats a clean escalation as success, not failure.

## Setup

```bash
cd agent
npm install
cp .env.example .env
# add ANTHROPIC_API_KEY or OPENAI_API_KEY to .env
```

The provider is auto-detected from whichever API key is present (Anthropic is
preferred). Pin it explicitly with `MODEL_PROVIDER` / `MODEL_ID` if you prefer.

## Run

```bash
# inline incident
npm run dev -- "api-gateway pods are crashlooping in prod, 5xx rate at 40%"

# from a file
npm run dev -- --file ./incident.txt

# from stdin
cat incident.txt | npm run dev
```

Build a runnable binary:

```bash
npm run build
node dist/cli.js "redis latency spiked, checkout timing out"
```

Escalation handoffs are written to `agent/escalations/` as markdown.

## Orchestration

An incident runs through a deterministic **3-phase pipeline** wrapping an
agentic core (`src/orchestrator/`):

1. **Gather** — every context provider (`src/context/providers/<name>/`) runs in
   parallel and returns a typed slice → one `IncidentContext` bundle.
2. **Analyze** — the L1 agent reasons over the bundle and emits a structured
   `EscalationReport` (it may pull investigative subagents like `web_search`).
3. **Dispatch** — every channel (`src/escalation/channels/<name>/`) fans the
   report out in parallel → Slack, PagerDuty, suggested-fix PR.

Phases 1 and 3 are deterministic (no LLM), so every source is gathered and every
channel is notified — guarantees, not model decisions. See
**[docs/orchestration-spec.md](docs/orchestration-spec.md)**.

Context sources and channels are auto-discovered the same way subagents are:
drop a folder, no shared file to edit. The shipped providers/dispatchers are
runnable **stubs** behind client interfaces — replace them with real
integrations without touching the orchestrator
(**[docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)** maps the work).

## Project layout

```
src/
  cli.ts          Entry point: parse the incident, run the orchestrator
  orchestrator/   The 3-phase pipeline (gather → analyze → dispatch)
    index.ts      runOrchestrator()
    render.ts     IncidentContext → analysis prompt
    types.ts      IncidentContext, OrchestratorResult
  context/        Phase 1 — context gathering
    types.ts      ContextProvider + ProviderSlice contracts
    registry.ts   Auto-discovery + parallel gatherSlices()
    providers/    One folder per source (grafana, github, usage, …) — stubs
  escalation/     Phase 3 — fan-out
    types.ts      Dispatcher + EscalationOutcome contracts
    registry.ts   Auto-discovery
    dispatch.ts   Parallel runDispatch()
    channels/     One folder per channel (slack, pagerduty, suggest-fix-pr)
  agent.ts        buildAgent() factory (async) + console renderer
  config.ts       Provider/model/thinking resolution from env
  prompts.ts      L1 on-call system prompt (guardrails + operating loop)
  tools/
    index.ts      Core tool registry
    escalate.ts   Terminal escalation tool (produces the EscalationReport)
  subagents/      Subagent framework + one folder per subagent
    types.ts      The Subagent contract
    runtime.ts    runLlmSubagent() helper (child agent loop)
    registry.ts   Auto-discovery + subagent->tool wrapper
    github-issue/ Reference subagent: open a GitHub issue
    suggest-fix-pr/ Drafts a fix PR from the escalation context
    web-search/   Investigative tool the Analyze phase can pull on demand
docs/
  orchestration-spec.md  The pipeline flow (start here)
  IMPLEMENTATION.md      Follow-up: who replaces which stub
  context-providers.md   How to author/replace a context source
  dispatchers.md         How to author/replace an escalation channel
  subagents.md           How to author a subagent
  subagent-template.md   Copy-paste starter
```

## Subagents

The parent agent delegates focused work to **subagents**, each exposed as a tool.
Subagents are auto-discovered from `src/subagents/<name>/` — add a folder, no
shared files to edit, so teammates can build different subagents concurrently.

See **[docs/subagents.md](docs/subagents.md)** to author one.

## Roadmap

- **Next:** GitHub access tools — a token-backed `GitHubClient` (read
  repos/issues/PRs/Actions, open issues). The `github-issue` subagent already
  consumes this behind an interface; today it uses a stub client.
