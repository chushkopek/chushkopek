import type { Model } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { EscalationReport } from "../tools/escalate.js";

/**
 * Escalation fan-out contract (Phase 3 of the orchestration pipeline).
 *
 * A {@link Dispatcher} delivers the finished {@link EscalationReport} to ONE
 * channel (Slack, PagerDuty, a fix-PR, …). Dispatchers run deterministically
 * and in parallel, so the report always reaches every channel — fan-out is a
 * guarantee, not something the LLM decides.
 *
 * Authoring guide: agent/docs/dispatchers.md
 */

/** Outcome of delivering to one channel. */
export type DispatchStatus = "delivered" | "skipped" | "failed";

/** Structured result of a single dispatch, surfaced to the CLI/demo. */
export interface EscalationOutcome {
  /** Channel key — mirrors the dispatcher `name`, e.g. "slack". */
  channel: string;
  status: DispatchStatus;
  /** Human-readable result, e.g. "Posted to #incidents" / "Opened PR #1234". */
  summary: string;
  /** A reference to the delivered artifact (URL, message ts, PR link). */
  ref?: string;
  /** Failure detail. Populated when `status === "failed"`. */
  error?: string;
  /** True when produced by a stub rather than a real integration. */
  simulated?: boolean;
}

/**
 * Runtime handed to a dispatcher. Deterministic channels use only `signal`;
 * LLM-backed dispatchers (e.g. suggest-fix-pr) use the model config to run a
 * child agent.
 */
export interface DispatcherContext {
  signal?: AbortSignal;
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  getApiKey: (provider: string) => string | undefined;
}

/**
 * A dispatcher: one folder under `src/escalation/channels/<name>/`,
 * auto-discovered (no shared file to edit).
 *
 * IMPORTANT: `dispatch` MUST NOT throw. Catch internally and return an outcome
 * with `status: "failed"` so one failing channel can never abort the fan-out.
 */
export interface Dispatcher {
  /** Unique, stable kebab key, e.g. "pagerduty". Mirrors the outcome channel. */
  name: string;
  /** Human-readable label for logs/UI. */
  label: string;
  /** Deliver the report to this channel. Always resolves; never rejects. */
  dispatch(report: EscalationReport, ctx: DispatcherContext): Promise<EscalationOutcome>;
}

/** Minimal config used to build a {@link DispatcherContext}. */
export interface DispatcherRuntimeBase {
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  getApiKey: (provider: string) => string | undefined;
}
