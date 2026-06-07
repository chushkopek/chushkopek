import { Type, type Static } from "@earendil-works/pi-ai";
import type { Subagent, SubagentContext } from "../types.js";
import { runLlmSubagent } from "../runtime.js";
import { WEB_SEARCH_PROMPT } from "./prompt.js";
import { webSearchTool } from "./tools.js";

const InputSchema = Type.Object({
  question: Type.String({
    description:
      "The focused research question to investigate (e.g. 'known CVE for unsanitized HTML bio in storefront stack').",
  }),
  context: Type.Optional(
    Type.String({
      description: "Optional incident context to scope the search.",
    }),
  ),
});

type Input = Static<typeof InputSchema>;

interface Details {
  finalText: string;
}

function renderTask(input: Input): string {
  return [
    `Research question: ${input.question}`,
    input.context ? `\nIncident context:\n${input.context}` : undefined,
  ]
    .filter((l): l is string => l !== undefined)
    .join("\n");
}

/**
 * Investigative subagent the Analyze phase can pull on demand to fill a gap in
 * the gathered context. Auto-discovered, so it appears as a tool to the parent
 * L1 agent without any wiring.
 */
export const subagent: Subagent<typeof InputSchema, Details> = {
  name: "web_search",
  label: "Web Search",
  description:
    "Delegate to a subagent that researches a focused question on the web when " +
    "the gathered incident context has a gap (e.g. identifying a CVE, an error " +
    "signature, or a dependency advisory). Provide the question and optional " +
    "context; it returns a concise, cited answer.",
  inputSchema: InputSchema,
  run: async (input: Input, ctx: SubagentContext) => {
    const { finalText } = await runLlmSubagent({
      ctx,
      systemPrompt: WEB_SEARCH_PROMPT,
      tools: [webSearchTool],
      task: renderTask(input),
    });
    return {
      summary: finalText || "Web search returned no usable answer.",
      details: { finalText },
    };
  },
};
