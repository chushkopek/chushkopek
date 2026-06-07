import { Type, type Static } from "@earendil-works/pi-ai";
import type { Subagent, SubagentContext } from "../types.js";
import { runLlmSubagent } from "../runtime.js";
import { GITHUB_ISSUE_PROMPT } from "./prompt.js";
import { createIssueTool } from "./tools.js";
import type { CreatedIssue } from "./github-client.js";

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
  issue?: CreatedIssue;
  finalText: string;
}

function renderTask(input: Input): string {
  const lines = [
    `Repository: ${input.owner}/${input.repo}`,
    input.severity ? `Severity: ${input.severity}` : undefined,
    input.labels?.length ? `Suggested labels: ${input.labels.join(", ")}` : undefined,
    "",
    "Incident context:",
    input.incident_context,
  ].filter((l): l is string => l !== undefined);
  return lines.join("\n");
}

/**
 * Subagent: draft and open a GitHub issue for a repo from incident context.
 */
export const subagent: Subagent<typeof InputSchema, Details> = {
  name: "create_github_issue",
  label: "Create GitHub Issue",
  description:
    "Delegate to a subagent that drafts and opens a well-structured GitHub issue " +
    "in a target repository from incident context. Provide owner, repo, and the " +
    "incident details; it returns the created issue URL.",
  inputSchema: InputSchema,
  run: async (input: Input, ctx: SubagentContext) => {
    const { finalText, captured } = await runLlmSubagent<CreatedIssue>({
      ctx,
      systemPrompt: GITHUB_ISSUE_PROMPT,
      tools: [createIssueTool],
      task: renderTask(input),
      captureToolName: "create_issue",
    });

    const summary = captured
      ? `Opened issue #${captured.number}: ${captured.url}` +
        (captured.simulated ? " (simulated — stub client)" : "")
      : `Subagent finished without creating an issue. ${finalText}`.trim();

    return { summary, details: { issue: captured, finalText } };
  },
};
