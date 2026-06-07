import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ContextProvider,
  ProviderContext,
  ProviderRuntimeBase,
  ProviderSlice,
} from "./types.js";

function isProvider(value: unknown): value is ContextProvider {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<ContextProvider>;
  return (
    typeof p.name === "string" &&
    typeof p.label === "string" &&
    typeof p.gather === "function"
  );
}

/**
 * Discover every context provider under `src/context/providers/<name>/`.
 *
 * Each subdirectory exports a `provider` (or default export) satisfying the
 * {@link ContextProvider} contract. Discovery is filesystem-based so teammates
 * add a source by dropping in a folder — no shared registry file to edit.
 * Folders starting with `_` or `.` are ignored.
 */
export async function loadProviders(): Promise<ContextProvider[]> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const providersDir = path.join(here, "providers");

  const entries = await readdir(providersDir, { withFileTypes: true }).catch(
    () => [], // no providers/ dir yet — empty pipeline is valid
  );

  const dirs = entries.filter(
    (e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith("."),
  );

  const providers: ContextProvider[] = [];
  for (const dir of dirs) {
    const specifier = new URL(`./providers/${dir.name}/index.js`, import.meta.url).href;
    try {
      const mod: Record<string, unknown> = await import(specifier);
      const candidate = mod.provider ?? mod.default;
      if (isProvider(candidate)) {
        providers.push(candidate);
      } else {
        console.warn(
          `[context] "${dir.name}" has no valid 'provider' export; skipping.`,
        );
      }
    } catch (err) {
      console.warn(
        `[context] failed to load "${dir.name}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const seen = new Set<string>();
  for (const p of providers) {
    if (seen.has(p.name)) {
      throw new Error(
        `Duplicate context provider name "${p.name}". Provider names must be unique.`,
      );
    }
    seen.add(p.name);
  }

  // Sort by render order (lower first), then name for stability.
  providers.sort(
    (a, b) => (a.order ?? 100) - (b.order ?? 100) || a.name.localeCompare(b.name),
  );
  return providers;
}

/**
 * Run every discovered provider in parallel and collect their slices.
 *
 * Providers must not throw, but we defend anyway: a rejection (or a provider
 * that breaks the contract) becomes a synthetic `status: "error"` slice so the
 * bundle is always complete and one bad source never aborts the run.
 */
export async function gatherSlices(
  trigger: string,
  base: ProviderRuntimeBase,
  signal?: AbortSignal,
): Promise<ProviderSlice[]> {
  const providers = await loadProviders();
  const ctx: ProviderContext = { trigger, signal, ...base };

  const settled = await Promise.allSettled(
    providers.map((p) => p.gather(ctx)),
  );

  return settled.map((result, i) => {
    const provider = providers[i]!;
    if (result.status === "fulfilled") return result.value;
    const reason = result.reason;
    return {
      source: provider.name,
      status: "error" as const,
      summary: `${provider.label} provider threw during gather.`,
      error: reason instanceof Error ? reason.message : String(reason),
    } satisfies ProviderSlice;
  });
}
