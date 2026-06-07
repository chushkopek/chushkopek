# Subagent template

Copy this into `src/subagents/<your-subagent>/index.ts` and adapt. See
[`subagents.md`](./subagents.md) for the full guide.

```ts
import { Type, type Static } from "@earendil-works/pi-ai";
import type { Subagent, SubagentContext } from "../types.js";
import { runLlmSubagent } from "../runtime.js";

const InputSchema = Type.Object({
  // Inputs the parent must provide. Add descriptions — the parent reads them.
  context: Type.String({ description: "Context the subagent needs." }),
});

type Input = Static<typeof InputSchema>;

interface Details {
  // Structured output for logs/UI/downstream tools.
  ok: boolean;
}

export const subagent: Subagent<typeof InputSchema, Details> = {
  name: "my_subagent",            // snake_case, unique, stable = the tool name
  label: "My Subagent",
  description:
    "Delegate here when … . Provide … ; it returns … .",
  inputSchema: InputSchema,
  run: async (input: Input, _ctx: SubagentContext) => {
    // Deterministic? Do the work here and return.
    // LLM-driven? Use runLlmSubagent({ ctx, systemPrompt, tools, task, captureToolName }).
    return {
      summary: `Did the thing with: ${input.context}`,
      details: { ok: true },
    };
  },
};
```
