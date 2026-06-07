import { Type, type Static } from "@earendil-works/pi-ai";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { Subagent, SubagentContext, SubagentResult } from "../types.js";
import { runLlmSubagent } from "../runtime.js";
import { GITHUB_ISSUE_PROMPT } from "./prompt.js";
import { PodmanSandbox, createBashTool } from "../../sandbox/index.js";
import {
  loadGitHubAppConfigFromEnv,
  mintInstallationToken,
} from "../../github/index.js";
import type { BashToolDetails } from "../../sandbox/index.js";

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
});

type Input = Static<typeof InputSchema>;

interface Details {
  /** URL of the created issue, if one was detected in the gh output. */
  issueUrl?: string;
  finalText: string;
}

const DEFAULT_SANDBOX_IMAGE = "docker.io/maniator/gh:latest";
const ISSUE_URL_RE = /https?:\/\/\S+?\/issues\/\d+/;

function renderTask(input: Input): string {
  const lines = [
    `Repository: ${input.owner}/${input.repo}`,
    input.severity ? `Severity: ${input.severity}` : undefined,
    input.labels?.length
      ? `Suggested labels: ${input.labels.join(", ")}`
      : undefined,
    "",
    "Incident context:",
    input.incident_context,
  ].filter((l): l is string => l !== undefined);
  return lines.join("\n");
}

/**
 * Subagent: draft and open a GitHub issue for a repo from incident context.
 *
 * Instead of hand-rolling REST calls, it gives the model a `bash` tool inside a
 * podman sandbox where `gh` is pre-authenticated with a short-lived,
 * repo-scoped GitHub App installation token, and lets it run `gh issue create`.
 */
export const subagent: Subagent<typeof InputSchema, Details> = {
  name: "create_github_issue",
  label: "Create GitHub Issue",
  description:
    "Delegate to a subagent that drafts and opens a well-structured GitHub issue " +
    "in a target repository from incident context. Provide owner, repo, and the " +
    "incident details; it returns the created issue URL. Requires a configured " +
    "GitHub App (see .env) and podman.",
  inputSchema: InputSchema,
  run: async (input: Input, ctx: SubagentContext): Promise<SubagentResult<Details>> => {
    const appConfig = await loadGitHubAppConfigFromEnv();
    if (!appConfig) {
      return {
        summary:
          "GitHub integration is not configured, so no issue was created. Set " +
          "GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY (or _PATH) in the agent env " +
          "to enable issue filing. (See agent/.env.example.)",
        details: { finalText: "" },
      };
    }

    const token = await mintInstallationToken(appConfig, {
      owner: input.owner,
      repo: input.repo,
      permissions: { issues: "write" },
    });

    const image =
      process.env.GITHUB_SANDBOX_IMAGE?.trim() || DEFAULT_SANDBOX_IMAGE;

    const sandbox = await PodmanSandbox.start({
      image,
      env: {
        GH_TOKEN: token.token,
        GH_REPO: `${input.owner}/${input.repo}`,
        // Make gh/git happy against the read-only rootfs and non-interactive.
        HOME: "/tmp",
        GH_CONFIG_DIR: "/tmp/gh",
        GH_PROMPT_DISABLED: "1",
        GH_NO_UPDATE_NOTIFIER: "1",
        GH_PAGER: "cat",
      },
    });

    // Collect any issue URLs that show up in bash stdout, so we can report the
    // created issue even if the model's final prose omits it.
    const issueUrls: string[] = [];
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
          const match = details?.stdout?.match(ISSUE_URL_RE);
          if (match) issueUrls.push(match[0]);
        }
      },
    };

    try {
      const { finalText } = await runLlmSubagent({
        ctx: wrappedCtx,
        systemPrompt: GITHUB_ISSUE_PROMPT,
        tools: [createBashTool(sandbox)],
        task: renderTask(input),
      });

      const issueUrl =
        issueUrls[issueUrls.length - 1] ?? finalText.match(ISSUE_URL_RE)?.[0];

      const summary = issueUrl
        ? `Opened issue: ${issueUrl}`
        : `Subagent finished without a detectable created issue. ${finalText}`.trim();

      return { summary, details: { issueUrl, finalText } };
    } finally {
      await sandbox.close().catch((err: unknown) => {
        console.warn(
          `[github-issue] failed to remove sandbox container: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    }
  },
};
