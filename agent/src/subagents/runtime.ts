import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import type { SubagentContext } from "./types.js";

export interface RunLlmSubagentOptions {
  /** Runtime context handed down from the parent. */
  ctx: SubagentContext;
  /** Focused system prompt for this subagent's loop. */
  systemPrompt: string;
  /** Tools the subagent may call. */
  tools: AgentTool<any>[];
  /** The task/prompt to run (usually rendered from the subagent input). */
  task: string;
  /**
   * If set, capture the `details` of the last successful tool result with this
   * name. Useful when a tool produces the subagent's structured output.
   */
  captureToolName?: string;
}

export interface RunLlmSubagentResult<TCaptured = unknown> {
  /** Final assistant text from the subagent's run. */
  finalText: string;
  /** Captured tool details, if `captureToolName` was provided and matched. */
  captured?: TCaptured;
  /** Set when the model turn ended with stopReason "error". */
  llmError?: string;
}

/** Extract concatenated text from the last assistant message in a transcript. */
function lastAssistantText(messages: AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== "assistant") continue;
    const content = (msg as { content?: unknown }).content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .filter((b): b is { type: "text"; text: string } =>
          Boolean(b) && (b as { type?: string }).type === "text",
        )
        .map((b) => b.text)
        .join("")
        .trim();
    }
    return "";
  }
  return "";
}

/** Return the error message from the last failed assistant turn, if any. */
function lastAssistantError(messages: AgentMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== "assistant") continue;
    const assistant = msg as {
      stopReason?: string;
      errorMessage?: string;
    };
    if (assistant.stopReason === "error" && assistant.errorMessage) {
      return assistant.errorMessage;
    }
  }
  return undefined;
}

/**
 * Run a subagent as its own isolated pi `Agent` loop.
 *
 * This is the common path for LLM-driven subagents: it spins up a child agent
 * with a focused prompt and tools, runs the task to completion, forwards events
 * to the parent's observability sink, and returns the final text plus any
 * captured tool output. Subagents that are purely deterministic can skip this
 * and implement `run()` directly.
 */
export async function runLlmSubagent<TCaptured = unknown>(
  options: RunLlmSubagentOptions,
): Promise<RunLlmSubagentResult<TCaptured>> {
  const { ctx, systemPrompt, tools, task, captureToolName } = options;

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model: ctx.model,
      thinkingLevel: ctx.thinkingLevel,
      tools,
    },
    getApiKey: ctx.getApiKey,
    toolExecution: "sequential",
  });

  let captured: TCaptured | undefined;
  agent.subscribe((event) => {
    ctx.onEvent?.(event);
    if (
      captureToolName &&
      event.type === "tool_execution_end" &&
      event.toolName === captureToolName &&
      !event.isError
    ) {
      captured = (event.result as { details?: TCaptured } | undefined)?.details;
    }
  });

  // Propagate parent cancellation into the child run.
  if (ctx.signal) {
    if (ctx.signal.aborted) agent.abort();
    else ctx.signal.addEventListener("abort", () => agent.abort(), { once: true });
  }

  await agent.prompt(task);
  await agent.waitForIdle();

  const llmError = lastAssistantError(agent.state.messages);
  return {
    finalText: lastAssistantText(agent.state.messages),
    captured,
    llmError,
  };
}
