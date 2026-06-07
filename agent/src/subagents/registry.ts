import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Subagent, SubagentRuntimeBase } from "./types.js";

function isSubagent(value: unknown): value is Subagent {
  if (!value || typeof value !== "object") return false;
  const s = value as Partial<Subagent>;
  return (
    typeof s.name === "string" &&
    typeof s.label === "string" &&
    typeof s.description === "string" &&
    typeof s.run === "function" &&
    Boolean(s.inputSchema)
  );
}

/**
 * Discover every subagent under `src/subagents/<name>/`.
 *
 * Each subdirectory is expected to export a `subagent` (or default export) that
 * satisfies the {@link Subagent} contract. Discovery is filesystem-based so
 * teammates can add a subagent by dropping in a folder — no shared registry
 * file to edit, no merge conflicts. Folders starting with `_` or `.` are
 * ignored (use `_` for scaffolding/templates).
 */
export async function loadSubagents(): Promise<Subagent[]> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const entries = await readdir(here, { withFileTypes: true });
  const dirs = entries.filter(
    (e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith("."),
  );

  const subagents: Subagent[] = [];
  for (const dir of dirs) {
    const specifier = new URL(`./${dir.name}/index.js`, import.meta.url).href;
    try {
      const mod: Record<string, unknown> = await import(specifier);
      const candidate = mod.subagent ?? mod.default;
      if (isSubagent(candidate)) {
        subagents.push(candidate);
      } else {
        console.warn(
          `[subagents] "${dir.name}" has no valid 'subagent' export; skipping.`,
        );
      }
    } catch (err) {
      console.warn(
        `[subagents] failed to load "${dir.name}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const seen = new Set<string>();
  for (const s of subagents) {
    if (seen.has(s.name)) {
      throw new Error(
        `Duplicate subagent name "${s.name}". Subagent tool names must be unique.`,
      );
    }
    seen.add(s.name);
  }

  subagents.sort((a, b) => a.name.localeCompare(b.name));
  return subagents;
}

/** Wrap a subagent so the parent agent can invoke it as a single tool. */
export function subagentTool(
  subagent: Subagent,
  base: SubagentRuntimeBase,
): AgentTool<any> {
  return {
    name: subagent.name,
    label: subagent.label,
    description: subagent.description,
    parameters: subagent.inputSchema,
    execute: async (_toolCallId, params, signal) => {
      const result = await subagent.run(params, { ...base, signal });
      return {
        content: [{ type: "text", text: result.summary }],
        details: result.details,
      };
    },
  };
}

/** Load all subagents and expose them as parent-agent tools. */
export async function buildSubagentTools(
  base: SubagentRuntimeBase,
): Promise<AgentTool<any>[]> {
  const subagents = await loadSubagents();
  return subagents.map((s) => subagentTool(s, base));
}
