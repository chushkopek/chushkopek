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
});

export type EscalationReport = Static<typeof EscalationParams>;

function renderReport(report: EscalationReport): string {
  const lines: string[] = [];
  lines.push(`# INCIDENT ESCALATION [${report.severity.toUpperCase()}]`);
  lines.push("");
  lines.push(`Summary: ${report.summary}`);
  lines.push(`Current state: ${report.current_state}`);
  if (report.suggested_owner) lines.push(`Suggested owner: ${report.suggested_owner}`);
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
