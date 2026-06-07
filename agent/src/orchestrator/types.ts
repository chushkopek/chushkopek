import type { ProviderSlice } from "../context/types.js";
import type { EscalationReport } from "../tools/escalate.js";
import type { EscalationOutcome } from "../escalation/types.js";

/**
 * The assembled, multi-source incident picture handed from Gather (Phase 1) to
 * Analyze (Phase 2). It is plain data — a bag of evidence — not an agent.
 */
export interface IncidentContext {
  /** Original paged incident text (verbatim). */
  trigger: string;
  /** Every gathered slice, in render order. Always one per discovered provider. */
  slices: ProviderSlice[];
  /** ISO timestamp the bundle was assembled. */
  gatheredAt: string;
}

/** Final result returned by {@link runOrchestrator}. */
export interface OrchestratorResult {
  /** The evidence bundle gathered in Phase 1. */
  context: IncidentContext;
  /** The structured report the agent produced in Phase 2 (if any). */
  report?: EscalationReport;
  /** Path to the markdown handoff written by the escalate tool. */
  escalationFile?: string;
  /** One outcome per dispatch channel from Phase 3. */
  outcomes: EscalationOutcome[];
}
