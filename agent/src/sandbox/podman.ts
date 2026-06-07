/**
 * Podman sandbox.
 *
 * A TypeScript port of the Rust `Sandbox` prototype: it starts a long-lived,
 * hardened container (`-d --rm`, all caps dropped, no-new-privileges, capped
 * memory/pids, read-only rootfs with a tmpfs scratch) and runs commands inside
 * it via `podman exec`. `close()` removes the container; a leak warning fires if
 * it is dropped without closing.
 *
 * Deliberate deviations from the Rust prototype:
 *   - **Networking is ON.** The prototype used `--network none`; the `gh` CLI
 *     must reach the GitHub API, so we leave the default network in place.
 *   - **Env injection + writable HOME.** We pass env vars at creation (e.g.
 *     `GH_TOKEN`) and point `HOME`/`GH_CONFIG_DIR` at the tmpfs so `gh`/`git`
 *     work against the read-only rootfs.
 *   - Commands run via `sh -c` (the default image is Alpine/busybox, no bash).
 */
import { execFile } from "node:child_process";

export interface SandboxOptions {
  /** Container image to run. Auto-pulled by podman on first use. */
  image: string;
  /** Environment variables available to every `exec` in the container. */
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

export interface ExecResult {
  stdout: string;
  stderr: string;
  /** Exit code, or `undefined` if the process was killed by a signal. */
  exitCode: number | undefined;
}

export interface ExecOptions {
  /** Abort the command (kills the `podman exec` process). */
  signal?: AbortSignal;
  /** Cap on combined stdout+stderr captured per command (bytes). */
  maxBuffer?: number;
  /**
   * Working directory inside the container (`podman exec -w`). Each `exec` is an
   * independent `sh -c`, so `cd` does not persist between calls — set this to
   * run from a fixed directory (e.g. a cloned repo root).
   */
  workdir?: string;
}

interface RawRun {
  stdout: string;
  stderr: string;
  code: number | null;
}

/** Run `podman` with args, capturing output without throwing on non-zero exit. */
function runPodman(
  args: string[],
  opts: { signal?: AbortSignal; maxBuffer?: number } = {},
): Promise<RawRun> {
  return new Promise((resolve, reject) => {
    execFile(
      "podman",
      args,
      {
        signal: opts.signal,
        maxBuffer: opts.maxBuffer ?? 8 * 1024 * 1024,
        encoding: "utf-8",
      },
      (error, stdout, stderr) => {
        if (error && typeof (error as { code?: unknown }).code !== "number") {
          // Spawn failure (podman missing) or abort — surface as a real error.
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

export class PodmanSandbox {
  private containerId: string | undefined;

  private constructor(containerId: string) {
    this.containerId = containerId;
  }

  /** Start a hardened container and return a handle to it. */
  static async start(options: SandboxOptions): Promise<PodmanSandbox> {
    const keepAlive = options.keepAlive ?? {
      entrypoint: "sleep",
      args: ["infinity"],
    };

    const args = [
      "run",
      "-d",
      "--rm",
      "--cap-drop=all",
      "--security-opt",
      "no-new-privileges",
      "--memory",
      options.memory ?? "512m",
      "--pids-limit",
      String(options.pidsLimit ?? 100),
      "--read-only",
      "--tmpfs",
      `/tmp:rw,exec,size=${options.tmpfsSize ?? "64m"}`,
      // The keep-alive process (busybox `sleep`) ignores SIGTERM, so make
      // removal kill it immediately instead of waiting out the stop timeout.
      "--stop-signal",
      "SIGKILL",
      "--entrypoint",
      keepAlive.entrypoint,
    ];

    for (const [key, value] of Object.entries(options.env ?? {})) {
      args.push("--env", `${key}=${value}`);
    }

    args.push(options.image, ...keepAlive.args);

    const result = await runPodman(args).catch((err: Error) => {
      throw new Error(
        `Failed to start podman sandbox. Is podman installed and on PATH? ` +
          `Underlying error: ${err.message}`,
      );
    });
    if (result.code !== 0) {
      throw new Error(
        `podman run failed (exit ${result.code}): ${result.stderr.trim()}`,
      );
    }

    const containerId = result.stdout.trim();
    if (!containerId) {
      throw new Error("podman run produced no container id.");
    }
    return new PodmanSandbox(containerId);
  }

  /** Run a shell command inside the sandbox. Never throws on non-zero exit. */
  async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    if (!this.containerId) {
      throw new Error("Sandbox is closed.");
    }
    const execArgs = ["exec"];
    if (options.workdir) execArgs.push("-w", options.workdir);
    execArgs.push(this.containerId, "sh", "-c", command);
    const result = await runPodman(execArgs, {
      signal: options.signal,
      maxBuffer: options.maxBuffer,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code ?? undefined,
    };
  }

  /** Remove the container. Safe to call once; subsequent calls are no-ops. */
  async close(): Promise<void> {
    const containerId = this.containerId;
    if (!containerId) return;
    this.containerId = undefined;
    const result = await runPodman(["rm", "-f", containerId]);
    if (result.code !== 0) {
      throw new Error(
        `podman rm failed (exit ${result.code}): ${result.stderr.trim()}`,
      );
    }
  }
}
