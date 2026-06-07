# Orchestration spec — the incident pipeline

This is the source-of-truth for how the agent turns a paged incident into an
escalation. Read it before touching `src/orchestrator/`, `src/context/`, or
`src/escalation/`.

## The one invariant

> **Phases 1 (Gather) and 3 (Dispatch) are deterministic plain code — no LLM.
> The LLM runs only in Phase 2 (Analyze).**

So every context source is always gathered and every channel is always
notified. Fan-out is a *guarantee*, not something the model decides. The model's
judgment is reserved for the one place it adds value: turning the gathered
evidence into a root-cause + severity + owner.

## The flow

```
  k8s probe fails / alert fires  →  runOrchestrator(trigger)
                                          │
  ┌────────────────────────────────────────────────────────────────────────┐
  │ PHASE 1 — GATHER   (deterministic, parallel, no LLM)                     │
  │   loadProviders() → every src/context/providers/<name>/                  │
  │   Promise.allSettled(provider.gather(ctx))  → ProviderSlice[]            │
  │   assemble → IncidentContext { trigger, slices[], gatheredAt }           │
  └────────────────────────────────────────┬───────────────────────────────┘
                                            │  (plain data — a bag of evidence)
  ┌────────────────────────────────────────▼───────────────────────────────┐
  │ PHASE 2 — ANALYZE   (agentic — ONE L1 agent loop)                        │
  │   renderAnalysisPrompt(context) → user message                          │
  │   agent.prompt(...)   (may pull web_search or other investigative subagents)│
  │   agent calls escalate(...) → terminate                                  │
  │   orchestrator captures escalate's tool-result `details` → EscalationReport│
  └────────────────────────────────────────┬───────────────────────────────┘
                                            │  (a structured EscalationReport)
  ┌────────────────────────────────────────▼───────────────────────────────┐
  │ PHASE 3 — DISPATCH   (deterministic, parallel, no LLM*)                  │
  │   loadDispatchers() → every src/escalation/channels/<name>/             │
  │   Promise.allSettled(dispatcher.dispatch(report, ctx)) → EscalationOutcome[]│
  └────────────────────────────────────────┬───────────────────────────────┘
                                            │
                              OrchestratorResult → CLI prints the outcomes
```

\* The `github` dispatcher is the one exception: it is a thin adapter
that runs an LLM subagent. It still returns a normal `EscalationOutcome`, so the
fan-out treats it like any other channel.

## Data handoffs between phases

| Phase | Consumes | Produces | Type |
|-------|----------|----------|------|
| Gather  | `trigger: string` | the evidence bundle | `IncidentContext` |
| Analyze | `IncidentContext` | the structured report | `EscalationReport` |
| Dispatch| `EscalationReport` | per-channel results | `EscalationOutcome[]` |

Types live in: `src/orchestrator/types.ts`, `src/context/types.ts`,
`src/tools/escalate.ts` (`EscalationReport`), `src/escalation/types.ts`.

## Failure semantics — nothing aborts the run

- A provider that errors (or breaks its no-throw contract) → a slice with
  `status: "error"`. The other five sources still feed the analysis.
- A dispatcher that fails → an outcome with `status: "failed"`. The other
  channels still fire.
- The agent never calls `escalate` → Dispatch is skipped, the CLI says so. No
  crash.

This is why Gather uses `Promise.allSettled` (not `all`) in
`context/registry.ts` and Dispatch does the same in `escalation/dispatch.ts`.

## How the report is captured

`escalate` is the agent's terminal tool (`terminate: true`). It returns
`details: { file, report }`. The orchestrator subscribes to the agent's events
and, on `tool_execution_end` for `escalate`, reads `event.result.details` —
exactly the mechanism `runLlmSubagent` uses (`captureToolName`). That turns the
terminal tool call into a typed object the Dispatch phase can consume.

## Where the LLM's autonomy lives

- **Yes:** synthesizing the root cause, severity, traffic classification, and
  owner from the evidence; optionally pulling investigative subagents
  (`web_search`) to fill a gap.
- **No:** deciding *whether* to gather a source or *whether* to notify a
  channel. Those are deterministic and guaranteed.

## Extending the pipeline

- Add a context source → `docs/context-providers.md`.
- Add an escalation channel → `docs/dispatchers.md`.
- Add an investigative tool the agent can pull during Analyze → it's just a
  subagent: `docs/subagents.md`.
