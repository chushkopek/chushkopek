import { Agent } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { getApiKey, loadConfig } from "./config.js";
import { SYSTEM_PROMPT } from "./prompts.js";
import { buildTools } from "./tools/index.js";
import { buildSubagentTools } from "./subagents/index.js";

/** Provider/model config shared by the parent agent, providers, and dispatchers. */
export interface RuntimeBase {
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  getApiKey: (provider: string) => string | undefined;
}

export interface BuildAgentResult {
  agent: Agent;
  describe: string;
  /** Names of the subagents discovered and wired as tools. */
  subagents: string[];
  /** Resolved runtime config, reused for context providers / dispatchers. */
  runtime: RuntimeBase;
}

export interface BuildAgentOptions {
  /** Override the system prompt. Defaults to the L1 on-call prompt. */
  systemPrompt?: string;
}

/** Construct the L1 on-call agent wired with config, prompt, tools, subagents. */
export async function buildAgent(
  options: BuildAgentOptions = {},
): Promise<BuildAgentResult> {
  const { provider, model, thinkingLevel } = loadConfig();
  const runtime: RuntimeBase = { model, thinkingLevel, getApiKey };

  // Subagents inherit the parent's provider/model config and are exposed as
  // tools the parent can delegate to (e.g. an on-demand web_search during
  // analysis). They do not replace the deterministic gather/dispatch phases.
  const subagentTools = await buildSubagentTools({ model, thinkingLevel, getApiKey });
  const tools = [...buildTools(), ...subagentTools];

  const agent = new Agent({
    initialState: {
      systemPrompt: options.systemPrompt ?? SYSTEM_PROMPT,
      model,
      thinkingLevel,
      tools,
    },
    getApiKey,
    // Run remediation/diagnostic tools one at a time. During an incident,
    // ordered and observable actions beat concurrency.
    toolExecution: "sequential",
  });

  return {
    agent,
    describe: `${provider}/${model.id} (thinking: ${thinkingLevel})`,
    subagents: subagentTools.map((t) => t.name),
    runtime,
  };
}

/**
 * Attach a simple human-readable renderer to the agent. Streams assistant text,
 * surfaces tool calls, and prints a marker when the run ends.
 */
export function attachConsoleRenderer(agent: Agent): () => void {
  let streamingText = false;

  const endStream = () => {
    if (streamingText) {
      process.stdout.write("\n");
      streamingText = false;
    }
  };

  return agent.subscribe((event) => {
    switch (event.type) {
      case "message_update": {
        const inner = event.assistantMessageEvent;
        if (inner.type === "text_delta") {
          streamingText = true;
          process.stdout.write(inner.delta);
        }
        break;
      }
      case "tool_execution_start": {
        endStream();
        const args = JSON.stringify(event.args);
        const preview = args.length > 200 ? `${args.slice(0, 200)}…` : args;
        process.stdout.write(`\n  → [tool] ${event.toolName} ${preview}\n`);
        break;
      }
      case "tool_execution_end": {
        const status = event.isError ? "ERROR" : "ok";
        process.stdout.write(`  ← [tool] ${event.toolName} (${status})\n`);
        break;
      }
      case "agent_end": {
        endStream();
        process.stdout.write("\n--- incident run complete ---\n");
        break;
      }
      default:
        break;
    }
  });
}
