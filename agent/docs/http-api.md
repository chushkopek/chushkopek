# HTTP API

The agent runs as an HTTP service so an alert source (Alertmanager, a k8s
controller, a status webhook, …) can trigger an incident. A `POST` **acks
immediately (202)** and the orchestration workflow — gather → analyze → dispatch
— runs in the background; results are dispatched to Slack/PagerDuty/GitHub and
kept in an in-memory store you can poll.

```
alert source ──POST /incidents──▶ agent ──(async)──▶ gather → analyze → dispatch
                    │                                          │
                202 { id, poll }                       Slack / PagerDuty / GitHub
```

Entry point: [src/http/server.ts](../src/http/server.ts). Run it with `npm run
serve` (dev) or the container (below).

| Method & path        | Purpose                                            | Success |
| -------------------- | -------------------------------------------------- | ------- |
| `POST /incidents`    | Trigger an incident; runs the workflow async       | `202`   |
| `GET  /incidents/:id`| Poll an incident's status / result                 | `200`   |
| `GET  /healthz`      | Liveness + version + whether auth is required       | `200`   |

## `POST /incidents`

Triggers the workflow. Returns immediately; the agent works in the background.

**Headers:** `Content-Type: application/json`. When `AGENT_API_KEY` is set, also
send `X-API-Key: <key>` (see [Auth](#auth)).

**Body:**

| Field | Type | Required | Notes |
| ----- | ---- | -------- | ----- |
| `service` | string | yes | Service name, e.g. `storefront`. Used to scope context gathering. |
| `alert` | string | yes | Alert name/type, e.g. `KubePodCrashLooping`. |
| `description` | string | no | Free-text description of what fired. |
| *(any extra)* | any | no | Forwarded verbatim into the trigger, so the alert payload can grow without changing the contract. |

```bash
curl -X POST http://localhost:8000/incidents \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: <key>' \
  -d '{
        "service": "storefront",
        "alert": "KubePodCrashLooping",
        "description": "pods OOMKilled, readiness probe failing, 0/3 healthy"
      }'
```

**`202 Accepted`:**

```json
{ "id": "inc-1780836506435-tiz4ya", "status": "running", "poll": "/incidents/inc-1780836506435-tiz4ya" }
```

**Errors:** `400` — invalid JSON, or missing `service`/`alert`. `401` — bad/missing `X-API-Key` (when auth is enabled).

## `GET /incidents/:id`

Returns the tracked record for an incident. Poll it until `status` is `done` or `error`.

```bash
curl http://localhost:8000/incidents/inc-1780836506435-tiz4ya
```

**`200 OK`:**

```json
{
  "id": "inc-1780836506435-tiz4ya",
  "status": "done",
  "startedAt": "2026-06-07T12:48:26.435Z",
  "request": { "service": "storefront", "alert": "KubePodCrashLooping", "description": "…" },
  "result": {
    "report": { "severity": "sev1", "incident_class": "attack", "...": "the full EscalationReport" },
    "escalationFile": "/app/escalations/escalation-….md",
    "outcomes": [
      { "channel": "github",    "status": "skipped",   "summary": "…" },
      { "channel": "pagerduty", "status": "delivered", "ref": "https://…", "simulated": true },
      { "channel": "slack",     "status": "delivered", "ref": "https://…", "simulated": true }
    ]
  }
}
```

`status` is `running` | `done` | `error`. While `running`, `result` is absent.
On `error`, an `error` string is present instead of `result`. `404` if the id is unknown.

## `GET /healthz`

Liveness probe.

```bash
curl http://localhost:8000/healthz
# { "status": "ok", "version": "0.1.0", "auth_required": false }
```

## Auth

Set `AGENT_API_KEY` to require a shared secret on `POST /incidents` — clients
send it as the `X-API-Key` header (mirrors the `slack-alerting` convention).
When unset, auth is disabled and `/healthz` reports `"auth_required": false`.
`/healthz` and `GET /incidents/:id` are unauthenticated.

## Configuration

| Var | Default | Notes |
| --- | ------- | ----- |
| `PORT` | `8000` | Port the server listens on. |
| `AGENT_API_KEY` | — | Shared secret for `X-API-Key`. Empty = auth disabled. |

Plus the usual model/provider env (`OPENROUTER_API_KEY` / `MODEL_*`) and any
integration keys (`EXA_API_KEY`, `CONTEXT_FETCHER_URL`, `GITHUB_APP_*`, …) — see
[.env.example](../.env.example). The Analyze phase needs a model key; without one,
incidents finish as `error`.

## Run

```bash
# dev (tsx, reloads on the env in .env)
npm run serve                 # http://localhost:8000

# production (compiled)
npm run build && npm run serve:prod

# container (see ../Dockerfile) — listens on :8000, use /healthz for probes
docker build -t chushkopek-agent ./agent && docker run -p 8000:8000 --env-file agent/.env chushkopek-agent
```

## Notes

- **Async by design.** The `202` is an ack, not the result — the real output is
  the dispatch to Slack/PagerDuty/GitHub. Poll `GET /incidents/:id` for status.
- **In-memory store.** Incident records live in process memory; they don't
  survive a restart. Fine for the demo / a single replica.
- **No request-level timeout yet.** A stalled Analyze keeps an incident
  `running`; a per-incident deadline is a planned follow-up before this is
  webhook-facing at scale.
