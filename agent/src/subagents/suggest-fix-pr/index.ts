import { Type, type Static } from "@earendil-works/pi-ai";
import type { Subagent, SubagentContext } from "../types.js";
import { runLlmSubagent } from "../runtime.js";
import { SUGGEST_FIX_PR_PROMPT } from "./prompt.js";
import { createPrTool } from "./tools.js";
import type { CreatedPr } from "./github-pr-client.js";

const InputSchema = Type.Object({
  owner: Type.String({ description: "Target repository owner (user or org)." }),
  repo: Type.String({ description: "Target repository name." }),
  base: Type.Optional(
    Type.String({ description: "Base branch to target. Defaults to 'main'." }),
  ),
  suspected_change: Type.Optional(
    Type.String({
      description: "The commit/PR/deploy suspected to have caused the incident.",
    }),
  ),
  escalation_context: Type.String({
    description:
      "Full escalation context: summary, root cause, findings, affected systems, next steps.",
  }),
});

type Input = Static<typeof InputSchema>;

interface Details {
  pr?: CreatedPr;
  finalText: string;
}

function renderTask(input: Input): string {
  return [
    `Repository: ${input.owner}/${input.repo}`,
    `Base branch: ${input.base ?? "main"}`,
    input.suspected_change ? `Suspected change: ${input.suspected_change}` : undefined,
    "",
    "Escalation context:",
    input.escalation_context,
  ]
    .filter((l): l is string => l !== undefined)
    .join("\n");
}

/**
 * Subagent: draft and open a suggested-fix PR on the failing service's repo,
 * using the escalation context. Mirrors the github-issue reference subagent.
 */
export const subagent: Subagent<typeof InputSchema, Details> = {
  name: "suggest_fix_pr",
  label: "Suggest Fix PR",
  description:
    "Delegate to a subagent that drafts and opens a suggested-fix pull request " +
    "in the failing service's repository from the escalation context. Provide " +
    "owner, repo, the suspected change, and the escalation details; it returns " +
    "the PR URL.",
  inputSchema: InputSchema,
  run: async (input: Input, ctx: SubagentContext) => {
    const { finalText, captured } = await runLlmSubagent<CreatedPr>({
      ctx,
      systemPrompt: SUGGEST_FIX_PR_PROMPT,
      tools: [createPrTool],
      task: renderTask(input),
      captureToolName: "create_pull_request",
    });

    const summary = captured
      ? `Opened PR #${captured.number}: ${captured.url}` +
        (captured.simulated ? " (simulated — stub client)" : "")
      : `Subagent finished without opening a PR. ${finalText}`.trim();

    return { summary, details: { pr: captured, finalText } };
  },
};
