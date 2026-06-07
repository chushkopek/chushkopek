import { Type, type Static } from "@earendil-works/pi-ai";
import type { Subagent, SubagentContext } from "../types.js";
import {
  investigateExternalEvents,
  type ExternalEventsResult,
} from "../../external-events/investigate.js";

const InputSchema = Type.Object({
  service: Type.String({ description: "The failing service, e.g. 'storefront'." }),
  affected_component: Type.Optional(
    Type.String({ description: "The affected part/feature, if known, e.g. 'profile'." }),
  ),
  symptom: Type.String({
    description: "The observed symptom, e.g. 'OOM crashloop on POST /profile'.",
  }),
  time_window: Type.Optional(
    Type.String({ description: "Incident time window, e.g. 'last 2h' or an ISO date." }),
  ),
  region: Type.Optional(Type.String({ description: "Affected region, if relevant." })),
});

type Input = Static<typeof InputSchema>;

/**
 * Investigative subagent (agent-pulled, default path): finds real-world
 * events/trends that could explain the incident as organic/external rather than
 * an attack or a code bug. Wraps the shared external-events core.
 */
export const subagent: Subagent<typeof InputSchema, ExternalEventsResult> = {
  name: "external_events",
  label: "External Events & Trends",
  description:
    "Delegate here to check whether a real-world event or trend (viral moment, " +
    "holiday/sale, news/sport, marketing launch, upstream/partner outage, or a " +
    "freshly-disclosed advisory) could explain the incident as organic/external " +
    "rather than an attack or a single bug. Returns a verdict + cited answer.",
  inputSchema: InputSchema,
  run: async (input: Input, ctx: SubagentContext) => {
    const result = await investigateExternalEvents(input, ctx);
    return {
      summary: `external_factor=${result.externalFactor}: ${result.answer}`,
      details: result,
    };
  },
};
