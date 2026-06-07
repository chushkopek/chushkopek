import type { EscalationReport } from "../../../tools/escalate.js";
import type { Dispatcher, EscalationOutcome } from "../../types.js";

/**
 * Slack dispatcher — posts the full incident summary to the incident channel.
 * Owner: Iva. Deterministic (no LLM). Replace the stub client with a real Slack
 * Web API call (chat.postMessage) and the subagent chain stays unchanged.
 */

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
            "Wire the real Web API client in the Slack integration task.",
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

const CHANNEL = "#incidents";
const slack = createStubSlackClient();

function renderSlackText(report: EscalationReport): string {
  const owner = report.suggested_owner ? ` · owner ${report.suggested_owner}` : "";
  const cause = report.root_cause_hypothesis
    ? `\n*Suspected cause:* ${report.root_cause_hypothesis}` +
      (report.confidence ? ` (confidence: ${report.confidence})` : "")
    : "";
  const next = report.recommended_next_steps.map((s) => `• ${s}`).join("\n");
  return (
    `:rotating_light: *[${report.severity.toUpperCase()}] ${report.summary}*${owner}\n` +
    `*Affected:* ${report.affected_systems.join(", ")}\n` +
    `*State:* ${report.current_state}${cause}\n` +
    `*Next steps:*\n${next}`
  );
}

export const dispatcher: Dispatcher = {
  name: "slack",
  label: "Slack Incident Post",
  async dispatch(report): Promise<EscalationOutcome> {
    try {
      const posted = await slack.postMessage({
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
