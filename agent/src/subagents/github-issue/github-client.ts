/**
 * GitHub client used by the github-issue subagent.
 *
 * The real implementation (auth + REST/GraphQL calls) lands with the dedicated
 * "gh access" task. Until then {@link createGitHubClient} returns a STUB that
 * simulates issue creation so the subagent chain is runnable and testable end
 * to end. Swap the stub for the real client without touching the subagent.
 */
export interface CreateIssueInput {
  owner: string;
  repo: string;
  title: string;
  body: string;
  labels?: string[];
}

export interface CreatedIssue {
  url: string;
  number: number;
  /** True when produced by the stub client rather than the real GitHub API. */
  simulated: boolean;
}

export interface GitHubClient {
  createIssue(input: CreateIssueInput): Promise<CreatedIssue>;
}

let warnedStub = false;

/** STUB client. Replace with a token-backed implementation in the gh task. */
export function createGitHubClient(): GitHubClient {
  return {
    async createIssue(input) {
      if (!warnedStub) {
        console.warn(
          "[github-issue] Using STUB GitHub client — no issue is actually created. " +
            "Wire the real client in the gh access task.",
        );
        warnedStub = true;
      }
      const number = Math.floor(Math.random() * 9000) + 1000;
      return {
        url: `https://github.com/${input.owner}/${input.repo}/issues/${number}`,
        number,
        simulated: true,
      };
    },
  };
}
