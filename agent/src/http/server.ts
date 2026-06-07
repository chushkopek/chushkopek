import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { config as loadEnv } from "dotenv";
import { runOrchestrator } from "../orchestrator/index.js";
import type { OrchestratorResult } from "../orchestrator/types.js";

loadEnv({ quiet: true });

/**
 * HTTP entry point for the L1 agent.
 *
 * An alert source (Alertmanager, a k8s controller, a status webhook, …) POSTs an
 * incident; the server acks immediately (202) and runs the orchestration
 * workflow — gather → analyze → dispatch — in the background. Results are
 * dispatched to Slack/PagerDuty/PR (the real output) and also kept in an
 * in-memory store so the caller can poll for status.
 *
 *   POST /incidents   { service, alert, description? }  -> 202 { id, poll }
 *   GET  /incidents/:id                                  -> 200 status/result
 *   GET  /healthz                                        -> 200 { status: "ok" }
 */

/** The alert payload. Extend this as more signal is added to the trigger. */
export interface IncidentRequest {
  /** Service name, e.g. "storefront". */
  service: string;
  /** Alert name/type, e.g. "KubePodCrashLooping" or "readiness-probe-failure". */
  alert: string;
  /** Free-text description of what fired. */
  description?: string;
  /** Anything extra the alert source wants to forward (passed into the trigger). */
  [key: string]: unknown;
}

type IncidentStatus = "running" | "done" | "error";

interface IncidentRecord {
  id: string;
  status: IncidentStatus;
  startedAt: string;
  request: IncidentRequest;
  result?: {
    report?: OrchestratorResult["report"];
    escalationFile?: OrchestratorResult["escalationFile"];
    outcomes: OrchestratorResult["outcomes"];
  };
  error?: string;
}

const store = new Map<string, IncidentRecord>();

const KNOWN_KEYS = new Set(["service", "alert", "description"]);

/** Compose the structured alert into the trigger string runOrchestrator expects. */
function buildTrigger(req: IncidentRequest): string {
  const lines = [
    `Service: ${req.service}`,
    `Alert: ${req.alert}`,
    req.description ? `Description: ${req.description}` : undefined,
  ];
  // Forward any extra fields the caller added (future signal) verbatim.
  for (const [k, v] of Object.entries(req)) {
    if (KNOWN_KEYS.has(k)) continue;
    lines.push(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  }
  return lines.filter((l): l is string => Boolean(l)).join("\n");
}

function newId(): string {
  return `inc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Kick off the orchestration workflow for an incident, tracked in the store. */
function startIncident(request: IncidentRequest): IncidentRecord {
  const id = newId();
  const record: IncidentRecord = {
    id,
    status: "running",
    startedAt: new Date().toISOString(),
    request,
  };
  store.set(id, record);

  const trigger = buildTrigger(request);
  runOrchestrator(trigger, {
    renderAnalysis: false,
    log: (m) => process.stdout.write(`[${id}] ${m}\n`),
  })
    .then((result) => {
      record.status = "done";
      record.result = {
        report: result.report,
        escalationFile: result.escalationFile,
        outcomes: result.outcomes,
      };
      process.stdout.write(`[${id}] done — ${result.outcomes.length} dispatch outcome(s)\n`);
    })
    .catch((err) => {
      record.status = "error";
      record.error = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[${id}] error — ${record.error}\n`);
    });

  return record;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

async function handlePostIncident(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let parsed: unknown;
  try {
    const raw = await readBody(req);
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    return sendJson(res, 400, { error: "Invalid JSON body." });
  }

  const body = parsed as Partial<IncidentRequest>;
  if (typeof body.service !== "string" || !body.service.trim()) {
    return sendJson(res, 400, { error: "Field 'service' (string) is required." });
  }
  if (typeof body.alert !== "string" || !body.alert.trim()) {
    return sendJson(res, 400, { error: "Field 'alert' (string) is required." });
  }

  const record = startIncident(body as IncidentRequest);
  sendJson(res, 202, {
    id: record.id,
    status: record.status,
    poll: `/incidents/${record.id}`,
  });
}

function handleGetIncident(id: string, res: ServerResponse): void {
  const record = store.get(id);
  if (!record) return sendJson(res, 404, { error: `Unknown incident "${id}".` });
  sendJson(res, 200, record);
}

const server = createServer((req, res) => {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;

  if (method === "GET" && path === "/healthz") {
    return sendJson(res, 200, { status: "ok" });
  }
  if (method === "POST" && path === "/incidents") {
    void handlePostIncident(req, res);
    return;
  }
  const match = path.match(/^\/incidents\/([^/]+)$/);
  if (method === "GET" && match) {
    return handleGetIncident(decodeURIComponent(match[1]!), res);
  }

  sendJson(res, 404, { error: `No route for ${method} ${path}.` });
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  process.stdout.write(
    `L1 agent HTTP server listening on :${port}\n` +
      `  POST /incidents  { service, alert, description }\n` +
      `  GET  /incidents/:id\n` +
      `  GET  /healthz\n`,
  );
});
