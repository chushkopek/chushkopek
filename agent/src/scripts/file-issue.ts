/**
 * Run the `create_github_issue` subagent directly against a real repo with a
 * real model — without going through a full incident/escalation. This is the
 * fastest way to end-to-end test the GitHub integration.
 *
 *   npm run file-issue -- --owner my-org --repo my-repo \
 *     --context "api-gateway 5xx spike after deploy abc123; pods crashlooping"
 *
 *   npm run file-issue -- --owner my-org --repo my-repo \
 *     --context-file ./incident.txt --severity sev2 --labels incident,bug
 *
 * With no --context/--context-file, a clearly-marked sample incident is used.
 */
import { readFile } from "node:fs/promises";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { loadConfig, getApiKey } from "../config.js";
import type { SubagentContext } from "../subagents/index.js";
import { subagent } from "../subagents/github-issue/index.js";

interface Args {
  owner?: string;
  repo?: string;
  context?: string;
  contextFile?: string;
  severity?: string;
  labels?: string[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--owner") args.owner = next();
    else if (a === "--repo") args.repo = next();
    else if (a === "--context") args.context = next();
    else if (a === "--context-file") args.contextFile = next();
    else if (a === "--severity") args.severity = next();
    else if (a === "--labels")
      args.labels = (next() ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
  }
  return args;
}

const SAMPLE_CONTEXT =
  "[doctor test incident] api-gateway is returning elevated 5xx (~40%) in prod " +
  "shortly after deploy abc123. Pods are crashlooping with OOMKilled. Suspected " +
  "memory-limit regression in the new build. Mitigation attempted: none (L1).";

/** Minimal console renderer for the subagent's internal event stream. */
function makeRenderer(): (event: AgentEvent) => void {
  let streaming = false;
  const endStream = () => {
    if (streaming) {
      process.stdout.write("\n");
      streaming = false;
    }
  };
  return (event: AgentEvent) => {
    switch (event.type) {
      case "message_update": {
        const inner = event.assistantMessageEvent;
        if (inner.type === "text_delta") {
          streaming = true;
          process.stdout.write(inner.delta);
        }
        break;
      }
      case "tool_execution_start": {
        endStream();
        const args = JSON.stringify(event.args);
        const preview = args.length > 300 ? `${args.slice(0, 300)}…` : args;
        process.stdout.write(`\n  → [${event.toolName}] ${preview}\n`);
        break;
      }
      case "tool_execution_end": {
        process.stdout.write(
          `  ← [${event.toolName}] ${event.isError ? "ERROR" : "ok"}\n`,
        );
        break;
      }
      default:
        break;
    }
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.owner || !args.repo) {
    process.stderr.write(
      "Usage: npm run file-issue -- --owner <o> --repo <r> " +
        '[--context "..."] [--context-file <path>] [--severity sevN] ' +
        "[--labels a,b]\n",
    );
    process.exitCode = 1;
    return;
  }

  const incidentContext = args.contextFile
    ? (await readFile(args.contextFile, "utf-8")).trim()
    : args.context ?? SAMPLE_CONTEXT;

  const { provider, model, thinkingLevel } = loadConfig();
  process.stdout.write(
    `Model: ${provider}/${model.id} (thinking: ${thinkingLevel})\n`,
  );
  process.stdout.write(`Target: ${args.owner}/${args.repo}\n`);
  if (!args.context && !args.contextFile) {
    process.stdout.write("(using built-in sample incident context)\n");
  }
  process.stdout.write("\n--- subagent working ---\n");

  const ctx: SubagentContext = {
    model,
    thinkingLevel,
    getApiKey,
    onEvent: makeRenderer(),
  };

  const result = await subagent.run(
    {
      owner: args.owner,
      repo: args.repo,
      incident_context: incidentContext,
      severity: args.severity,
      labels: args.labels,
    },
    ctx,
  );

  process.stdout.write("\n\n=== RESULT ===\n");
  process.stdout.write(`${result.summary}\n`);
  if (result.details?.issueUrl) {
    process.stdout.write(`Issue URL: ${result.details.issueUrl}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(
    `\nFatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exitCode = 1;
});
