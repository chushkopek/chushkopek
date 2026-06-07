/**
 * A `bash`-style tool that executes commands inside a {@link PodmanSandbox}.
 *
 * The hypothesis behind this design: models are heavily trained on driving the
 * `gh` CLI, so rather than hand-rolling REST calls we hand the model a shell in
 * a sandbox where `gh` is installed and already authenticated (via a `GH_TOKEN`
 * injected at container creation). The model does the GitHub work the way it
 * already knows how.
 */
import { Type, type Static } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { PodmanSandbox } from "./podman.js";

const BashParams = Type.Object({
  command: Type.String({
    description:
      "Shell command to run inside the sandbox (POSIX sh). Combine steps with " +
      "&&, pipes, or heredocs as needed.",
  }),
});

export type BashArgs = Static<typeof BashParams>;

export interface BashToolDetails {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | undefined;
  truncated: boolean;
}

export interface CreateBashToolOptions {
  /** Max characters of combined output returned to the model. Default 16000. */
  maxOutputChars?: number;
  /** Override the tool description shown to the model. */
  description?: string;
}

function truncate(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const head = text.slice(0, max);
  return {
    text: `${head}\n…[truncated ${text.length - max} chars]`,
    truncated: true,
  };
}

/** Build a `bash` tool bound to a specific sandbox. */
export function createBashTool(
  sandbox: PodmanSandbox,
  options: CreateBashToolOptions = {},
): AgentTool<typeof BashParams, BashToolDetails> {
  const maxOutputChars = options.maxOutputChars ?? 16000;

  return {
    name: "bash",
    label: "Bash",
    description:
      options.description ??
      "Run a shell command inside an isolated, network-enabled sandbox where " +
        "the `gh` CLI and `git` are installed and already authenticated. Use it " +
        "to perform GitHub operations (e.g. `gh issue create`). Output is " +
        "captured and returned; non-zero exit codes are reported, not thrown.",
    parameters: BashParams,
    execute: async (_toolCallId, params, signal) => {
      const { stdout, stderr, exitCode } = await sandbox.exec(params.command, {
        signal,
      });

      const combined = [
        stdout ? stdout : "",
        stderr ? `\n[stderr]\n${stderr}` : "",
      ]
        .join("")
        .trim();
      const { text, truncated } = truncate(combined, maxOutputChars);

      const header =
        exitCode === 0
          ? "exit 0"
          : `exit ${exitCode ?? "killed"}`;
      const body = text || "(no output)";

      return {
        content: [{ type: "text", text: `[${header}]\n${body}` }],
        details: { command: params.command, stdout, stderr, exitCode, truncated },
      };
    },
  };
}
