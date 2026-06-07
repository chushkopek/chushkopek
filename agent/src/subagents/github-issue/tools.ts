import { Type, type Static } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createGitHubClient, type CreatedIssue } from "./github-client.js";

const CreateIssueParams = Type.Object({
  owner: Type.String({ description: "Repository owner (user or org)." }),
  repo: Type.String({ description: "Repository name." }),
  title: Type.String({ description: "Concise, specific issue title." }),
  body: Type.String({
    description: "Markdown issue body: summary, impact, findings, and next steps.",
  }),
  labels: Type.Optional(
    Type.Array(Type.String(), { description: "Labels to apply, if any." }),
  ),
});

export type CreateIssueArgs = Static<typeof CreateIssueParams>;

const github = createGitHubClient();

/**
 * Creates a GitHub issue. Terminal for the subagent: once the issue exists the
 * subagent's job is done, so we stop the loop after a successful creation.
 */
export const createIssueTool: AgentTool<typeof CreateIssueParams, CreatedIssue> = {
  name: "create_issue",
  label: "Create Issue",
  description: "Open a GitHub issue in the target repository. Call this exactly once.",
  parameters: CreateIssueParams,
  execute: async (_toolCallId, params) => {
    const issue = await github.createIssue(params);
    const note = issue.simulated ? " (simulated — stub client)" : "";
    return {
      content: [
        {
          type: "text",
          text: `Created issue #${issue.number}: ${issue.url}${note}`,
        },
      ],
      details: issue,
      terminate: true,
    };
  },
};
