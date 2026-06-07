# Authoring dispatchers (Phase 3 — Dispatch)

A **dispatcher** delivers the finished `EscalationReport` to ONE channel
(Slack, PagerDuty, a suggested-fix PR, …). The orchestrator runs every
dispatcher in parallel, so the report always reaches every channel.

Same convention as everywhere else: **drop a folder, auto-discovered, no shared
file to edit.**

## TL;DR

1. Create `src/escalation/channels/<your-channel>/`.
2. Add `index.ts` exporting a `dispatcher` satisfying `Dispatcher`.
3. Done — it's auto-discovered and fires in Phase 3.

## The contract (`src/escalation/types.ts`)

```ts
interface Dispatcher {
  name: string;   // unique kebab key, e.g. "pagerduty" = the outcome channel
  label: string;
  dispatch(report: EscalationReport, ctx: DispatcherContext): Promise<EscalationOutcome>;
}
```

Your `dispatch` returns an `EscalationOutcome`:

```ts
interface EscalationOutcome {
  channel: string;                               // = your dispatcher name
  status: "delivered" | "skipped" | "failed";
  summary: string;                               // "Posted to #incidents"
  ref?: string;                                  // URL / message ts / PR link
  error?: string;                                // when status==="failed"
  simulated?: boolean;                           // true while stubbed
}
```

- **`dispatch` MUST NOT throw.** Catch internally and return `status: "failed"`.
  One failing channel must never abort the rest of the fan-out (the registry
  defends against throws too).
- The `report` is the full `EscalationReport` from `src/tools/escalate.ts` —
  severity, summary, findings, root_cause_hypothesis, suggested_owner,
  recommended_next_steps, evidence_links, etc. Render the fields your channel
  needs.

## Two flavors

### 1. Deterministic (most channels — Slack, PagerDuty)

Just format the report and call a stub client. No LLM. See
`src/escalation/channels/slack/index.ts` and `.../pagerduty/index.ts`. Put the
real API call behind a client interface (the "function call schema"):

```ts
export interface SlackClient {
  postMessage(message: SlackMessage): Promise<PostedMessage>;
}
function createStubSlackClient(): SlackClient { /* simulated */ }
```

Swap the stub for the real Slack/PagerDuty client later; the `dispatcher` object
is unchanged.

### 2. LLM-backed (e.g. github)

When the channel needs reasoning (filing an issue / drafting a PR), the
dispatcher is a **thin adapter** over a real subagent. See
`src/escalation/channels/github/index.ts`: it maps the report into the
`github_file_issue_and_pr` subagent's input, runs it via the subagent's `run()`,
and maps the result to an `EscalationOutcome`. The actual LLM work lives in
`src/subagents/github/` (authored per `docs/subagents.md`).

Keep the heavy logic in the subagent; the dispatcher is just the bridge from the
deterministic fan-out to the agentic worker.

## `DispatcherContext`

`dispatch` receives `{ signal, model, thinkingLevel, getApiKey }`. Deterministic
channels use only `signal`; LLM-backed ones pass the model fields into the
subagent.

## Conventions

- **One channel per dispatcher.**
- **Stub now, real later** behind a client interface — return `simulated: true`
  until wired.
- **Render only the report fields your channel needs.** Don't dump the whole
  object into a pager.
