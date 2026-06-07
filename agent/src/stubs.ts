/**
 * Single switch for the demo/simulation stubs.
 *
 * OFF by default: a normal run uses only REAL sources — the context-fetcher
 * provider (when `CONTEXT_FETCHER_URL` is set), the Exa-backed web subagents,
 * and any channel that is actually configured. The simulated providers
 * (the hardcoded "storefront" trigger/service-context/github/usage and the
 * grafana/kubernetes/load-balancer stubs) and the stub Slack/PagerDuty channels
 * stay dark so nothing fabricates incident data.
 *
 * Set `ENABLE_STUBS=1` to bring the simulated demo scenario back (e.g. to run
 * the end-to-end flow without a live cluster or real Slack/PagerDuty).
 */
export function stubsEnabled(): boolean {
  return Boolean(process.env.ENABLE_STUBS?.trim());
}
