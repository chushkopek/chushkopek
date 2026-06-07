import type { EscalationReport } from "../../../tools/escalate.js";
import type { Dispatcher, EscalationOutcome } from "../../types.js";
import { stubsEnabled } from "../../../stubs.js";

/**
 * Slack dispatcher — hands the finished escalation to the slack-alerting service
 * (the FastAPI relay that fans notifications into Slack via incoming webhooks).
 * Owner: Iva. Deterministic (no LLM).
 *
 * It POSTs the {@link EscalationReport}, mapped to the relay's `EscalationRequest`
 * schema, to `POST {SLACK_ALERTING_URL}/v1/escalations` (→ #escalations),
 * authenticated with `SLACK_L1_API_KEY` (sent as the `X-API-Key` header).
 *
 * Wiring (agent/.env):
 *   SLACK_ALERTING_URL=http://127.0.0.1:8000   # base URL of the relay
 *   SLACK_L1_API_KEY=...                        # shared secret (omit if relay auth is off)
 *
 * Without `SLACK_ALERTING_URL` the channel falls back to a simulated stub and is
 * only active in demo mode (`ENABLE_STUBS=1`).
 */

const ENDPOINT = "/v1/escalations";
const SOURCE = "chushkopek-l1-agent";
const CHANNEL = "#escalations";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface SlackMessage {
  channel: string;
  text: string;
}

export interface PostedMessage {
  channel: string;
  ts: string;
  permalink: string;
  simulated: boolean;
}

/** The function-call seam: replace with a real Slack client. */
export interface SlackClient {
  postMessage(message: SlackMessage): Promise<PostedMessage>;
}

let warnedStub = false;

function createStubSlackClient(): SlackClient {
  return {
    async postMessage(message): Promise<PostedMessage> {
      if (!warnedStub) {
        console.warn(
          "[slack] Using STUB Slack client — no message is actually posted. " +
            "Set SLACK_ALERTING_URL to post to the slack-alerting service.",
        );
        warnedStub = true;
      }
      const ts = "1717770000.000100";
      return {
        channel: message.channel,
        ts,
        permalink: `https://acme.slack.com/archives/C123/p${ts.replace(".", "")}`,
        simulated: true,
      };
    },
  };
}

/** Map our sev1..sev4 to the relay's info|warning|critical vocabulary. */
const SEVERITY_MAP: Record<EscalationReport["severity"], "info" | "warning" | "critical"> = {
  sev1: "critical",
  sev2: "critical",
  sev3: "warning",
  sev4: "info",
};

/** Map our sev1..sev4 to a P1..P4 priority (the relay caps `priority` at 8 chars). */
const PRIORITY_MAP: Record<EscalationReport["severity"], string> = {
  sev1: "P1",
  sev2: "P2",
  sev3: "P3",
  sev4: "P4",
};

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** The relay validates `links[].url` as a real http(s) URL; drop anything else. */
function toLinks(urls: string[] | undefined): Array<{ label: string; url: string }> {
  const links: Array<{ label: string; url: string }> = [];
  for (const raw of urls ?? []) {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      links.push({ label: truncate(parsed.hostname || raw, 120), url: raw });
    } catch {
      // not a URL — skip
    }
  }
  return links;
}

/** Extra single-value diagnostics the relay renders as a context block (str→str). */
function toContext(report: EscalationReport): Record<string, string> {
  const ctx: Record<string, string> = { current_state: truncate(report.current_state, 300) };
  const add = (k: string, v: string | undefined) => {
    if (v) ctx[k] = truncate(v, 300);
  };
  add("incident_class", report.incident_class);
  add("confidence", report.confidence);
  add("traffic_assessment", report.traffic_assessment);
  add("suspected_change", report.suspected_change);
  add("external_factors", report.external_factors);
  add("owner_source", report.owner_source);
  return ctx;
}

/** EscalationReport → the relay's EscalationRequest body (extra fields forbidden). */
function buildEscalationRequest(report: EscalationReport): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: truncate(`[${report.severity.toUpperCase()}] ${report.summary}`, 150),
    description: truncate(renderSlackText(report), 3000),
    severity: SEVERITY_MAP[report.severity],
    source: SOURCE,
    priority: PRIORITY_MAP[report.severity],
    reason: truncate(report.root_cause_hypothesis ?? report.summary, 1000),
    attempted: report.actions_taken.map((a) => truncate(`${a.action} → ${a.result}`, 300)),
    links: toLinks(report.evidence_links),
    context: toContext(report),
    tags: [report.incident_class, report.confidence, report.traffic_assessment].filter(
      (t): t is NonNullable<typeof t> => t !== undefined,
    ),
  };
  if (report.suggested_owner) body.suggested_owner = truncate(report.suggested_owner, 80);
  return body;
}

function dispatchSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function renderSlackText(report: EscalationReport): string {
  const owner = report.suggested_owner ? ` · owner ${report.suggested_owner}` : "";
  const klass = report.incident_class ? `\n*Class:* ${report.incident_class}` : "";
  const cause = report.root_cause_hypothesis
    ? `\n*Suspected cause:* ${report.root_cause_hypothesis}` +
      (report.confidence ? ` (confidence: ${report.confidence})` : "")
    : "";
  const external = report.external_factors
    ? `\n*External factors:* ${report.external_factors}`
    : "";
  const next = report.recommended_next_steps.map((s) => `• ${s}`).join("\n");
  return (
    `:rotating_light: *[${report.severity.toUpperCase()}] ${report.summary}*${owner}\n` +
    `*Affected:* ${report.affected_systems.join(", ")}\n` +
    `*State:* ${report.current_state}${klass}${cause}${external}\n` +
    `*Next steps:*\n${next}`
  );
}

/** POST the escalation to the slack-alerting relay. Throws on transport/HTTP error. */
async function postToRelay(
  baseUrl: string,
  report: EscalationReport,
  signal: AbortSignal | undefined,
): Promise<{ delivered: boolean }> {
  const apiKey = process.env.SLACK_L1_API_KEY?.trim();
  const timeoutMs = Number(process.env.SLACK_HTTP_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const url = new URL(ENDPOINT, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).href;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "X-API-Key": apiKey } : {}),
    },
    body: JSON.stringify(buildEscalationRequest(report)),
    signal: dispatchSignal(signal, timeoutMs),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`slack-alerting ${res.status}: ${truncate(detail || res.statusText, 300)}`);
  }
  const json = (await res.json().catch(() => ({}))) as { delivered?: boolean };
  return { delivered: json.delivered === true };
}

export const dispatcher: Dispatcher = {
  name: "slack",
  label: "Slack Escalation Post",
  // Active when a relay URL is configured; otherwise simulated stub (demo mode only).
  enabled: () => Boolean(process.env.SLACK_ALERTING_URL?.trim()) || stubsEnabled(),
  async dispatch(report, ctx): Promise<EscalationOutcome> {
    const baseUrl = process.env.SLACK_ALERTING_URL?.trim();
    try {
      if (baseUrl) {
        const { delivered } = await postToRelay(baseUrl, report, ctx.signal);
        return {
          channel: "slack",
          status: "delivered",
          simulated: !delivered, // relay ran in dry-run when delivered === false
          summary: delivered
            ? `Posted escalation to ${CHANNEL} via slack-alerting.`
            : `slack-alerting accepted the escalation in dry-run (not posted to ${CHANNEL}).`,
          ref: `${baseUrl.replace(/\/$/, "")}${ENDPOINT}`,
        };
      }

      // No relay configured — simulated stub (demo mode only).
      const posted = await createStubSlackClient().postMessage({
        channel: CHANNEL,
        text: renderSlackText(report),
      });
      return {
        channel: "slack",
        status: "delivered",
        simulated: posted.simulated,
        summary: `Posted incident summary to ${posted.channel}.`,
        ref: posted.permalink,
      };
    } catch (err) {
      return {
        channel: "slack",
        status: "failed",
        summary: "Failed to post to Slack.",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
