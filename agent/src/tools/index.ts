import type { AgentTool } from "@earendil-works/pi-agent-core";
import { escalateTool } from "./escalate.js";

/**
 * Build the toolset available to the L1 agent.
 *
 * Today this is just the terminal escalation tool. The next milestone is to add
 * GitHub access tools (read repos/issues/PRs/Actions, open escalation issues,
 * etc.) — register them here as they land.
 */
export function buildTools(): AgentTool<any>[] {
  return [escalateTool];
}

export { escalateTool };
