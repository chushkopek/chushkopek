import type { EscalationReport } from "../../../tools/escalate.js";
import { subagent as githubSubagent } from "../../../subagents/github/index.js";
import type { Dispatcher, DispatcherContext, EscalationOutcome } from "../../types.js";

/**
 * GitHub dispatcher — the one LLM-backed channel. It is a THIN adapter: it maps
 * the EscalationReport into the github subagent's input, runs the subagent
 * (which clones the repo into a sandbox, files an issue, and — if a fix is
 * clearly implied — opens a draft suggested-fix PR), and maps the result back
 * to an EscalationOutcome.
 *
 * All the real work lives in src/subagents/github/. This adapter only exists so
 * the deterministic fan-out can reach the agentic GitHub worker.
 */

const FALLBACK_REPO = "acme/storefront";

function splitSlug(slug: string): { owner: string; repo: string } | undefined {
  const [owner, repo] = slug.split("/");
  if (owner && repo) return { owner, repo: repo.replace(/\.git$/, "") };
  return undefined;
}

/**
 * Decide which repo to act on. An explicitly configured `FIX_PR_REPO` is
 * authoritative — when the operator pins a repo, never let report scraping
 * override it. Otherwise pull a `github.com/owner/repo` URL out of the report,
 * then a bare `owner/repo` slug, then fall back to a default.
 */
function resolveRepo(report: EscalationReport): { owner: string; repo: string } {
  const configured = process.env.FIX_PR_REPO?.trim();
  if (configured) {
    const pinned = splitSlug(configured);
    if (pinned) return pinned;
  }

  const haystack = [
    report.suspected_change ?? "",
    ...(report.evidence_links ?? []),
    ...report.affected_systems,
    report.findings,
  ].join(" ");

  const urlMatch = haystack.match(/github\.com\/([\w.-]+)\/([\w.-]+)/i);
  if (urlMatch) return { owner: urlMatch[1]!, repo: urlMatch[2]!.replace(/\.git$/, "") };

  const slugMatch = haystack.match(/\b([\w.-]+)\/([\w.-]+)\b/);
  if (slugMatch && slugMatch[1] !== "n") return { owner: slugMatch[1]!, repo: slugMatch[2]! };

  return splitSlug(FALLBACK_REPO)!;
}

function renderIncidentContext(report: EscalationReport): string {
  const lines = [
    `Severity: ${report.severity}`,
    `Summary: ${report.summary}`,
    report.root_cause_hypothesis
      ? `Root cause: ${report.root_cause_hypothesis}` +
        (report.confidence ? ` (confidence: ${report.confidence})` : "")
      : undefined,
    `Affected systems: ${report.affected_systems.join(", ")}`,
    `Current state: ${report.current_state}`,
    "",
    "Findings:",
    report.findings,
    "",
    "Recommended next steps:",
    ...report.recommended_next_steps.map((s) => `- ${s}`),
  ];
  return lines.filter((l): l is string => l !== undefined).join("\n");
}

export const dispatcher: Dispatcher = {
  name: "github",
  label: "GitHub (issue + fix PR)",
  async dispatch(
    report: EscalationReport,
    ctx: DispatcherContext,
  ): Promise<EscalationOutcome> {
    try {
      const { owner, repo } = resolveRepo(report);
      const result = await githubSubagent.run(
        {
          owner,
          repo,
          incident_context: renderIncidentContext(report),
          severity: report.severity,
          suspected_change: report.suspected_change,
        },
        {
          model: ctx.model,
          thinkingLevel: ctx.thinkingLevel,
          getApiKey: ctx.getApiKey,
          signal: ctx.signal,
        },
      );

      const { issueUrl, prUrl } = result.details ?? {};
      if (!issueUrl && !prUrl) {
        return {
          channel: "github",
          status: "skipped",
          summary: result.summary,
        };
      }

      const parts: string[] = [];
      if (issueUrl) parts.push("issue");
      if (prUrl) parts.push("draft fix PR");
      return {
        channel: "github",
        status: "delivered",
        summary: `Filed ${parts.join(" + ")} on ${owner}/${repo}.`,
        ref: prUrl ?? issueUrl,
      };
    } catch (err) {
      return {
        channel: "github",
        status: "failed",
        summary: "Failed to file the GitHub issue / suggested-fix PR.",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
