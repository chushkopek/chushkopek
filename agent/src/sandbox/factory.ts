import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PodmanSandbox } from "./podman.js";
import { RawSandbox } from "./raw.js";
import type { CreateSandboxOptions, CreateSandboxResult } from "./types.js";

const execFileAsync = promisify(execFile);

/** Return true when a `podman` binary is on PATH and responds to `--version`. */
export async function isPodmanAvailable(): Promise<boolean> {
  try {
    await execFileAsync("podman", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Start the best available sandbox: hardened podman container when podman is
 * installed, otherwise a host-shell fallback with the same exec/close API.
 */
export async function createSandbox(
  options: CreateSandboxOptions,
): Promise<CreateSandboxResult> {
  if (await isPodmanAvailable()) {
    const sandbox = await PodmanSandbox.start({
      image: options.image,
      env: options.env,
      memory: options.memory,
      pidsLimit: options.pidsLimit,
      tmpfsSize: options.tmpfsSize,
    });
    return { sandbox, mode: "podman" };
  }

  const sandbox = await RawSandbox.start({ env: options.env });
  return { sandbox, mode: "raw" };
}
