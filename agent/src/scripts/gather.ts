/**
 * Gather-only harness. Runs Phase 1 (context gathering) in isolation and prints
 * each provider's slice — WITHOUT building the agent or needing a model API key.
 * Handy for inspecting the Gather bundle and for testing a single context
 * provider end-to-end (e.g. pointing CONTEXT_FETCHER_URL at the real service).
 *
 *   npm run gather
 *   npm run gather -- "Readiness probe failing for demo/online-store-memory-leak"
 *   CONTEXT_FETCHER_URL=http://localhost:8080 npm run gather -- "demo/online-store-memory-leak crashing"
 *   npm run gather -- --source context-fetcher "demo/api-chushkopek 5xx spike"
 *
 * Pass `--source <name>` to also dump that one slice's full structured payload.
 */
import { gatherSlices } from "../context/registry.js";
import { getApiKey } from "../config.js";

function parseArgs(argv: string[]): { trigger: string; source?: string } {
  let source: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--source" || argv[i] === "-s") {
      source = argv[++i];
    } else {
      rest.push(argv[i]!);
    }
  }
  const trigger =
    rest.join(" ").trim() ||
    "Readiness probe failing for demo/online-store-memory-leak in the demo namespace";
  return { trigger, source };
}

async function main(): Promise<void> {
  const { trigger, source } = parseArgs(process.argv.slice(2));

  console.log(`Trigger: ${trigger}`);
  if (process.env.CONTEXT_FETCHER_URL) {
    console.log(`CONTEXT_FETCHER_URL: ${process.env.CONTEXT_FETCHER_URL}`);
  }
  console.log("\n[gather] running every enabled context provider…");

  // gatherSlices only needs the model for LLM-backed providers; none of the
  // deterministic stubs or the context-fetcher provider read it, so a no-key
  // runtime is enough to exercise them.
  const slices = await gatherSlices(trigger, {
    model: undefined as never,
    thinkingLevel: "off",
    getApiKey,
  });

  for (const s of slices) {
    const flag = s.simulated ? " (simulated)" : "";
    console.log(`  • ${s.source}: ${s.status}${flag} — ${s.summary}`);
  }

  const target = source ?? "context-fetcher";
  const slice = slices.find((s) => s.source === target);
  console.log(`\n--- ${target} slice ---`);
  console.log(
    slice ? JSON.stringify(slice, null, 2) : `(no "${target}" slice — provider disabled or not discovered)`,
  );
}

main().catch((err) => {
  console.error(`\nFatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
