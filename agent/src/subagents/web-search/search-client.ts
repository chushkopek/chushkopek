/**
 * Web search client used by the web-search subagent.
 *
 * The real implementation (Brave/Bing/Tavily/SerpAPI, etc.) lands with a
 * dedicated task. Until then {@link createWebSearchClient} returns a STUB so the
 * investigative chain is runnable without a search provider. Swap the stub for
 * the real client without touching the subagent.
 */
export interface SearchQuery {
  query: string;
  maxResults?: number;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  results: SearchResult[];
  simulated: boolean;
}

export interface WebSearchClient {
  search(query: SearchQuery): Promise<SearchResponse>;
}

let warnedStub = false;

/** STUB client. Replace with a real search provider in the search task. */
export function createWebSearchClient(): WebSearchClient {
  return {
    async search(query): Promise<SearchResponse> {
      if (!warnedStub) {
        console.warn(
          "[web-search] Using STUB web search client — results are placeholders. " +
            "Wire a real search provider in the search integration task.",
        );
        warnedStub = true;
      }
      return {
        simulated: true,
        results: [
          {
            title: `(simulated) Reference for: ${query.query}`,
            url: "https://example.com/simulated-result",
            snippet:
              "Stub search result. Replace createWebSearchClient with a real " +
              "provider to return live references for the failure context.",
          },
        ],
      };
    },
  };
}
