/**
 * GitHub App authentication.
 *
 * Mints a short-lived **installation access token** for a target repository so
 * the `gh` CLI (running inside the sandbox) can act as the GitHub App. The flow,
 * straight from GitHub's docs:
 *
 *   1. Sign a 10-minute App JWT (RS256) with the App's private key.
 *   2. Resolve the installation for the target repo.
 *   3. Exchange the JWT for an installation token scoped to that one repo and a
 *      minimal permission set.
 *
 * This is the TypeScript replacement for the legacy Python prototype. Two
 * deliberate upgrades over that prototype:
 *   - JWTs are signed with Node's built-in `crypto` (no `jwt`/`PyJWT` dep).
 *   - We resolve the installation via `GET /repos/{owner}/{repo}/installation`
 *     instead of `GET /orgs/{org}/installation`, so it works for repos owned by
 *     a user *or* an org, and we scope the token to the single repo with only
 *     the permissions we need (least privilege).
 */
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";

const DEFAULT_API_BASE_URL = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const USER_AGENT = "chushkopek-agent";

/** Static configuration needed to authenticate as a GitHub App. */
export interface GitHubAppConfig {
  /** The App's ID or client ID — used as the JWT issuer (`iss`). */
  appId: string;
  /** PEM-encoded RSA private key for the App. */
  privateKeyPem: string;
  /**
   * Optional pre-resolved installation ID. When omitted we look it up from the
   * target repository, which needs only the App JWT.
   */
  installationId?: number;
  /** Override for GitHub Enterprise Server. Defaults to api.github.com. */
  apiBaseUrl?: string;
}

/** Result of minting an installation access token. */
export interface InstallationToken {
  /** The short-lived token. Inject this as `GH_TOKEN` for the `gh` CLI. */
  token: string;
  /** ISO-8601 expiry (GitHub installation tokens last ~1 hour). */
  expiresAt: string;
  /** Installation the token belongs to. */
  installationId: number;
  /** "all" or "selected" — should be "selected" given we scope to one repo. */
  repositorySelection?: string;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/**
 * Sign a GitHub App JWT (RS256), valid for 10 minutes.
 *
 * `iat` is backdated 60s to tolerate clock drift between us and GitHub, as the
 * GitHub docs recommend.
 */
export function generateAppJwt(
  appId: string,
  privateKeyPem: string,
  nowMs: number = Date.now(),
): string {
  const nowSec = Math.floor(nowMs / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iat: nowSec - 60,
    exp: nowSec + 9 * 60,
    iss: appId,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(
    JSON.stringify(payload),
  )}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(signingInput)
    .sign(privateKeyPem);

  return `${signingInput}.${base64url(signature)}`;
}

function githubHeaders(bearer: string): Record<string, string> {
  return {
    Authorization: `Bearer ${bearer}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    "User-Agent": USER_AGENT,
  };
}

async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text ? `: ${text}` : "";
  } catch {
    return "";
  }
}

/** Resolve the installation ID for a repo using an App JWT. */
export async function getRepoInstallationId(
  jwt: string,
  owner: string,
  repo: string,
  apiBaseUrl: string = DEFAULT_API_BASE_URL,
): Promise<number> {
  const res = await fetch(`${apiBaseUrl}/repos/${owner}/${repo}/installation`, {
    headers: githubHeaders(jwt),
  });
  if (!res.ok) {
    throw new Error(
      `Failed to resolve GitHub App installation for ${owner}/${repo} ` +
        `(HTTP ${res.status})${await readErrorBody(res)}. ` +
        `Is the App installed on that repository?`,
    );
  }
  const body = (await res.json()) as { id?: number };
  if (typeof body.id !== "number") {
    throw new Error(
      `GitHub installation lookup for ${owner}/${repo} returned no id.`,
    );
  }
  return body.id;
}

/**
 * Mint a repo-scoped installation access token for `owner/repo`.
 *
 * The token is restricted to the single target repository and the given
 * permissions (defaults to `issues: write`, which is all the issue-filing
 * subagent needs).
 */
export async function mintInstallationToken(
  config: GitHubAppConfig,
  target: {
    owner: string;
    repo: string;
    permissions?: Record<string, string>;
  },
): Promise<InstallationToken> {
  const apiBaseUrl = config.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const jwt = generateAppJwt(config.appId, config.privateKeyPem);

  const installationId =
    config.installationId ??
    (await getRepoInstallationId(jwt, target.owner, target.repo, apiBaseUrl));

  const res = await fetch(
    `${apiBaseUrl}/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: { ...githubHeaders(jwt), "Content-Type": "application/json" },
      body: JSON.stringify({
        repositories: [target.repo],
        permissions: target.permissions ?? { issues: "write" },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `Failed to mint installation token for installation ${installationId} ` +
        `(HTTP ${res.status})${await readErrorBody(res)}.`,
    );
  }

  const body = (await res.json()) as {
    token?: string;
    expires_at?: string;
    repository_selection?: string;
  };
  if (!body.token) {
    throw new Error("GitHub access-token response did not include a token.");
  }

  return {
    token: body.token,
    expiresAt: body.expires_at ?? "",
    installationId,
    repositorySelection: body.repository_selection,
  };
}

/**
 * Load App config from the environment.
 *
 * - `GITHUB_APP_ID` — the App's ID or client ID (required).
 * - `GITHUB_APP_PRIVATE_KEY` — the PEM contents inline (newlines may be escaped
 *   as `\n`), OR
 * - `GITHUB_APP_PRIVATE_KEY_PATH` — a path to the `.pem` file.
 * - `GITHUB_APP_INSTALLATION_ID` — optional pre-resolved installation id.
 * - `GITHUB_API_BASE_URL` — optional, for GitHub Enterprise Server.
 *
 * Returns `undefined` when the App is not configured, so callers can degrade
 * gracefully instead of crashing.
 */
export async function loadGitHubAppConfigFromEnv(): Promise<
  GitHubAppConfig | undefined
> {
  const appId = process.env.GITHUB_APP_ID?.trim();
  if (!appId) return undefined;

  let privateKeyPem: string | undefined;
  const inlineKey = process.env.GITHUB_APP_PRIVATE_KEY?.trim();
  const keyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH?.trim();
  if (inlineKey) {
    // Allow keys stored with literal "\n" (common in CI secret stores).
    privateKeyPem = inlineKey.includes("-----BEGIN")
      ? inlineKey.replace(/\\n/g, "\n")
      : inlineKey;
  } else if (keyPath) {
    privateKeyPem = await readFile(keyPath, "utf-8");
  }

  if (!privateKeyPem) {
    throw new Error(
      "GITHUB_APP_ID is set but no private key was provided. Set " +
        "GITHUB_APP_PRIVATE_KEY (PEM contents) or GITHUB_APP_PRIVATE_KEY_PATH.",
    );
  }

  const installationIdRaw = process.env.GITHUB_APP_INSTALLATION_ID?.trim();
  const installationId = installationIdRaw
    ? Number.parseInt(installationIdRaw, 10)
    : undefined;
  if (installationIdRaw && Number.isNaN(installationId)) {
    throw new Error(
      `GITHUB_APP_INSTALLATION_ID must be an integer, got "${installationIdRaw}".`,
    );
  }

  return {
    appId,
    privateKeyPem,
    installationId,
    apiBaseUrl: process.env.GITHUB_API_BASE_URL?.trim() || undefined,
  };
}
