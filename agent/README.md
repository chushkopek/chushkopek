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

## Project layout

```
src/
  cli.ts          Entry point: parse the incident, run the agent, stream output
  agent.ts        buildAgent() factory + console renderer
  config.ts       Provider/model/thinking resolution from env
  prompts.ts      L1 on-call system prompt (guardrails + operating loop)
  tools/
    index.ts      Tool registry (where GitHub tools land next)
    escalate.ts   Terminal escalation handoff tool
```

## Roadmap

- **Next:** GitHub access tools — read repos/issues/PRs/Actions, correlate
  recent changes to the incident, and open an escalation issue. These register
  in `src/tools/index.ts`.
