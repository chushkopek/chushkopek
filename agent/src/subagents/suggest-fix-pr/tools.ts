import { Type, type Static } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createGitHubPrClient, type CreatedPr } from "./github-pr-client.js";

const CreatePrParams = Type.Object({
  owner: Type.String({ description: "Repository owner (user or org)." }),
  repo: Type.String({ description: "Repository name." }),
  base: Type.String({ description: "Base branch to target, e.g. 'main'." }),
  branch: Type.String({
    description: "Suggested head branch name for the fix, e.g. 'fix/profile-bio-xss'.",
  }),
  title: Type.String({ description: "Concise, specific PR title." }),
  body: Type.String({
    description:
      "Markdown PR body: root cause, the proposed fix (described or as a diff), " +
      "and a link back to the incident.",
  }),
});

export type CreatePrArgs = Static<typeof CreatePrParams>;

const github = createGitHubPrClient();

/**
 * Opens a suggested-fix PR. Terminal for the subagent: once the PR exists the
 * job is done, so we stop the loop after a successful creation.
 */
export const createPrTool: AgentTool<typeof CreatePrParams, CreatedPr> = {
  name: "create_pull_request",
  label: "Create Pull Request",
  description:
    "Open a suggested-fix pull request in the target repository. Call this exactly once.",
  parameters: CreatePrParams,
  execute: async (_toolCallId, params) => {
    const pr = await github.createPullRequest(params);
    const note = pr.simulated ? " (simulated — stub client)" : "";
    return {
      content: [
        { type: "text", text: `Opened PR #${pr.number}: ${pr.url}${note}` },
      ],
      details: pr,
      terminate: true,
    };
  },
};
