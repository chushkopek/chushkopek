import { Type, type Static } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  createWebSearchClient,
  type SearchResponse,
} from "../subagents/web-search/search-client.js";

const client = createWebSearchClient();

const SearchParams = Type.Object({
  query: Type.String({ description: "The search query." }),
  published_after: Type.Optional(
    Type.String({
      description:
        "ISO date (YYYY-MM-DD). Restrict to results published on/after this date " +
        "to scope the search to recent events/trends near the incident.",
    }),
  ),
  maxResults: Type.Optional(Type.Number({ description: "Max results (default 5)." })),
});

export type SearchArgs = Static<typeof SearchParams>;

/** Web search scoped for finding recent real-world events/trends. */
export const searchEventsTool: AgentTool<typeof SearchParams, SearchResponse> = {
  name: "search_web",
  label: "Search Web",
  description:
    "Search the web for real-world events, trends, or external incidents relevant " +
    "to the failing service. Use published_after to focus on recent items.",
  parameters: SearchParams,
  execute: async (_toolCallId, params) => {
    const response = await client.search({
      query: params.query,
      maxResults: params.maxResults,
      startPublishedDate: params.published_after,
    });
    const rendered = response.results
      .map((r) => `- ${r.title}\n  ${r.url}\n  ${r.snippet}`)
      .join("\n");
    const note = response.simulated ? " (simulated — stub client)" : "";
    return {
      content: [{ type: "text", text: `Results${note}:\n${rendered}` }],
      details: response,
    };
  },
};

const ReportParams = Type.Object({
  external_factor: Type.Union(
    [Type.Literal("found"), Type.Literal("none"), Type.Literal("inconclusive")],
    {
      description:
        "found = a real-world event/trend plausibly explains the incident as " +
        "organic/external; none = nothing external found; inconclusive = unclear.",
    },
  ),
  answer: Type.String({
    description:
      "A concise, factual summary of what (if anything) external could explain the " +
      "incident, citing the sources used.",
  }),
  citations: Type.Array(Type.String(), {
    description: "URLs of the sources relied on. Empty if none.",
  }),
});

export type ReportArgs = Static<typeof ReportParams>;

/** Terminal tool: the investigator reports its structured verdict and stops. */
export const reportFindingsTool: AgentTool<typeof ReportParams, ReportArgs> = {
  name: "report_external_findings",
  label: "Report External Findings",
  description:
    "Report the structured verdict on external events/trends. Call this exactly " +
    "once when done.",
  parameters: ReportParams,
  execute: async (_toolCallId, params) => {
    return {
      content: [
        {
          type: "text",
          text: `Reported external_factor=${params.external_factor}.`,
        },
      ],
      details: params,
      terminate: true,
    };
  },
};
