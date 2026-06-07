/**
 * Web search client shared by the web-search subagent and the external-events
 * investigator.
 *
 * When `EXA_API_KEY` is set, {@link createWebSearchClient} returns a real
 * [Exa](https://exa.ai) client; otherwise it returns a STUB so the chain stays
 * runnable without a search provider. Swap happens behind this interface — no
 * caller changes.
 */
export interface SearchQuery {
  query: string;
  maxResults?: number;
  /**
   * Optional ISO date (YYYY-MM-DD). When set, only results published on/after
   * this date are returned — used by the external-events investigator to scope
   * to the incident window.
   */
  startPublishedDate?: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  results: SearchResult[];
  /** True when produced by the stub rather than a real search provider. */
  simulated: boolean;
}

export interface WebSearchClient {
  search(query: SearchQuery): Promise<SearchResponse>;
}

const EXA_ENDPOINT = "https://api.exa.ai/search";

/** Real Exa-backed client. */
function createExaClient(apiKey: string): WebSearchClient {
  return {
    async search(query): Promise<SearchResponse> {
      const body: Record<string, unknown> = {
        query: query.query,
        type: "auto",
        numResults: query.maxResults ?? 5,
        contents: { text: { maxCharacters: 600 } },
      };
      if (query.startPublishedDate) body.startPublishedDate = query.startPublishedDate;

      const res = await fetch(EXA_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`Exa search failed: ${res.status} ${res.statusText} ${detail}`.trim());
      }

      const json = (await res.json()) as {
        results?: { title?: string; url?: string; text?: string }[];
      };
      const results: SearchResult[] = (json.results ?? []).map((r) => ({
        title: r.title ?? r.url ?? "(untitled)",
        url: r.url ?? "",
        snippet: (r.text ?? "").replace(/\s+/g, " ").trim().slice(0, 500),
      }));
      return { results, simulated: false };
    },
  };
}

let warnedStub = false;

/** STUB client. Returns a placeholder result and warns once. */
function createStubClient(): WebSearchClient {
  return {
    async search(query): Promise<SearchResponse> {
      if (!warnedStub) {
        console.warn(
          "[web-search] Using STUB web search client — results are placeholders. " +
            "Set EXA_API_KEY to enable real Exa search.",
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
              "Stub search result. Set EXA_API_KEY to return live references for " +
              "the failure context.",
          },
        ],
      };
    },
  };
}

/**
 * Build the search client. Prefers Exa when `EXA_API_KEY` is present, else the
 * stub. Re-reads the env per call so tests/CLI can toggle it.
 */
export function createWebSearchClient(): WebSearchClient {
  const apiKey = process.env.EXA_API_KEY?.trim();
  return apiKey ? createExaClient(apiKey) : createStubClient();
}
