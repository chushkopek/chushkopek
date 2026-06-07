import { Agent } from "@earendil-works/pi-agent-core";
import { getApiKey, loadConfig } from "./config.js";
import { SYSTEM_PROMPT } from "./prompts.js";
import { buildTools } from "./tools/index.js";

export interface BuildAgentResult {
  agent: Agent;
  describe: string;
}

/** Construct the L1 on-call agent wired with config, prompt, and tools. */
export function buildAgent(): BuildAgentResult {
  const { provider, model, thinkingLevel } = loadConfig();

  const agent = new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model,
      thinkingLevel,
      tools: buildTools(),
    },
    getApiKey,
    // Run remediation/diagnostic tools one at a time. During an incident,
    // ordered and observable actions beat concurrency.
    toolExecution: "sequential",
  });

  return { agent, describe: `${provider}/${model.id} (thinking: ${thinkingLevel})` };
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
