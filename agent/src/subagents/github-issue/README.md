# github-issue subagent

Drafts and opens a single, well-structured GitHub issue in a target repository
from incident context. This is the reference implementation for the subagent
framework — see `[../../../docs/subagents.md](../../../docs/subagents.md)`.

## Tool exposed to the parent

`create_github_issue`

### Input


| Field              | Type     | Required | Description                                          |
| ------------------ | -------- | -------- | ---------------------------------------------------- |
| `owner`            | string   | yes      | Target repository owner (user or org).               |
| `repo`             | string   | yes      | Target repository name.                              |
| `incident_context` | string   | yes      | Incident summary, affected systems, findings, steps. |
| `severity`         | string   | no       | e.g. `sev1`..`sev4`.                                 |
| `labels`           | string[] | no       | Extra labels to apply.                               |


### Output (`details`)

```jsonc
{
  "issueUrl": "https://github.com/owner/repo/issues/1234",
  "finalText": "..."
}
```

## How it works

The hypothesis: models are well-trained on the `gh` CLI, so instead of
hand-rolling REST calls we give the model a shell and let it run `gh`.

`run()`:

1. Mints a **short-lived, repo-scoped GitHub App installation token** with only
  `issues: write` (see `[src/github/app-auth.ts](../../github/app-auth.ts)`).
2. Starts a hardened **podman sandbox**
  (`[src/sandbox/podman.ts](../../sandbox/podman.ts)`) from a public image that
   bundles `gh` + `git`, injecting the token as `GH_TOKEN` and the repo as
   `GH_REPO` so `gh` is pre-authenticated.
3. Runs a focused agent loop (`runLlmSubagent`) whose only tool is `bash`
  (`[src/sandbox/bash-tool.ts](../../sandbox/bash-tool.ts)`). The model writes
   the title/body and calls `gh issue create`.
4. Captures the created issue URL from the `gh` output and returns it; the
  sandbox container is always torn down in a `finally`.

## Requirements

- **podman** on PATH (the image is auto-pulled on first use).
- A configured **GitHub App** with access to the target repo (see
`[../../../.env.example](../../../.env.example)`). If it is not configured,
the subagent reports that and creates nothing — it never fabricates an issue.

## Files

```
index.ts    subagent definition (exports `subagent`); orchestrates auth+sandbox
prompt.ts   system prompt for the issue-writing loop (gh CLI instructions)
```

Shared infrastructure it builds on lives outside the folder:
`src/github/` (App auth) and `src/sandbox/` (podman sandbox + bash tool).