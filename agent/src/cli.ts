import { readFile } from "node:fs/promises";
import { runOrchestrator } from "./orchestrator/index.js";

const USAGE = `chushkopek — autonomous L1 DevOps on-call agent

Usage:
  chushkopek "<incident description>"
  chushkopek --file <path-to-incident.txt>
  cat incident.txt | chushkopek

The agent triages the incident, attempts safe L1-level remediation, and always
ends by escalating with a structured handoff.`;

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8").trim();
}

async function resolveIncident(argv: string[]): Promise<string> {
  const fileFlagIdx = argv.findIndex((a) => a === "--file" || a === "-f");
  if (fileFlagIdx !== -1) {
    const filePath = argv[fileFlagIdx + 1];
    if (!filePath) throw new Error("--file requires a path argument.");
    return (await readFile(filePath, "utf-8")).trim();
  }

  const positional = argv.filter((a) => !a.startsWith("-")).join(" ").trim();
  if (positional) return positional;

  return readStdin();
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const incident = await resolveIncident(argv);
  if (!incident) {
    process.stderr.write(`No incident provided.\n\n${USAGE}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`Incident:\n${incident}\n`);

  const result = await runOrchestrator(incident);

  process.stdout.write("\n--- escalation outcome ---\n");
  if (!result.report) {
    process.stdout.write("No escalation report was produced.\n");
  } else {
    if (result.escalationFile) {
      process.stdout.write(`Handoff written to ${result.escalationFile}\n`);
    }
    for (const o of result.outcomes) {
      const ref = o.ref ? ` → ${o.ref}` : "";
      const flag = o.simulated ? " (simulated)" : "";
      process.stdout.write(`  ${o.channel}: ${o.status}${flag}${ref}\n`);
    }
  }
}

main().catch((err) => {
  process.stderr.write(`\nFatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
