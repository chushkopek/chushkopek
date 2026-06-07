import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Dispatcher } from "./types.js";

/** Resolve a dispatcher's optional `enabled` flag (default: enabled). */
function isEnabled(enabled: Dispatcher["enabled"]): boolean {
  if (enabled === undefined) return true;
  return typeof enabled === "function" ? enabled() : enabled;
}

function isDispatcher(value: unknown): value is Dispatcher {
  if (!value || typeof value !== "object") return false;
  const d = value as Partial<Dispatcher>;
  return (
    typeof d.name === "string" &&
    typeof d.label === "string" &&
    typeof d.dispatch === "function"
  );
}

/**
 * Discover every dispatcher under `src/escalation/channels/<name>/`.
 *
 * Each subdirectory exports a `dispatcher` (or default export) satisfying the
 * {@link Dispatcher} contract. Filesystem-based discovery means teammates add a
 * channel by dropping in a folder — no shared registry file to edit. Folders
 * starting with `_` or `.` are ignored.
 */
export async function loadDispatchers(): Promise<Dispatcher[]> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const channelsDir = path.join(here, "channels");

  const entries = await readdir(channelsDir, { withFileTypes: true }).catch(
    () => [], // no channels/ dir yet — nothing to dispatch to
  );

  const dirs = entries.filter(
    (e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith("."),
  );

  const dispatchers: Dispatcher[] = [];
  for (const dir of dirs) {
    const specifier = new URL(`./channels/${dir.name}/index.js`, import.meta.url).href;
    try {
      const mod: Record<string, unknown> = await import(specifier);
      const candidate = mod.dispatcher ?? mod.default;
      if (isDispatcher(candidate)) {
        dispatchers.push(candidate);
      } else {
        console.warn(
          `[escalation] "${dir.name}" has no valid 'dispatcher' export; skipping.`,
        );
      }
    } catch (err) {
      console.warn(
        `[escalation] failed to load "${dir.name}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const seen = new Set<string>();
  for (const d of dispatchers) {
    if (seen.has(d.name)) {
      throw new Error(
        `Duplicate dispatcher name "${d.name}". Dispatcher names must be unique.`,
      );
    }
    seen.add(d.name);
  }

  // Honor the optional `enabled` flag so a channel can be feature-flagged off
  // (e.g. the stub Slack/PagerDuty channels outside demo mode).
  const active = dispatchers.filter((d) => isEnabled(d.enabled));

  active.sort((a, b) => a.name.localeCompare(b.name));
  return active;
}
