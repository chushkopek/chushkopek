import { config as loadEnv } from "dotenv";
import {
  getEnvApiKey,
  getModel,
  type KnownProvider,
  type Model,
} from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

loadEnv({ quiet: true });

/**
 * Providers we know how to bootstrap from a plain API key in the environment.
 * Ordered by preference when the operator has not pinned one explicitly.
 */
const SUPPORTED_PROVIDERS = ["anthropic", "openai"] as const;
type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

const DEFAULT_MODEL_BY_PROVIDER: Record<SupportedProvider, string> = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4o",
};

const VALID_THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

export interface AgentRuntimeConfig {
  provider: KnownProvider;
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
}

function detectProvider(): SupportedProvider {
  const pinned = process.env.MODEL_PROVIDER?.trim();
  if (pinned) {
    return pinned as SupportedProvider;
  }
  const detected = SUPPORTED_PROVIDERS.find((p) => Boolean(getEnvApiKey(p)));
  if (!detected) {
    throw new Error(
      "No provider API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY " +
        "(see .env.example), or pin one with MODEL_PROVIDER + MODEL_ID.",
    );
  }
  return detected;
}

function resolveThinkingLevel(): ThinkingLevel {
  const raw = process.env.THINKING_LEVEL?.trim().toLowerCase();
  if (!raw) return "medium";
  if (!VALID_THINKING_LEVELS.includes(raw as ThinkingLevel)) {
    throw new Error(
      `Invalid THINKING_LEVEL "${raw}". Expected one of: ${VALID_THINKING_LEVELS.join(", ")}.`,
    );
  }
  return raw as ThinkingLevel;
}

/** Resolve the model + reasoning settings the agent should run with. */
export function loadConfig(): AgentRuntimeConfig {
  const provider = detectProvider();
  const modelId =
    process.env.MODEL_ID?.trim() ||
    DEFAULT_MODEL_BY_PROVIDER[provider as SupportedProvider] ||
    undefined;

  if (!modelId) {
    throw new Error(
      `No default model is configured for provider "${provider}". Set MODEL_ID explicitly.`,
    );
  }

  const model = getModel(provider as KnownProvider, modelId as never);

  return { provider, model, thinkingLevel: resolveThinkingLevel() };
}

/**
 * Dynamic API key resolver handed to the agent. Re-reading per request keeps
 * us compatible with short-lived/rotated credentials down the line.
 */
export function getApiKey(provider: string): string | undefined {
  return getEnvApiKey(provider);
}
