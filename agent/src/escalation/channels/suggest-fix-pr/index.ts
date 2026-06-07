import type { EscalationReport } from "../../../tools/escalate.js";
import { subagent as suggestFixPrSubagent } from "../../../subagents/suggest-fix-pr/index.js";
import type { CreatedPr } from "../../../subagents/suggest-fix-pr/github-pr-client.js";
import type { Dispatcher, DispatcherContext, EscalationOutcome } from "../../types.js";

/**
 * Suggest-fix-PR dispatcher — the one LLM-backed channel. It is a THIN adapter:
 * it maps the EscalationReport into the suggest_fix_pr subagent's input, runs
 * the subagent (which spins its own agent loop and opens a PR via a stub
 * client), and maps the result back to an EscalationOutcome. Owner: Bojo.
 *
 * All the real work lives in src/subagents/suggest-fix-pr/. This adapter only
 * exists so the deterministic fan-out can reach the agentic PR drafter.
 */

const DEFAULT_REPO = process.env.FIX_PR_REPO ?? "acme/storefront";

/** Pull an owner/repo out of the report's free text, else fall back to default. */
function resolveRepo(report: EscalationReport): { owner: string; repo: string } {
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

  const [owner, repo] = DEFAULT_REPO.split("/");
  return { owner: owner!, repo: repo ?? "unknown" };
}

function renderEscalationContext(report: EscalationReport): string {
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
  name: "suggest-fix-pr",
  label: "Suggested Fix PR",
  async dispatch(
    report: EscalationReport,
    ctx: DispatcherContext,
  ): Promise<EscalationOutcome> {
    try {
      const { owner, repo } = resolveRepo(report);
      const result = await suggestFixPrSubagent.run(
        {
          owner,
          repo,
          suspected_change: report.suspected_change,
          escalation_context: renderEscalationContext(report),
        },
        {
          model: ctx.model,
          thinkingLevel: ctx.thinkingLevel,
          getApiKey: ctx.getApiKey,
          signal: ctx.signal,
        },
      );

      const pr = result.details?.pr as CreatedPr | undefined;
      if (!pr) {
        return {
          channel: "suggest-fix-pr",
          status: "skipped",
          summary: result.summary,
        };
      }
      return {
        channel: "suggest-fix-pr",
        status: "delivered",
        simulated: pr.simulated,
        summary: `Opened suggested-fix PR #${pr.number} on ${owner}/${repo}.`,
        ref: pr.url,
      };
    } catch (err) {
      return {
        channel: "suggest-fix-pr",
        status: "failed",
        summary: "Failed to draft the suggested-fix PR.",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
