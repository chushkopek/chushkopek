import { join } from "node:path";
import { Type, type Static } from "@earendil-works/pi-ai";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { Subagent, SubagentContext, SubagentResult } from "../types.js";
import { runLlmSubagent } from "../runtime.js";
import { GITHUB_PROMPT } from "./prompt.js";
import { createSandbox, createBashTool } from "../../sandbox/index.js";
import type { BashToolDetails } from "../../sandbox/index.js";
import {
  loadGitHubAppConfigFromEnv,
  mintInstallationToken,
} from "../../github/index.js";

const InputSchema = Type.Object({
  owner: Type.String({ description: "Target repository owner (user or org)." }),
  repo: Type.String({ description: "Target repository name." }),
  incident_context: Type.String({
    description:
      "Full incident context/handoff: summary, affected systems, findings, severity, next steps.",
  }),
  severity: Type.Optional(
    Type.String({ description: "Incident severity, e.g. sev1..sev4." }),
  ),
  labels: Type.Optional(
    Type.Array(Type.String(), { description: "Extra labels to apply." }),
  ),
  base: Type.Optional(
    Type.String({
      description: "Base branch a suggested-fix PR should target. Defaults to 'main'.",
    }),
  ),
  suspected_change: Type.Optional(
    Type.String({
      description: "The commit/PR/deploy suspected to have caused the incident.",
    }),
  ),
});

type Input = Static<typeof InputSchema>;

interface Details {
  /** URL of the created issue, if one was detected in the gh output. */
  issueUrl?: string;
  /** URL of the suggested-fix PR, if one was opened. */
  prUrl?: string;
  finalText: string;
  llmError?: string;
}

const DEFAULT_SANDBOX_IMAGE = "docker.io/maniator/gh:latest";
const ISSUE_URL_RE = /https?:\/\/\S+?\/issues\/\d+/;
const PR_URL_RE = /https?:\/\/\S+?\/pull\/\d+/;
const BOT_NAME = "chushkopek-agent[bot]";
const BOT_EMAIL = "chushkopek-agent@users.noreply.github.com";

function renderTask(input: Input, repoDir: string, checkoutAvailable: boolean): string {
  const lines = [
    `Repository: ${input.owner}/${input.repo}`,
    `Base branch: ${input.base ?? "main"}`,
    input.severity ? `Severity: ${input.severity}` : undefined,
    input.labels?.length
      ? `Suggested labels: ${input.labels.join(", ")}`
      : undefined,
    input.suspected_change
      ? `Suspected change: ${input.suspected_change}`
      : undefined,
    checkoutAvailable
      ? `A checkout is available at ${repoDir} (your shell starts there). A suggested-fix PR is allowed if applicable.`
      : "No checkout is available — file the issue only; do NOT attempt a PR.",
    "",
    "Incident context:",
    input.incident_context,
  ].filter((l): l is string => l !== undefined);
  return lines.join("\n");
}

/**
 * Subagent: act on an incident in a target repo via the `gh` CLI inside a
 * sandbox (podman when available, otherwise the host shell). It always files a
 * well-structured issue and, when the context clearly implies a concrete
 * low-risk fix, opens a DRAFT suggested-fix PR from a real checkout of the repo.
 *
 * Instead of hand-rolling REST calls, it clones the repo into the sandbox and
 * hands the model a `bash` tool pinned to the checkout root, where `gh`/`git`
 * are pre-authenticated with a short-lived, repo-scoped GitHub App installation
 * token (issues + contents + pull_requests write — the minimum to file an issue
 * and open a fix PR). The PR is open-only: the model never merges it.
 *
 * Driven by the deterministic Phase 3 dispatch, not exposed to the parent agent
 * (`exposeToParent: false`) so it is never invoked ad hoc mid-analysis.
 */
export const subagent: Subagent<typeof InputSchema, Details> = {
  name: "github_file_issue_and_pr",
  label: "GitHub Issue + Fix PR",
  exposeToParent: false,
  description:
    "Delegate to a subagent that files a GitHub issue and, when a concrete " +
    "low-risk fix is implied, opens a draft suggested-fix PR in a target " +
    "repository from incident context. Provide owner, repo, and the incident " +
    "details; it returns the created issue and PR URLs. Requires a configured " +
    "GitHub App (see .env). Uses podman when available; otherwise runs gh/git " +
    "on the host.",
  inputSchema: InputSchema,
  run: async (input: Input, ctx: SubagentContext): Promise<SubagentResult<Details>> => {
    const appConfig = await loadGitHubAppConfigFromEnv();
    if (!appConfig) {
      return {
        summary:
          "GitHub integration is not configured, so nothing was filed. Set " +
          "GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY (or _PATH) in the agent env " +
          "to enable issue/PR filing. (See agent/.env.example.)",
        details: { finalText: "" },
      };
    }

    const token = await mintInstallationToken(appConfig, {
      owner: input.owner,
      repo: input.repo,
      permissions: {
        issues: "write",
        contents: "write",
        pull_requests: "write",
      },
    });

    const image =
      process.env.GITHUB_SANDBOX_IMAGE?.trim() || DEFAULT_SANDBOX_IMAGE;

    const { sandbox, mode } = await createSandbox({
      image,
      // A clone needs more scratch than the default 64m tmpfs.
      tmpfsSize: "512m",
      env: {
        GH_TOKEN: token.token,
        GH_REPO: `${input.owner}/${input.repo}`,
        // Make gh/git happy against the read-only rootfs and non-interactive.
        HOME: "/tmp",
        GH_CONFIG_DIR: "/tmp/gh",
        GH_PROMPT_DISABLED: "1",
        GH_NO_UPDATE_NOTIFIER: "1",
        GH_PAGER: "cat",
        // Commit identity for any suggested-fix PR.
        GIT_AUTHOR_NAME: BOT_NAME,
        GIT_AUTHOR_EMAIL: BOT_EMAIL,
        GIT_COMMITTER_NAME: BOT_NAME,
        GIT_COMMITTER_EMAIL: BOT_EMAIL,
      },
    });
    if (mode === "raw") {
      console.info("[github] podman unavailable; using host shell for gh/git.");
    }

    const repoDir = join(sandbox.scratchDir, "repo");

    try {
      // Deterministically position the subagent inside a checkout of the repo so
      // it can both read the code and push a fix branch. Best-effort: if the
      // clone fails, fall back to issue-only mode rather than aborting.
      const base = input.base ?? "main";
      const setup = await sandbox.exec(
        [
          "gh auth setup-git",
          `gh repo clone "$GH_REPO" ${repoDir} -- --depth 1 --branch ${base} || gh repo clone "$GH_REPO" ${repoDir} -- --depth 1`,
          `git config --global --add safe.directory ${repoDir}`,
          `git -C ${repoDir} config user.name "${BOT_NAME}"`,
          `git -C ${repoDir} config user.email "${BOT_EMAIL}"`,
        ].join(" && "),
      );
      const checkoutAvailable = setup.exitCode === 0;
      if (!checkoutAvailable) {
        console.warn(
          `[github] could not clone ${input.owner}/${input.repo} into the ` +
            `sandbox (exit ${setup.exitCode}); proceeding issue-only. ` +
            `${(setup.stderr || setup.stdout).trim()}`,
        );
      }

      // Collect issue/PR URLs from bash stdout so we can report them even if the
      // model's final prose omits them.
      const issueUrls: string[] = [];
      const prUrls: string[] = [];
      const wrappedCtx: SubagentContext = {
        ...ctx,
        onEvent: (event: AgentEvent) => {
          ctx.onEvent?.(event);
          if (
            event.type === "tool_execution_end" &&
            event.toolName === "bash" &&
            !event.isError
          ) {
            const details = event.result?.details as BashToolDetails | undefined;
            const out = details?.stdout ?? "";
            const issueMatch = out.match(ISSUE_URL_RE);
            if (issueMatch) issueUrls.push(issueMatch[0]);
            const prMatch = out.match(PR_URL_RE);
            if (prMatch) prUrls.push(prMatch[0]);
          }
        },
      };

      const { finalText, llmError } = await runLlmSubagent({
        ctx: wrappedCtx,
        systemPrompt: GITHUB_PROMPT,
        tools: [
          createBashTool(sandbox, {
            workdir: checkoutAvailable ? repoDir : undefined,
          }),
        ],
        task: renderTask(input, repoDir, checkoutAvailable),
      });

      if (llmError) {
        return {
          summary: `Model call failed before anything could be filed: ${llmError}`,
          details: { finalText, llmError },
        };
      }

      const issueUrl =
        issueUrls[issueUrls.length - 1] ?? finalText.match(ISSUE_URL_RE)?.[0];
      const prUrl = prUrls[prUrls.length - 1] ?? finalText.match(PR_URL_RE)?.[0];

      const parts: string[] = [];
      if (issueUrl) parts.push(`issue ${issueUrl}`);
      if (prUrl) parts.push(`PR ${prUrl}`);
      const summary = parts.length
        ? `Opened ${parts.join(" and ")}.`
        : `Subagent finished without a detectable issue or PR. ${finalText}`.trim();

      return { summary, details: { issueUrl, prUrl, finalText } };
    } finally {
      await sandbox.close().catch((err: unknown) => {
        console.warn(
          `[github] failed to tear down sandbox: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    }
  },
};
