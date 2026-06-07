/**
 * Preflight checks. Run `npm run doctor` to verify the environment is ready to
 * actually run the agent and file GitHub issues. Add `--owner <o> --repo <r>`
 * to additionally verify the GitHub App can reach a real repository.
 *
 *   npm run doctor
 *   npm run doctor -- --owner my-org --repo my-repo
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadConfig, getApiKey } from "../config.js";
import { createSandbox, isPodmanAvailable } from "../sandbox/index.js";
import type { Sandbox } from "../sandbox/index.js";
import {
  loadGitHubAppConfigFromEnv,
  mintInstallationToken,
} from "../github/index.js";

const execFileAsync = promisify(execFile);
const DEFAULT_SANDBOX_IMAGE = "docker.io/maniator/gh:latest";

let failures = 0;
const pass = (msg: string) => console.log(`  PASS  ${msg}`);
const skip = (msg: string) => console.log(`  SKIP  ${msg}`);
const info = (msg: string) => console.log(`  INFO  ${msg}`);
const fail = (msg: string, hint?: string) => {
  failures++;
  console.log(`  FAIL  ${msg}`);
  if (hint) console.log(`        -> ${hint}`);
};

function parseArgs(argv: string[]): { owner?: string; repo?: string } {
  const out: { owner?: string; repo?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--owner") out.owner = argv[++i];
    else if (argv[i] === "--repo") out.repo = argv[++i];
  }
  return out;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function checkModel(): Promise<void> {
  console.log("\n[1/4] Model & provider");
  try {
    const { provider, model, thinkingLevel } = loadConfig();
    pass(`Resolved model: ${provider}/${model.id} (thinking: ${thinkingLevel})`);
    const key = getApiKey(provider);
    if (!key) {
      fail(
        `No API key resolved for provider "${provider}".`,
        "Set the matching key in .env (e.g. OPENROUTER_API_KEY).",
      );
      return;
    }

    pass(`API key present for "${provider}"`);

    if (provider === "openrouter") {
      if (key.includes("/")) {
        fail(
          "OPENROUTER_API_KEY looks like a model slug, not an API key.",
          'Set OPENROUTER_API_KEY to your key from https://openrouter.ai/keys ' +
            '(starts with sk-or-). Put the model slug in MODEL_ID instead.',
        );
        return;
      }
      if (!key.startsWith("sk-or-")) {
        fail(
          'OPENROUTER_API_KEY has an unexpected format (expected sk-or-...).',
          "Copy a fresh key from https://openrouter.ai/keys into agent/.env.",
        );
        return;
      }

      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model.id,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
        }),
      });
      if (res.ok) {
        pass("OpenRouter chat API accepts the key.");
      } else {
        const body = await res.text().catch(() => "");
        fail(
          `OpenRouter chat API rejected the key (HTTP ${res.status}).`,
          body.slice(0, 200) ||
            "Verify OPENROUTER_API_KEY in agent/.env and that the model is available to your account.",
        );
      }
    }
  } catch (e) {
    fail(`Model config error: ${errMsg(e)}`, "See agent/.env.example.");
  }
}

async function checkPodman(): Promise<boolean> {
  console.log("\n[2/4] Execution environment");
  if (await isPodmanAvailable()) {
    try {
      const { stdout } = await execFileAsync("podman", ["--version"]);
      pass(`podman available: ${stdout.trim()}`);
      return true;
    } catch (e) {
      skip(`podman found but not runnable (${errMsg(e)}); will use host shell.`);
      return false;
    }
  }
  skip("podman not on PATH; will use host shell (requires gh + git on the host).");
  return false;
}

async function checkSandbox(_podmanOk: boolean): Promise<void> {
  console.log("\n[3/4] Sandbox (gh + git)");
  const image = process.env.GITHUB_SANDBOX_IMAGE?.trim() || DEFAULT_SANDBOX_IMAGE;
  let sandbox: Sandbox | undefined;
  let mode: "podman" | "raw" | undefined;
  try {
    ({ sandbox, mode } = await createSandbox({
      image,
      env: { GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1" },
    }));
    if (mode === "podman") {
      info(`Using podman image ${image} (the first run pulls it; this can take a moment).`);
    } else {
      info("Using host shell fallback (gh and git must be on PATH).");
    }
    const r = await sandbox.exec("gh --version | head -1; git --version");
    if (r.exitCode === 0 && /gh version/.test(r.stdout)) {
      pass(`Sandbox OK (${mode}): ${r.stdout.trim().replace(/\n/g, " | ")}`);
    } else {
      fail(
        `Sandbox started but gh/git not found (exit ${r.exitCode}).`,
        mode === "podman"
          ? "Pick an image bundling gh+git via GITHUB_SANDBOX_IMAGE."
          : "Install gh and git on the host, or install podman to use the container sandbox.",
      );
    }
  } catch (e) {
    fail(`Sandbox failed to start: ${errMsg(e)}`);
  } finally {
    await sandbox?.close().catch(() => {});
  }
}

async function checkGitHubApp(
  _podmanOk: boolean,
  owner?: string,
  repo?: string,
): Promise<void> {
  console.log("\n[4/4] GitHub App");
  let config;
  try {
    config = await loadGitHubAppConfigFromEnv();
  } catch (e) {
    fail(`GitHub App config error: ${errMsg(e)}`);
    return;
  }
  if (!config) {
    skip(
      "GitHub App not configured (GITHUB_APP_ID unset). Issue/PR filing will be " +
        "disabled. Set it in .env to enable.",
    );
    return;
  }
  pass(
    `App configured (app id ${config.appId}` +
      (config.installationId ? `, installation ${config.installationId}` : "") +
      ")",
  );

  if (!owner || !repo) {
    skip(
      "Live repo access check. Re-run with --owner <o> --repo <r> to mint a " +
        "token and confirm gh can reach the repo.",
    );
    return;
  }

  let sandbox: Sandbox | undefined;
  try {
    const token = await mintInstallationToken(config, {
      owner,
      repo,
      permissions: {
        issues: "write",
        contents: "write",
        pull_requests: "write",
      },
    });
    pass(
      `Minted repo-scoped token for ${owner}/${repo}` +
        (token.expiresAt ? ` (expires ${token.expiresAt})` : ""),
    );

    const image =
      process.env.GITHUB_SANDBOX_IMAGE?.trim() || DEFAULT_SANDBOX_IMAGE;
    ({ sandbox } = await createSandbox({
      image,
      env: {
        GH_TOKEN: token.token,
        GH_REPO: `${owner}/${repo}`,
        HOME: "/tmp",
        GH_CONFIG_DIR: "/tmp/gh",
        GH_PAGER: "cat",
      },
    }));
    const repoDir = `${sandbox.scratchDir}/repo`;
    const r = await sandbox.exec(
      `gh repo view ${owner}/${repo} --json nameWithOwner -q .nameWithOwner`,
    );
    if (r.exitCode === 0 && r.stdout.includes(`${owner}/${repo}`)) {
      pass(`gh authenticated and can access ${r.stdout.trim()}.`);
    } else {
      fail(
        `gh could not access ${owner}/${repo} (exit ${r.exitCode}).`,
        (r.stderr || r.stdout).trim() ||
          "Confirm the App is installed on that repo with Issues, Contents, and Pull requests: write.",
      );
      return;
    }

    // The github subagent operates from a checkout, so verify a clone works
    // with the minted token (contents: read/write).
    const clone = await sandbox.exec(
      `gh auth setup-git && gh repo clone ${owner}/${repo} ${repoDir} -- --depth 1 && git -C ${repoDir} rev-parse --short HEAD`,
    );
    if (clone.exitCode === 0) {
      pass(`Cloned ${owner}/${repo} into the sandbox (HEAD ${clone.stdout.trim().split("\n").pop()}).`);
    } else {
      fail(
        `Could not clone ${owner}/${repo} into the sandbox (exit ${clone.exitCode}).`,
        (clone.stderr || clone.stdout).trim() ||
          "Confirm the App grants Contents: write so the subagent can check out and push a fix branch.",
      );
    }
  } catch (e) {
    fail(`GitHub App live check failed: ${errMsg(e)}`);
  } finally {
    await sandbox?.close().catch(() => {});
  }
}

async function main(): Promise<void> {
  const { owner, repo } = parseArgs(process.argv.slice(2));
  console.log("chushkopek doctor — preflight checks");

  await checkModel();
  const podmanOk = await checkPodman();
  await checkSandbox(podmanOk);
  await checkGitHubApp(podmanOk, owner, repo);

  console.log("");
  if (failures === 0) {
    console.log("All checks passed. You're ready to run the agent.");
    console.log(
      'Try: npm run file-issue -- --owner <o> --repo <r> --context "..."',
    );
  } else {
    console.log(`${failures} check(s) failed. Fix the items above and re-run.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`\nFatal: ${errMsg(err)}`);
  process.exitCode = 1;
});
