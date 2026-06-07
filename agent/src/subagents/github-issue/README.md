# github-issue subagent

Drafts and opens a single, well-structured GitHub issue in a target repository
from incident context. This is the reference implementation for the subagent
framework — see [`../../../docs/subagents.md`](../../../docs/subagents.md).

## Tool exposed to the parent

`create_github_issue`

### Input

| Field              | Type       | Required | Description                                          |
| ------------------ | ---------- | -------- | ---------------------------------------------------- |
| `owner`            | string     | yes      | Target repository owner (user or org).               |
| `repo`             | string     | yes      | Target repository name.                              |
| `incident_context` | string     | yes      | Incident summary, affected systems, findings, steps. |
| `severity`         | string     | no       | e.g. `sev1`..`sev4`.                                  |
| `labels`           | string[]   | no       | Extra labels to apply.                               |

### Output (`details`)

```jsonc
{
  "issue": { "url": "...", "number": 1234, "simulated": true },
  "finalText": "..."
}
```

## How it works

`run()` launches a focused agent loop (`runLlmSubagent`) with `prompt.ts` and the
`create_issue` tool. The LLM composes the title/body/labels from the context and
calls `create_issue` exactly once; that tool result's `details` is captured and
returned to the parent.

## Status: STUB GitHub client

`github-client.ts` currently simulates issue creation (returns a fake URL,
`simulated: true`) and logs a warning. The real, token-backed client lands with
the **gh access** task — swap `createGitHubClient()` without touching the
subagent or its tool.

## Files

```
index.ts          subagent definition (exports `subagent`)
prompt.ts         system prompt for the issue-writing loop
tools.ts          create_issue tool
github-client.ts  GitHubClient interface + stub implementation
```
