import type { EscalationReport } from "../../../tools/escalate.js";
import type { Dispatcher, EscalationOutcome } from "../../types.js";

/**
 * PagerDuty dispatcher — raises one alert routed to the service owner with a
 * dynamic description. Owner: Strato. Deterministic (no LLM). Replace the stub
 * client with a real PagerDuty Events API v2 call.
 */

export interface PagerDutyAlert {
  severity: "critical" | "error" | "warning" | "info";
  summary: string;
  source: string;
  details: Record<string, unknown>;
}

export interface CreatedIncident {
  dedupKey: string;
  url: string;
  simulated: boolean;
}

/** The function-call seam: replace with a real PagerDuty client. */
export interface PagerDutyClient {
  trigger(alert: PagerDutyAlert): Promise<CreatedIncident>;
}

let warnedStub = false;

function createStubPagerDutyClient(): PagerDutyClient {
  return {
    async trigger(): Promise<CreatedIncident> {
      if (!warnedStub) {
        console.warn(
          "[pagerduty] Using STUB PagerDuty client — no alert is actually raised. " +
            "Wire the real Events API client in the PagerDuty integration task.",
        );
        warnedStub = true;
      }
      const dedupKey = "incident-storefront-a1b2c3d";
      return {
        dedupKey,
        url: `https://acme.pagerduty.com/incidents/${dedupKey}`,
        simulated: true,
      };
    },
  };
}

/** Map our sev1..sev4 to PagerDuty's severity vocabulary. */
const SEVERITY_MAP: Record<EscalationReport["severity"], PagerDutyAlert["severity"]> = {
  sev1: "critical",
  sev2: "error",
  sev3: "warning",
  sev4: "info",
};

const pagerduty = createStubPagerDutyClient();

export const dispatcher: Dispatcher = {
  name: "pagerduty",
  label: "PagerDuty Alert",
  async dispatch(report): Promise<EscalationOutcome> {
    try {
      const incident = await pagerduty.trigger({
        severity: SEVERITY_MAP[report.severity],
        summary: `[${report.severity.toUpperCase()}] ${report.summary}`,
        source: report.affected_systems[0] ?? "unknown",
        details: {
          affected_systems: report.affected_systems,
          current_state: report.current_state,
          root_cause_hypothesis: report.root_cause_hypothesis,
          suggested_owner: report.suggested_owner,
          recommended_next_steps: report.recommended_next_steps,
        },
      });
      const owner = report.suggested_owner ? ` (routed to ${report.suggested_owner})` : "";
      return {
        channel: "pagerduty",
        status: "delivered",
        simulated: incident.simulated,
        summary: `Raised ${report.severity} PagerDuty alert${owner}.`,
        ref: incident.url,
      };
    } catch (err) {
      return {
        channel: "pagerduty",
        status: "failed",
        summary: "Failed to raise PagerDuty alert.",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
