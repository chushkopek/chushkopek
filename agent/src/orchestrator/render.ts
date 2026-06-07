import type { ProviderSlice } from "../context/types.js";
import type { IncidentContext } from "./types.js";

/** Pretty-print a slice's structured payload as a compact, readable block. */
function renderData(data: unknown): string {
  if (data === undefined || data === null) return "(no structured data)";
  if (typeof data === "string") return data;
  try {
    return "```json\n" + JSON.stringify(data, null, 2) + "\n```";
  } catch {
    return String(data);
  }
}

function renderSlice(slice: ProviderSlice): string {
  const flag = slice.simulated ? " · simulated" : "";
  const lines = [`### ${slice.source} [${slice.status}${flag}]`, slice.summary];
  if (slice.status === "ok") {
    lines.push("", renderData(slice.data));
  } else if (slice.status === "error" && slice.error) {
    lines.push("", `_Error: ${slice.error}_`);
  } else if (slice.status === "unavailable") {
    lines.push("", "_Source unavailable — treat as an unknown to escalate._");
  }
  return lines.join("\n");
}

/**
 * Render the gathered {@link IncidentContext} into a single user prompt for the
 * Analyze phase. The system prompt already defines the L1 operating loop, so we
 * only supply the per-incident evidence plus an explicit steer toward the
 * structured `escalate` call.
 */
export function renderAnalysisPrompt(context: IncidentContext): string {
  const sections = context.slices.map(renderSlice).join("\n\n");

  return `A production incident has been paged to you. Work it as L1 on-call and \
escalate when done.

## Paged incident
${context.trigger}

## Gathered incident context
The following evidence was collected automatically from each available source.
Simulated slices are demo data — reason over them, but never fabricate beyond
what is shown. Unavailable or errored sources are known gaps: treat them as
unknowns to escalate, do not invent their contents.

${sections || "_(no context sources were available)_"}

## Your task
Follow the L1 process over the evidence above:
1. Triage — restate the incident, affected service, blast radius, severity.
2. Correlate the slices into a single root-cause hypothesis with a confidence level.
3. Classify the traffic from the usage/load-balancer evidence: organic surge
   (e.g. Black Friday) vs likely attack vs inconclusive.
4. Identify the suspected change (deploy/commit/PR) from the GitHub evidence.
5. Derive the owning team from CODEOWNERS where available.
6. If a gap blocks your analysis and an investigative tool (e.g. web_search) is
   available, use it before concluding.

Finish by calling the escalate tool exactly once, populating root_cause_hypothesis,
confidence, traffic_assessment, suspected_change, evidence_links, suggested_owner,
and owner_source whenever the evidence supports them.`;
}
