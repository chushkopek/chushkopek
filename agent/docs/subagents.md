# Authoring subagents

A **subagent** is a focused, independently-ownable unit of work that the parent
L1 on-call agent can delegate to. Each subagent is exposed to the parent as a
single tool.

This guide is the contract. Follow it and your subagent will plug in without
touching anyone else's code — built for teammates working on different
subagents at the same time.

## TL;DR

1. Create a folder: `src/subagents/<your-subagent>/`.
2. Add `index.ts` that exports a `subagent` satisfying the `Subagent` contract.
3. That's it — it's auto-discovered and wired to the parent as a tool. No shared
   files to edit, no merge conflicts.

## How discovery works

`src/subagents/registry.ts` scans `src/subagents/` for subdirectories and
imports each one's `index.js` (resolves to `index.ts` in dev). It expects a
`subagent` named export (a default export also works). Folders starting with
`_` or `.` are ignored — use `_` for scaffolding or templates.

Subagent **names must be unique** (discovery throws on duplicates) and stable,
since the name is the tool name the parent calls.

## The contract

Defined in `src/subagents/types.ts`:

```ts
interface Subagent<TInput extends TSchema, TDetails> {
  name: string;          // snake_case tool name, e.g. "create_github_issue"
  label: string;         // human-readable label
  description: string;   // tells the PARENT when to delegate here
  inputSchema: TInput;   // typebox schema = the tool's parameters
  run(input, ctx): Promise<SubagentResult<TDetails>>;
}
```

- `description` is read by the parent LLM. Write it as guidance ("Delegate here
  when…"), not just a noun phrase.
- `inputSchema` is a [typebox](https://github.com/sinclairzx81/typebox) schema.
  Import `Type` / `Static` from `@earendil-works/pi-ai` (re-exported) so versions
  always match.
- `run(input, ctx)` returns a `SubagentResult`:
  - `summary`: short text handed back to the parent agent.
  - `details`: optional structured payload for logs/UI/downstream tools.

### The runtime context (`ctx`)

`run` receives a `SubagentContext` with the parent's `model`, `thinkingLevel`,
`getApiKey`, an abort `signal`, and an optional `onEvent` sink. Subagents inherit
the parent's provider config — do not construct your own model.

## Two ways to implement `run`

### 1. LLM-driven (most common)

Spin up your own agent loop with a focused prompt and tools using the
`runLlmSubagent` helper. It runs the loop, forwards events, honors cancellation,
and can capture a tool's output as your structured result:

```ts
import { runLlmSubagent } from "../runtime.js";

const { finalText, captured } = await runLlmSubagent<MyDetails>({
  ctx,
  systemPrompt: MY_PROMPT,
  tools: [myTool],
  task: renderTask(input),
  captureToolName: "my_tool", // capture details of this tool's result
});
```

### 2. Deterministic

If the work is pure code (no LLM reasoning), skip `runLlmSubagent` and do the
work directly in `run`, returning a `SubagentResult`.

## Recommended folder layout

```
src/subagents/<your-subagent>/
  index.ts        # exports `subagent` (REQUIRED)
  prompt.ts       # system prompt for the subagent's loop (if LLM-driven)
  tools.ts        # tools the subagent calls
  <client>.ts     # external integrations (HTTP/SDK clients)
  README.md       # what it does, inputs/outputs, status
```

Keep everything your subagent needs inside its folder. Shared helpers belong in
`src/subagents/*.ts` (framework) — propose changes there separately so you don't
block teammates.

## Conventions

- **Tool name = `name`**, snake_case, unique, stable.
- **One job per subagent.** If it grows two jobs, split it.
- **Never fabricate data.** Subagents operate on provided context only.
- **Make terminal tools `terminate: true`** so the loop stops once the job is done.
- **Throw on tool failure** (don't return errors as content) — the loop reports
  them to the LLM as tool errors.
- **Degrade gracefully when external access isn't configured** — return a clear
  `summary` saying so rather than fabricating a result (see how `github-issue`
  reports "not configured" when no GitHub App is set up).
- **Reuse shared infrastructure.** Cross-cutting capabilities live outside the
  subagent folders: `src/github/` (GitHub App auth) and `src/sandbox/` (podman
  sandbox + a `bash` tool). The `github-issue` subagent composes both.

## Testing your subagent

Use the SDK's faux provider to drive your subagent with no network or API key.
Register a faux provider, script the assistant responses (including tool calls),
and assert on the captured result. See the `github-issue` subagent for the shape
to mirror.

## Reference implementation

`src/subagents/github-issue/` — drafts and opens a GitHub issue from incident
context. Read it end to end as the canonical example.
