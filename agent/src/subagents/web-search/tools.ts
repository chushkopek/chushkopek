import { Type, type Static } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createWebSearchClient, type SearchResponse } from "./search-client.js";

const SearchParams = Type.Object({
  query: Type.String({ description: "The search query." }),
  maxResults: Type.Optional(
    Type.Number({ description: "Max results to return (default 5)." }),
  ),
});

export type SearchArgs = Static<typeof SearchParams>;

const client = createWebSearchClient();

/** Run a web search. Non-terminal: the subagent may search several times. */
export const webSearchTool: AgentTool<typeof SearchParams, SearchResponse> = {
  name: "search_web",
  label: "Search Web",
  description: "Search the web for references relevant to the incident.",
  parameters: SearchParams,
  execute: async (_toolCallId, params) => {
    const response = await client.search(params);
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
