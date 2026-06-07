/**
 * Host-shell fallback when podman is unavailable.
 *
 * Runs commands directly via `sh -c` on the host inside a private temp
 * directory used as HOME/GH_CONFIG_DIR. Less isolated than the podman sandbox,
 * but keeps the same exec/close contract so callers need not branch.
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecOptions, ExecResult, Sandbox } from "./types.js";

export interface RawSandboxOptions {
  env?: Record<string, string>;
}

interface RawRun {
  stdout: string;
  stderr: string;
  code: number | null;
}

function runShell(
  command: string,
  opts: {
    env: Record<string, string | undefined>;
    cwd?: string;
    signal?: AbortSignal;
    maxBuffer?: number;
  },
): Promise<RawRun> {
  return new Promise((resolve, reject) => {
    execFile(
      "sh",
      ["-c", command],
      {
        env: opts.env,
        cwd: opts.cwd,
        signal: opts.signal,
        maxBuffer: opts.maxBuffer ?? 8 * 1024 * 1024,
        encoding: "utf-8",
      },
      (error, stdout, stderr) => {
        if (error && typeof (error as { code?: unknown }).code !== "number") {
          reject(error);
          return;
        }
        const code =
          error && typeof (error as { code?: unknown }).code === "number"
            ? ((error as { code: number }).code)
            : 0;
        resolve({ stdout, stderr, code });
      },
    );
  });
}

export class RawSandbox implements Sandbox {
  readonly scratchDir: string;
  private readonly env: Record<string, string | undefined>;
  private closed = false;

  private constructor(scratchDir: string, env: Record<string, string | undefined>) {
    this.scratchDir = scratchDir;
    this.env = env;
  }

  static async start(options: RawSandboxOptions = {}): Promise<RawSandbox> {
    const scratchDir = await mkdtemp(join(tmpdir(), "chushkopek-sandbox-"));
    const ghConfigDir = join(scratchDir, "gh");
    await mkdir(ghConfigDir, { recursive: true });

    const env: Record<string, string | undefined> = {
      ...process.env,
      ...options.env,
      HOME: scratchDir,
      GH_CONFIG_DIR: ghConfigDir,
    };

    return new RawSandbox(scratchDir, env);
  }

  async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    if (this.closed) {
      throw new Error("Sandbox is closed.");
    }
    const result = await runShell(command, {
      env: this.env,
      cwd: options.workdir,
      signal: options.signal,
      maxBuffer: options.maxBuffer,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code ?? undefined,
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await rm(this.scratchDir, { recursive: true, force: true });
  }
}
