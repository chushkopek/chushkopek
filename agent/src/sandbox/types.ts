export interface ExecResult {
  stdout: string;
  stderr: string;
  /** Exit code, or `undefined` if the process was killed by a signal. */
  exitCode: number | undefined;
}

export interface ExecOptions {
  /** Abort the command (kills the underlying shell process). */
  signal?: AbortSignal;
  /** Cap on combined stdout+stderr captured per command (bytes). */
  maxBuffer?: number;
  /**
   * Working directory for the command. Each `exec` is an independent `sh -c`, so
   * `cd` does not persist between calls — set this to run from a fixed directory
   * (e.g. a cloned repo root).
   */
  workdir?: string;
}

export interface SandboxOptions {
  /** Container image to run. Auto-pulled by podman on first use. */
  image: string;
  /** Environment variables available to every `exec`. */
  env?: Record<string, string>;
  /** Memory cap, passed to `--memory`. Defaults to "512m". */
  memory?: string;
  /** Process cap, passed to `--pids-limit`. Defaults to 100. */
  pidsLimit?: number;
  /**
   * Size of the writable `/tmp` tmpfs scratch. Defaults to "64m". Bump it when
   * the workload needs disk (e.g. cloning a repo into the sandbox).
   */
  tmpfsSize?: string;
  /**
   * Entrypoint used to keep the container alive. Some images (e.g. maniator/gh)
   * set an entrypoint that exits immediately, so we override it. Defaults to
   * `sleep` with arg `infinity`.
   */
  keepAlive?: { entrypoint: string; args: string[] };
}

/** Writable execution environment for running shell commands. */
export interface Sandbox {
  /** Writable scratch directory (repo clones typically live at `${scratchDir}/repo`). */
  readonly scratchDir: string;
  /** Run a shell command. Never throws on non-zero exit. */
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  /** Release resources. Safe to call once; subsequent calls are no-ops. */
  close(): Promise<void>;
}

export type SandboxMode = "podman" | "raw";

export interface CreateSandboxOptions {
  image: string;
  env?: Record<string, string>;
  memory?: string;
  pidsLimit?: number;
  tmpfsSize?: string;
}

export interface CreateSandboxResult {
  sandbox: Sandbox;
  mode: SandboxMode;
}
