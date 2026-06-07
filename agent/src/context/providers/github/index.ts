import type { ContextProvider, ProviderSlice } from "../../types.js";
import { stubsEnabled } from "../../../stubs.js";

/**
 * GitHub provider — the affected repo, recent changes, and CODEOWNERS → owner.
 * Owner: Bojo. Replace the stub with real GitHub REST/GraphQL calls (reuse the
 * token-backed client from the gh-access task when it lands).
 */

export interface GithubSlice {
  repo: string;
  defaultBranch: string;
  recentCommits: { sha: string; message: string; author: string; when: string }[];
  recentMergedPrs: { number: number; title: string; mergedAt: string }[];
  codeowners: { path: string; owners: string[] }[];
  /** Resolved owning team for the suspected change. */
  resolvedOwner?: string;
  /** How the owner was derived, for the escalation's owner_source field. */
  ownerSource?: string;
}

/** The function-call seam: replace with a real GitHub client. */
export interface GithubSource {
  inspect(service: string): Promise<GithubSlice>;
}

function createStubGithubSource(): GithubSource {
  return {
    async inspect(): Promise<GithubSlice> {
      return {
        repo: "acme/storefront",
        defaultBranch: "main",
        recentCommits: [
          {
            sha: "a1b2c3d",
            message: "feat(profile): render user-supplied bio as rich HTML",
            author: "dani",
            when: "2026-06-07T13:55:00Z",
          },
          {
            sha: "9f8e7d6",
            message: "chore: bump dependencies",
            author: "renovate[bot]",
            when: "2026-06-07T09:12:00Z",
          },
        ],
        recentMergedPrs: [
          { number: 482, title: "Rich profile bios", mergedAt: "2026-06-07T13:56:00Z" },
        ],
        codeowners: [
          { path: "/src/profile/", owners: ["@acme/frontend-team"] },
          { path: "/src/checkout/", owners: ["@acme/payments-team"] },
        ],
        resolvedOwner: "@acme/frontend-team",
        ownerSource: "CODEOWNERS:/src/profile/",
      };
    },
  };
}

const source = createStubGithubSource();

export const provider: ContextProvider<GithubSlice> = {
  name: "github",
  label: "GitHub Repository",
  order: 20,
  // Simulated stub (hardcoded PR #482 / CODEOWNERS) — only runs in demo mode.
  enabled: () => stubsEnabled(),
  async gather(ctx): Promise<ProviderSlice<GithubSlice>> {
    try {
      const data = await source.inspect("storefront");
      return {
        source: "github",
        status: "ok",
        simulated: true,
        data,
        summary:
          "PR #482 (a1b2c3d) renders unsanitized user bio as HTML, merged 13:56Z — " +
          "minutes before the crash. Owner: @acme/frontend-team.",
      };
    } catch (err) {
      return {
        source: "github",
        status: "error",
        summary: "Failed to inspect the GitHub repository.",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
