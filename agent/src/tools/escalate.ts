import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Type, type Static } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";

const EscalationParams = Type.Object({
  severity: Type.Union(
    [
      Type.Literal("sev1"),
      Type.Literal("sev2"),
      Type.Literal("sev3"),
      Type.Literal("sev4"),
    ],
    {
      description:
        "Incident severity. sev1 = critical/total outage, sev4 = minor/cosmetic.",
    },
  ),
  summary: Type.String({
    description: "One or two sentence summary of the incident for the pager/handoff.",
  }),
  affected_systems: Type.Array(Type.String(), {
    description: "Services, components, or environments impacted.",
  }),
  findings: Type.String({
    description:
      "What you observed and your suspected cause, with the evidence chain (hypothesis -> evidence -> conclusion).",
  }),
  actions_taken: Type.Array(
    Type.Object({
      action: Type.String({ description: "The action performed." }),
      result: Type.String({ description: "The observed outcome of that action." }),
    }),
    {
      description:
        "Every remediation/diagnostic action you took and its result. Empty array if you took none.",
    },
  ),
  current_state: Type.String({
    description:
      "Current state of the incident at handoff (e.g. mitigated, degraded, ongoing).",
  }),
  recommended_next_steps: Type.Array(Type.String(), {
    description: "Concrete next steps for the receiving (L2/SRE/owner) engineer.",
  }),
  suggested_owner: Type.Optional(
    Type.String({
      description:
        "Team or individual best suited to take ownership, if known (e.g. 'payments-oncall').",
    }),
  ),
  // --- Analysis fields populated from the gathered incident context ---
  root_cause_hypothesis: Type.Optional(
    Type.String({
      description:
        "The single most likely cause, stated as a falsifiable hypothesis.",
    }),
  ),
  confidence: Type.Optional(
    Type.Union(
      [Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")],
      { description: "Confidence in the root-cause hypothesis." },
    ),
  ),
  traffic_assessment: Type.Optional(
    Type.Union(
      [
        Type.Literal("organic_surge"),
        Type.Literal("likely_attack"),
        Type.Literal("inconclusive"),
      ],
      {
        description:
          "Whether the load looks like organic growth (e.g. Black Friday) or an attack.",
      },
    ),
  ),
  suspected_change: Type.Optional(
    Type.String({
      description:
        "The deploy/commit/PR most likely responsible, if any (e.g. a sha or PR number).",
    }),
  ),
  evidence_links: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "URLs to dashboards, logs, commits, or PRs that support the findings.",
    }),
  ),
  owner_source: Type.Optional(
    Type.String({
      description:
        "How the suggested owner was derived (e.g. 'CODEOWNERS:/frontend/').",
    }),
  ),
  incident_class: Type.Optional(
    Type.Union(
      [
        Type.Literal("attack"),
        Type.Literal("bug_or_regression"),
        Type.Literal("external_or_organic"),
        Type.Literal("inconclusive"),
      ],
      {
        description:
          "Which hypothesis class best explains the incident: a malicious " +
          "attack/exploit, a single bug/regression, an external/organic event or " +
          "trend, or inconclusive.",
      },
    ),
  ),
  external_factors: Type.Optional(
    Type.String({
      description:
        "Any real-world event/trend that helps explain the incident (with " +
        "citations), or 'none found'. Populate from the external_events investigation.",
    }),
  ),
});

export type EscalationReport = Static<typeof EscalationParams>;

function renderReport(report: EscalationReport): string {
  const lines: string[] = [];
  lines.push(`# INCIDENT ESCALATION [${report.severity.toUpperCase()}]`);
  lines.push("");
  lines.push(`Summary: ${report.summary}`);
  lines.push(`Current state: ${report.current_state}`);
  if (report.suggested_owner) {
    const src = report.owner_source ? ` (${report.owner_source})` : "";
    lines.push(`Suggested owner: ${report.suggested_owner}${src}`);
  }
  if (report.incident_class) {
    lines.push(`Incident class: ${report.incident_class}`);
  }
  if (report.root_cause_hypothesis) {
    const conf = report.confidence ? ` [confidence: ${report.confidence}]` : "";
    lines.push(`Root-cause hypothesis: ${report.root_cause_hypothesis}${conf}`);
  }
  if (report.traffic_assessment) {
    lines.push(`Traffic assessment: ${report.traffic_assessment}`);
  }
  if (report.external_factors) {
    lines.push(`External factors: ${report.external_factors}`);
  }
  if (report.suspected_change) {
    lines.push(`Suspected change: ${report.suspected_change}`);
  }
  lines.push("");
  lines.push(`Affected systems:`);
  for (const s of report.affected_systems) lines.push(`  - ${s}`);
  lines.push("");
  lines.push(`Findings / suspected cause:`);
  lines.push(report.findings);
  lines.push("");
  lines.push(`Actions taken by L1 agent:`);
  if (report.actions_taken.length === 0) {
    lines.push("  - (none — escalated without acting)");
  } else {
    for (const a of report.actions_taken) lines.push(`  - ${a.action} => ${a.result}`);
  }
  lines.push("");
  lines.push(`Recommended next steps:`);
  for (const step of report.recommended_next_steps) lines.push(`  - ${step}`);
  if (report.evidence_links?.length) {
    lines.push("");
    lines.push(`Evidence:`);
    for (const link of report.evidence_links) lines.push(`  - ${link}`);
  }
  return lines.join("\n");
}

/**
 * Terminal action for the agent: hand the incident off to a higher tier.
 *
 * For now this records the structured report to disk and returns it. It is the
 * integration point where a real pager/ticketing handoff (PagerDuty, Opsgenie,
 * a GitHub issue, Slack, etc.) will be wired in.
 */
export const escalateTool: AgentTool<typeof EscalationParams> = {
  name: "escalate",
  label: "Escalate Incident",
  description:
    "Hand the incident off to a higher tier (L2/SRE/owner) with a complete report. " +
    "This is the required terminal action for every incident.",
  parameters: EscalationParams,
  execute: async (_toolCallId, params) => {
    const report = renderReport(params);

    const dir = path.resolve(process.cwd(), "escalations");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `escalation-${Date.now()}.md`);
    await writeFile(file, `${report}\n`, "utf-8");

    return {
      content: [
        {
          type: "text",
          text:
            `Incident escalated (${params.severity}). Handoff written to ${file}.\n\n${report}`,
        },
      ],
      details: { file, report: params },
      // Escalation is terminal: stop the loop after this batch.
      terminate: true,
    };
  },
};
