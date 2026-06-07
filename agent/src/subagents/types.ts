import type { Model } from "@earendil-works/pi-ai";
import type { Static, TSchema } from "@earendil-works/pi-ai";
import type { AgentEvent, ThinkingLevel } from "@earendil-works/pi-agent-core";

/**
 * Shared runtime a subagent is given when it runs. The parent agent supplies
 * the model/credentials so every subagent inherits the same provider config.
 */
export interface SubagentContext {
  /** Model the subagent should run its own loop with. */
  model: Model<any>;
  /** Reasoning level inherited from the parent. */
  thinkingLevel: ThinkingLevel;
  /** Dynamic API key resolver inherited from the parent. */
  getApiKey: (provider: string) => string | undefined;
  /** Abort signal from the parent tool call. Honor it in long-running work. */
  signal?: AbortSignal;
  /** Optional sink for the subagent's internal events (for observability). */
  onEvent?: (event: AgentEvent) => void;
}

/** Structured result a subagent returns to the parent agent. */
export interface SubagentResult<TDetails = unknown> {
  /** Short, human/LLM-readable result handed back to the parent agent. */
  summary: string;
  /** Optional structured payload for logs/UI/downstream tooling. */
  details?: TDetails;
}

/**
 * A subagent is a focused, independently-ownable unit of work.
 *
 * Each subagent lives in its own folder under `src/subagents/<name>/` and is
 * auto-discovered (see `registry.ts`) — teammates add a folder, never edit a
 * shared registry file. Every subagent is exposed to the parent L1 agent as a
 * single tool named `name`, with `inputSchema` as that tool's parameters.
 *
 * See `agent/docs/subagents.md` for the authoring guide.
 */
export interface Subagent<TInput extends TSchema = TSchema, TDetails = unknown> {
  /**
   * Tool name the parent uses to invoke this subagent. Must be unique,
   * snake_case, and stable (e.g. "create_github_issue").
   */
  name: string;
  /** Human-readable label for UI/logs. */
  label: string;
  /**
   * Tells the parent agent WHEN to delegate here. Write it as guidance to the
   * LLM, not just a description of the subagent.
   */
  description: string;
  /** Typebox schema for the input the parent must provide. */
  inputSchema: TInput;
  /** Run the subagent to completion and return a structured result. */
  run(input: Static<TInput>, ctx: SubagentContext): Promise<SubagentResult<TDetails>>;
}

/** Minimal runtime config needed to instantiate subagent tools. */
export interface SubagentRuntimeBase {
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  getApiKey: (provider: string) => string | undefined;
}
