# github subagent

Acts on an incident in a target repository via the `gh` CLI inside a podman
sandbox. It **always files one well-structured issue** and, when the incident
context clearly implies a concrete, low-risk fix, **also opens a draft
suggested-fix pull request** from a real checkout of the repo. It is the
reference implementation for the subagent framework — see
`[../../../docs/subagents.md](../../../docs/subagents.md)`.

## Tool name

`github_file_issue_and_pr`

This subagent sets `exposeToParent: false`: it is driven by the deterministic
Phase 3 dispatch (the `github` escalation channel), not handed to the parent L1
agent as an ad-hoc tool, so an incident never produces duplicate filings.

### Input

| Field              | Type     | Required | Description                                          |
| ------------------ | -------- | -------- | ---------------------------------------------------- |
| `owner`            | string   | yes      | Target repository owner (user or org).               |
| `repo`             | string   | yes      | Target repository name.                              |
| `incident_context` | string   | yes      | Incident summary, affected systems, findings, steps. |
| `severity`         | string   | no       | e.g. `sev1`..`sev4`.                                 |
| `labels`           | string[] | no       | Extra labels to apply.                               |
| `base`             | string   | no       | Base branch a fix PR targets (default `main`).       |
| `suspected_change` | string   | no       | The commit/PR/deploy suspected to be the cause.      |

### Output (`details`)

```jsonc
{
  "issueUrl": "https://github.com/owner/repo/issues/1234",
  "prUrl": "https://github.com/owner/repo/pull/1235", // present only if a fix PR was opened
  "finalText": "..."
}
```

## How it works

The hypothesis: models are well-trained on the `gh` CLI and on editing a working
tree, so instead of hand-rolling REST calls we give the model a shell inside a
checkout and let it run `gh` + `git`.

`run()`:

1. Mints a **short-lived, repo-scoped GitHub App installation token** with
   `issues: write`, `contents: write`, and `pull_requests: write` — the minimum
   to file an issue and open a fix PR (see
   `[src/github/app-auth.ts](../../github/app-auth.ts)`).
2. Starts a hardened **podman sandbox**
   (`[src/sandbox/podman.ts](../../sandbox/podman.ts)`) with a larger tmpfs,
   injecting the token as `GH_TOKEN`, the repo as `GH_REPO`, and a bot commit
   identity.
3. **Clones the repo into `/tmp/repo`** and pins the `bash` tool to that
   directory, so the model "finds itself in the root of a checkout" (each `bash`
   call is an independent shell, so the working dir is set per exec). If the
   clone fails, it falls back to issue-only mode.
4. Runs a focused agent loop (`runLlmSubagent`) whose only tool is `bash`
   (`[src/sandbox/bash-tool.ts](../../sandbox/bash-tool.ts)`). The model files
   the issue and, if applicable, creates a branch, edits files, commits, pushes,
   and opens a **draft** PR linking the issue.
5. Captures the issue and PR URLs from the `gh` output and returns them; the
   sandbox container is always torn down in a `finally`.

## Constraints

- **Open-only.** A suggested-fix PR is a suggestion for a human to review. The
  prompt forbids merging/approving/auto-merge and opens the PR as a draft. Note
  that an installation token with `contents`/`pull_requests` write is inherently
  merge-capable, so the open-only guarantee rests on the prompt + draft, not the
  token scope.

## Requirements

- **podman** on PATH (the image is auto-pulled on first use).
- A configured **GitHub App** with access to the target repo and Contents,
  Issues, and Pull requests permissions (see
  `[../../../.env.example](../../../.env.example)`). If it is not configured,
  the subagent reports that and files nothing — it never fabricates a result.

## Files

```
index.ts    subagent definition (exports `subagent`); orchestrates auth+clone+sandbox
prompt.ts   system prompt for the issue/PR loop (gh + git CLI instructions)
```

Shared infrastructure it builds on lives outside the folder:
`src/github/` (App auth) and `src/sandbox/` (podman sandbox + bash tool).
