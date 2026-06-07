import { attachConsoleRenderer, buildAgent } from "../agent.js";
import { gatherSlices } from "../context/registry.js";
import { runDispatch } from "../escalation/dispatch.js";
import type { EscalationReport } from "../tools/escalate.js";
import { renderAnalysisPrompt } from "./render.js";
import type { IncidentContext, OrchestratorResult } from "./types.js";

export interface RunOrchestratorOptions {
  /** Stream the Analyze phase agent output to the console. Default: true. */
  renderAnalysis?: boolean;
  /** Progress logger for phase boundaries. Default: console.log. */
  log?: (message: string) => void;
  /** Abort signal to cancel the whole run. */
  signal?: AbortSignal;
}

/** What the escalate tool stashes in its tool-result `details`. */
interface EscalateDetails {
  file: string;
  report: EscalationReport;
}

/**
 * The AI orchestration layer: a deterministic 3-phase pipeline wrapping an
 * agentic core.
 *
 *   1. GATHER   — run every context provider in parallel → IncidentContext
 *   2. ANALYZE  — the L1 agent reasons over the bundle and emits an EscalationReport
 *   3. DISPATCH — fan the report out to every channel in parallel
 *
 * Phases 1 and 3 are deterministic (no LLM) so every source is gathered and
 * every channel is notified — guarantees, not model decisions. The LLM runs
 * only in phase 2.
 */
export async function runOrchestrator(
  trigger: string,
  options: RunOrchestratorOptions = {},
): Promise<OrchestratorResult> {
  const log = options.log ?? ((m: string) => process.stdout.write(`${m}\n`));
  const renderAnalysis = options.renderAnalysis ?? true;

  const { agent, runtime, subagents } = await buildAgent();

  // --- Phase 1: Gather -----------------------------------------------------
  log("\n[1/3] Gathering incident context…");
  const slices = await gatherSlices(trigger, runtime, options.signal);
  for (const s of slices) {
    const flag = s.simulated ? " (simulated)" : "";
    log(`  • ${s.source}: ${s.status}${flag} — ${s.summary}`);
  }
  const context: IncidentContext = {
    trigger,
    slices,
    gatheredAt: new Date().toISOString(),
  };

  // --- Phase 2: Analyze (agentic) -----------------------------------------
  log(
    `\n[2/3] Analyzing incident…` +
      (subagents.length ? ` (investigative tools: ${subagents.join(", ")})` : ""),
  );

  let captured: EscalateDetails | undefined;
  const unsubscribeCapture = agent.subscribe((event) => {
    if (
      event.type === "tool_execution_end" &&
      event.toolName === "escalate" &&
      !event.isError
    ) {
      captured = (event.result as { details?: EscalateDetails } | undefined)?.details;
    }
  });
  const unsubscribeRender = renderAnalysis ? attachConsoleRenderer(agent) : undefined;

  // Propagate cancellation into the agent loop.
  if (options.signal) {
    if (options.signal.aborted) agent.abort();
    else options.signal.addEventListener("abort", () => agent.abort(), { once: true });
  }

  await agent.prompt(renderAnalysisPrompt(context));
  await agent.waitForIdle();

  unsubscribeCapture();
  unsubscribeRender?.();

  const report = captured?.report;
  const escalationFile = captured?.file;

  // --- Phase 3: Dispatch ---------------------------------------------------
  if (!report) {
    log(
      "\n[3/3] No escalation report was produced — skipping dispatch. " +
        "The analysis agent did not call the escalate tool.",
    );
    return { context, outcomes: [] };
  }

  log("\n[3/3] Dispatching escalation…");
  const outcomes = await runDispatch(report, runtime, options.signal);
  for (const o of outcomes) {
    const ref = o.ref ? ` → ${o.ref}` : "";
    const flag = o.simulated ? " (simulated)" : "";
    log(`  • ${o.channel}: ${o.status}${flag} — ${o.summary}${ref}`);
  }

  return { context, report, escalationFile, outcomes };
}

export type { IncidentContext, OrchestratorResult } from "./types.js";
