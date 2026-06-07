import type { EscalationReport } from "../tools/escalate.js";
import { loadDispatchers } from "./registry.js";
import type {
  DispatcherContext,
  DispatcherRuntimeBase,
  EscalationOutcome,
} from "./types.js";

/**
 * Phase 3 — fan the finished report out to every discovered channel in
 * parallel. Dispatchers must not throw, but we defend anyway: a rejection
 * becomes a `status: "failed"` outcome so one failing channel never aborts the
 * rest of the fan-out.
 */
export async function runDispatch(
  report: EscalationReport,
  base: DispatcherRuntimeBase,
  signal?: AbortSignal,
): Promise<EscalationOutcome[]> {
  const dispatchers = await loadDispatchers();
  const ctx: DispatcherContext = { signal, ...base };

  const settled = await Promise.allSettled(
    dispatchers.map((d) => d.dispatch(report, ctx)),
  );

  return settled.map((result, i) => {
    const dispatcher = dispatchers[i]!;
    if (result.status === "fulfilled") return result.value;
    const reason = result.reason;
    return {
      channel: dispatcher.name,
      status: "failed" as const,
      summary: `${dispatcher.label} dispatcher threw during dispatch.`,
      error: reason instanceof Error ? reason.message : String(reason),
    } satisfies EscalationOutcome;
  });
}
