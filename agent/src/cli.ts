import { readFile } from "node:fs/promises";
import { attachConsoleRenderer, buildAgent } from "./agent.js";

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

  const { agent, describe, subagents } = await buildAgent();
  attachConsoleRenderer(agent);

  process.stdout.write(`Model: ${describe}\n`);
  process.stdout.write(
    `Subagents: ${subagents.length ? subagents.join(", ") : "(none)"}\n`,
  );
  process.stdout.write(`Incident:\n${incident}\n\n--- working ---\n`);

  await agent.prompt(
    `A production incident has been paged to you. Work it as L1 on-call and ` +
      `escalate when done.\n\nIncident report:\n${incident}`,
  );
  await agent.waitForIdle();
}

main().catch((err) => {
  process.stderr.write(`\nFatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
