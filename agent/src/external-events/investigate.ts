import type { Model } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { runLlmSubagent } from "../subagents/runtime.js";
import { EXTERNAL_EVENTS_PROMPT } from "./prompt.js";
import { reportFindingsTool, searchEventsTool, type ReportArgs } from "./tools.js";

export interface ExternalEventsInput {
  service: string;
  affected_component?: string;
  symptom: string;
  /**
   * A description of what the service IS and who uses it — used to GROUND the
   * search query (so the first search is about this kind of product/audience,
   * not just the error). Passed in by the caller; for the demo this is the
   * hardcoded service-context description.
   */
  serviceDescription?: string;
  /** e.g. "last 24h" or an ISO date — guides the search recency. */
  time_window?: string;
  region?: string;
}

/** Minimal runtime the core needs (satisfied by both Provider- and SubagentContext). */
export interface ExternalEventsRuntime {
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  getApiKey: (provider: string) => string | undefined;
  signal?: AbortSignal;
}

export interface ExternalEventsResult {
  /** "found" | "none" | "inconclusive" */
  externalFactor: ReportArgs["external_factor"];
  answer: string;
  citations: string[];
}

function renderTask(input: ExternalEventsInput): string {
  return [
    "## The affected service (ground your searches in this)",
    input.serviceDescription ?? `${input.service} (no description provided)`,
    "",
    "## The incident",
    `Service: ${input.service}`,
    input.affected_component ? `Affected component: ${input.affected_component}` : undefined,
    `Symptom: ${input.symptom}`,
    input.time_window ? `Time window: ${input.time_window}` : undefined,
    input.region ? `Region: ${input.region}` : undefined,
    "",
    "Ground your FIRST search in what this service is and who its users are, then " +
      "look for a real-world event/trend that could explain this incident as " +
      "organic or externally-caused rather than an attack or a code bug.",
  ]
    .filter((l): l is string => l !== undefined)
    .join("\n");
}

/**
 * Reusable core: investigate external events/trends and return a structured
 * verdict. Used by BOTH the `external_events` subagent (agent-pulled) and the
 * opt-in `external-events` context provider — one implementation, two surfaces.
 */
export async function investigateExternalEvents(
  input: ExternalEventsInput,
  ctx: ExternalEventsRuntime,
): Promise<ExternalEventsResult> {
  const { captured, finalText } = await runLlmSubagent<ReportArgs>({
    ctx,
    systemPrompt: EXTERNAL_EVENTS_PROMPT,
    tools: [searchEventsTool, reportFindingsTool],
    task: renderTask(input),
    captureToolName: "report_external_findings",
  });

  if (captured) {
    return {
      externalFactor: captured.external_factor,
      answer: captured.answer,
      citations: captured.citations,
    };
  }
  // The investigator ended without a structured report — treat as inconclusive.
  return {
    externalFactor: "inconclusive",
    answer: finalText || "No external-events verdict was produced.",
    citations: [],
  };
}
