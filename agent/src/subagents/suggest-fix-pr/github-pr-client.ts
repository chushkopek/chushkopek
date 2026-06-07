/**
 * GitHub PR client used by the suggest-fix-pr subagent.
 *
 * The real implementation (auth + branch + commit + PR via REST/GraphQL) lands
 * with the dedicated "gh access" task. Until then {@link createGitHubPrClient}
 * returns a STUB that simulates PR creation so the subagent chain is runnable
 * and testable end to end. Swap the stub for the real client without touching
 * the subagent.
 *
 * REQUIREMENT for the real dispatch implementation: open-only. The agent opens a
 * suggested-fix PR for a human to review — it MUST NOT merge it. See
 * docs/dispatchers.md and docs/IMPLEMENTATION.md.
 */
export interface CreatePullRequestInput {
  owner: string;
  repo: string;
  base: string;
  /** Suggested head branch name for the fix. */
  branch: string;
  title: string;
  body: string;
}

export interface CreatedPr {
  url: string;
  number: number;
  /** True when produced by the stub client rather than the real GitHub API. */
  simulated: boolean;
}

export interface GitHubPrClient {
  createPullRequest(input: CreatePullRequestInput): Promise<CreatedPr>;
}

let warnedStub = false;

/** STUB client. Replace with a token-backed implementation in the gh task. */
export function createGitHubPrClient(): GitHubPrClient {
  return {
    async createPullRequest(input) {
      if (!warnedStub) {
        console.warn(
          "[suggest-fix-pr] Using STUB GitHub PR client — no PR is actually opened. " +
            "Wire the real client in the gh access task.",
        );
        warnedStub = true;
      }
      const number = Math.floor(Math.random() * 9000) + 1000;
      return {
        url: `https://github.com/${input.owner}/${input.repo}/pull/${number}`,
        number,
        simulated: true,
      };
    },
  };
}
