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
```

Add a model API key to `.env`. The provider is auto-detected from whichever key
is present (detection order: anthropic > openrouter > openai).

**Using OpenRouter (recommended):**

```ini
OPENROUTER_API_KEY=sk-or-...
# Optional — defaults to anthropic/claude-opus-4.8:
# MODEL_ID=anthropic/claude-opus-4.8
```

OpenRouter model ids are namespaced (`vendor/model`), e.g. `anthropic/claude-sonnet-4.6`,
`openai/gpt-4o`. Quick model switches without editing `.env`:

```bash
npm run dev:opus    # anthropic/claude-opus-4.8 via OpenRouter
npm run dev:sonnet  # anthropic/claude-sonnet-4.6 via OpenRouter
```

## Actually running the GitHub integration end to end

The `github` subagent files real issues — and, when a fix is clearly implied,
opens a draft suggested-fix PR — by cloning the repo into a hardened **podman
sandbox** where `gh`/`git` are pre-authenticated and giving the model a `bash`
tool pinned to the checkout. Follow these steps once and you can file for real.

### 1. Prerequisites

- **podman** on PATH (`podman --version`). The sandbox image is auto-pulled on
first use — no image to build.
- A model key in `.env` (above).

### 2. Create a GitHub App (one time)

All GitHub access happens through this App's **private key** — the agent signs a
short-lived JWT with it, mints a repo-scoped installation token, and uses only
that token inside the sandbox. There is no personal access token and no
`gh auth login`; the App is the single source of authority.

1. Go to **Settings → Developer settings → GitHub Apps → New GitHub App**
  (for an org: `https://github.com/organizations/<ORG>/settings/apps/new`).
2. Set any name and homepage URL. Uncheck **Webhook → Active**.
3. Under **Repository permissions**, set exactly these three (everything else
  stays **No access**):

   | Permission       | Access         | Why                                          |
   | ---------------- | -------------- | -------------------------------------------- |
   | **Issues**       | Read and write | File the incident issue.                     |
   | **Contents**     | Read and write | Clone the repo and push a suggested-fix branch. |
   | **Pull requests**| Read and write | Open the draft suggested-fix PR.             |

   The agent mints tokens scoped to only these permissions (least privilege).
   It opens PRs as **drafts and never merges them**, but note that Contents +
   Pull requests write are inherently merge-capable, so the open-only guarantee
   rests on the agent's prompt, not the permission set.
4. Create the App, then on its page click **Generate a private key** — this
  downloads a `.pem` file.
5. Note the **App ID** (shown at the top of the App's General page).
6. Click **Install App** in the sidebar and install it on the repo(s) you want
  the agent to act on (choose "Only select repositories"). The installation must
  grant the three permissions above on each target repo.

### 3. Configure `.env`

```ini
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY_PATH=./secrets/app.private-key.pem
# Or paste the PEM inline instead of a path (literal \n newlines are accepted):
# GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
```

### 4. Verify everything with the doctor

```bash
npm run doctor                                   # model + podman + sandbox
npm run doctor -- --owner <owner> --repo <repo>  # also mints a token & hits the repo
```

Every line should read `PASS` (or an intentional `SKIP`).

### 5. File a real issue (and maybe a fix PR) with a real model

```bash
npm run file-issue -- --owner <owner> --repo <repo> \
  --context "api-gateway 5xx spike after deploy abc123; pods crashlooping"
```

Other flags: `--context-file <path>`, `--severity sev2`, `--labels incident,bug`,
`--base <branch>`, `--suspected-change <ref>`. With no `--context`, a
clearly-marked sample incident is used. It always files an issue and, when the
context clearly implies a concrete low-risk fix, opens a draft suggested-fix PR;
the created issue and PR URLs are printed at the end.

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
   report out in parallel → Slack, PagerDuty, GitHub (issue + draft fix PR).

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
    channels/     One folder per channel (slack, pagerduty, github)
  agent.ts        buildAgent() factory (async) + console renderer
  config.ts       Provider/model/thinking resolution from env
  prompts.ts      L1 on-call system prompt (guardrails + operating loop)
  tools/
    index.ts      Core tool registry
    escalate.ts   Terminal escalation tool (produces the EscalationReport)
  github/         GitHub App auth: mint short-lived, repo-scoped tokens
  sandbox/        Podman sandbox + a `bash` tool that runs inside it
  scripts/        doctor (preflight) + file-issue (e2e GitHub test)
  subagents/      Subagent framework + one folder per subagent
    types.ts      The Subagent contract
    runtime.ts    runLlmSubagent() helper (child agent loop)
    registry.ts   Auto-discovery + subagent->tool wrapper
    github/       Reference subagent: file an issue + optional draft fix PR
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

- Broaden the sandboxed `gh` capability into a general GitHub subagent (read
repos/issues/PRs/Actions) reusing `src/github` + `src/sandbox`.

