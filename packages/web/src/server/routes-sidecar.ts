/**
 * Sidecar session routes: create a session, post a turn, read its frames.
 *
 * A turn is a POST that answers `202` as soon as the prompt is in the
 * transcript; the vendor CLI runs on in the background. Every frame the turn
 * appends is announced over the WebSocket as `sidecar:frames` with the
 * session's new cursor, and the client fetches `GET …/frames?after=<cursor>`
 * for the frames themselves — the announce-then-fetch pattern the run tail
 * uses (`hench:run-appended` + `/events?after=`). The socket carries no
 * transcript text, and a reloaded client resumes by fetching after the last
 * cursor it rendered.
 *
 * Routes, all under `/api/sidecar/sessions`, all refused while `web.sidecar`
 * is off (see route-feature-gates.ts):
 *
 * | Method | Path | Does |
 * |--------|------|------|
 * | GET  | `/api/sidecar/sessions` | sessions in this worktree |
 * | POST | `/api/sidecar/sessions` | create one (`{ vendor, model?, name?, lens?, target? }`) |
 * | GET  | `/api/sidecar/sessions/:id` | one session and whether a turn runs |
 * | PATCH | `/api/sidecar/sessions/:id` | rename, re-lens or re-target (`{ name?, lens?, target? }`) |
 * | POST | `/api/sidecar/sessions/:id/turns` | start a turn (`{ prompt }`) |
 * | GET  | `/api/sidecar/sessions/:id/frames?after=N` | transcript frames after N |
 * | POST | `/api/sidecar/sessions/:id/interrupt` | stop the running turn |
 * | POST | `/api/sidecar/sessions/:id/end` | end the session |
 * | GET  | `/api/sidecar/sessions/:id/cards` | the session's permission cards |
 * | POST | `/api/sidecar/sessions/:id/cards/:cardId` | decide a card (`{ decision: "approve" \| "deny", reason?, remember? }`) |
 * | POST | `/api/sidecar/sessions/:id/mcp` | the `ndx-sidecar` broker (MCP, Streamable HTTP), while a turn runs |
 * | GET  | `/api/sidecar/allow-list` | the Sidecar allow-list |
 * | DELETE | `/api/sidecar/allow-list` | revoke a rule (`{ tool, key }`) |
 *
 * Sessions are the addressed workspace's: `ctx.projectDir` picks the registry
 * and broker (`<henchDir>/sidecar/`) and is the worktree a new session runs in.
 *
 * Every side effect a session can cause goes through its broker (see
 * `sidecar/broker.ts`): a raised or settled card is announced as
 * `sidecar:card`, and the client fetches `…/cards`. The session's vendor CLI
 * reaches the broker at this server's own loopback port, with the dashboard
 * token and the workspace in headers (`sidecar/spawn-policy.ts`).
 *
 * @module web/server/routes-sidecar
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { isAuthError, vendorSessionDriver } from "@n-dx/llm-client";
import type { SessionTurnStatus } from "@n-dx/llm-client";
import { SIDECAR_COMMAND, recordDashboardUsage, tokenFields } from "./dashboard-usage.js";
import { estimateCostFromTotals, type CostEstimate } from "./rex-gateway.js";
import type { ServerContext } from "./types.js";
import type { WebSocketBroadcaster } from "./websocket.js";
import { errorMessage, errorResponse, jsonResponse, readBody } from "./response-utils.js";
import { SIDECAR_BROKER_KEY_HEADER, sidecarBrokerCredential } from "./sidecar/broker-credential.js";
import { handleBrokerMcpRequest } from "./sidecar/broker-mcp.js";
import { isBrokerTool } from "./sidecar/broker-policy.js";
import { BrokerDecisionError, SidecarBroker, type SidecarCard, type SidecarCardStatus } from "./sidecar/broker.js";
import { resolveContextCeiling } from "./sidecar/context-refresh.js";
import { readLedger } from "./sidecar/ledger.js";
import { buildLensPacket } from "./sidecar/lens-packets.js";
import type { PacketTarget } from "./sidecar/packet-builders.js";
import { createPacketSources } from "./sidecar/packet-sources.js";
import {
  createWorktreeSidecarRegistry,
  worktreeSidecarDir,
  type SidecarContextOptions,
  type SidecarFrame,
  type SidecarRegistryOptions,
  type SidecarSessionRecord,
  type SidecarSessionRegistry,
} from "./sidecar/session-registry.js";
import type { SidecarBrokerEndpoint } from "./sidecar/spawn-policy.js";
import { WORKSPACE_HEADER } from "./workspaces.js";
import { SIDECAR_SESSION_ENDED_REASON } from "../shared/index.js";

const PREFIX = "/api/sidecar/sessions";
const ALLOW_LIST_PATH = "/api/sidecar/allow-list";

/** Announces that a card was raised or settled; fetch `…/cards` for it. */
export interface SidecarCardMessage {
  type: "sidecar:card";
  sessionId: string;
  cardId: string;
  status: SidecarCardStatus;
  timestamp: string;
}

/** Announces that a session's transcript grew, or that its turn settled. */
export interface SidecarFramesMessage {
  type: "sidecar:frames";
  sessionId: string;
  /** Sequence number of the last frame; fetch `frames?after=` the cursor you hold. */
  cursor: number;
  /** False on the announcement that closes a turn. */
  running: boolean;
  /** How the turn ended; only on the closing announcement. */
  status?: SessionTurnStatus;
  /** Why the turn failed; only on a failed closing announcement. */
  error?: string;
  /** The failure is the vendor CLI's sign-in error, so the drawer can name the login command. */
  signedOut?: true;
  timestamp: string;
}

export interface SidecarSessionResponse {
  session: SidecarSessionRecord;
  running: boolean;
  /** What the session's tokens cost at the session model's rates. */
  estimatedCost: CostEstimate;
}

export interface SidecarTurnStartedResponse extends SidecarSessionResponse {
  /** Fetch `frames?after=` this to read the turn from its prompt on. */
  from: number;
}

export interface SidecarFramesResponse {
  frames: SidecarFrame[];
  /** The cursor to fetch after next: the last frame's seq, else `after`. */
  cursor: number;
  running: boolean;
}

export interface SidecarRouteOptions {
  /** The registry for a project directory. Defaults to one per directory, kept for the server's life. */
  registryFor?: (projectDir: string) => SidecarSessionRegistry;
  /** The broker for a project directory. Defaults to one per directory, kept for the server's life. */
  brokerFor?: (projectDir: string) => SidecarBroker;
}

/**
 * Where a session in `ctx`'s workspace reaches its broker: this server's own
 * loopback port, addressed to the workspace. No port (a test context) means no broker.
 * The session presents its own broker credential, never the dashboard token:
 * the config file that holds it is readable by the session's Read tool.
 */
export function sidecarBrokerEndpoint(ctx: ServerContext, sessionId: string): SidecarBrokerEndpoint | undefined {
  if (!ctx.port) return undefined;
  return {
    url: `http://127.0.0.1:${ctx.port}${PREFIX}/${sessionId}/mcp`,
    headers: {
      [SIDECAR_BROKER_KEY_HEADER]: sidecarBrokerCredential(sessionId),
      ...(ctx.workspace && { [WORKSPACE_HEADER]: ctx.workspace }),
    },
  };
}

/**
 * Checkpoint wiring for `ctx`'s workspace: the project's ceiling for the
 * session's scope (read per turn), its ledger, and its lens's packet rebuilt
 * from disk. The two reads that spawn `ndx` answer nothing here — the Prepare
 * route that owns that spawn is not part of Sidecar — so a Plan packet says
 * those sections are missing rather than leaving a gap unmarked.
 */
export function sidecarContextOptions(ctx: ServerContext): SidecarContextOptions {
  const dir = worktreeSidecarDir(ctx.projectDir);
  return {
    ceiling: (record) => resolveContextCeiling(ctx.projectDir, record.scope),
    ledger: (record) => readLedger(dir, record.id),
    packet: async (record) => {
      const sources = createPacketSources(ctx, { resolve: async () => null, preview: async () => null });
      const built = await buildLensPacket(record.lens ?? "general", record.target ?? {}, sources, new Date().toISOString());
      return built.status === "ready" ? built.packet.text : undefined;
    },
  };
}

/**
 * Appends each finished turn to the dashboard usage ledger as its own
 * `sidecar` command, so the spend reaches LLM Utilization in a bucket apart
 * from Ask. An interrupted turn that never reached the vendor spent nothing
 * and is not recorded.
 */
export function sidecarTurnSpendRecorder(ctx: ServerContext): NonNullable<SidecarRegistryOptions["onTurnSpend"]> {
  return ({ record, status, tokens }) => {
    if (status === "interrupted" && tokens.input === 0 && tokens.output === 0) return;
    recordDashboardUsage(ctx.projectDir, {
      timestamp: new Date().toISOString(),
      command: SIDECAR_COMMAND,
      vendor: record.vendor,
      model: record.model ?? "unknown",
      ...tokenFields(tokens),
      calls: 1,
      outcome: status === "completed" ? "success" : "error",
      ...(record.lens && { lens: record.lens }),
    });
  };
}

const registries = new Map<string, SidecarSessionRegistry>();
const brokers = new Map<string, SidecarBroker>();

function defaultRegistryFor(ctx: ServerContext): SidecarSessionRegistry {
  let registry = registries.get(ctx.projectDir);
  if (!registry) {
    registry = createWorktreeSidecarRegistry(ctx.projectDir, {
      broker: (id) => sidecarBrokerEndpoint(ctx, id),
      context: sidecarContextOptions(ctx),
      onTurnSpend: sidecarTurnSpendRecorder(ctx),
    });
    registries.set(ctx.projectDir, registry);
  }
  return registry;
}

/** Build a broker for `projectDir` that announces its cards through `broadcast`. */
export function createAnnouncingBroker(dir: string, broadcast: WebSocketBroadcaster): SidecarBroker {
  return new SidecarBroker({
    dir,
    onCard: (card: SidecarCard) => {
      const message: SidecarCardMessage = {
        type: "sidecar:card",
        sessionId: card.sessionId,
        cardId: card.id,
        status: card.status,
        timestamp: new Date().toISOString(),
      };
      broadcast(message);
    },
  });
}

/** The workspace's broker. Its broadcaster is the first request's, which is tagged for the same workspace. */
function defaultBrokerFor(projectDir: string, broadcast: WebSocketBroadcaster): SidecarBroker {
  let broker = brokers.get(projectDir);
  if (!broker) {
    broker = createAnnouncingBroker(worktreeSidecarDir(projectDir), broadcast);
    brokers.set(projectDir, broker);
  }
  return broker;
}

/** Answer an error; true, so a handler can `return refuse(…)`. */
function refuse(res: ServerResponse, status: number, message: string): true {
  errorResponse(res, status, message);
  return true;
}

/** The body as a JSON object (empty body: `{}`), else the reason it is not one. */
async function readJsonObject(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Record<string, unknown> | string> {
  let parsed: unknown;
  try {
    const body = await readBody(req, res);
    parsed = body.trim() ? JSON.parse(body) : {};
  } catch (err) {
    return `Invalid request body: ${errorMessage(err)}`;
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : "Request body must be a JSON object";
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined | Error {
  const value = body[key];
  if (value === undefined) return undefined;
  return typeof value === "string" && value.trim() ? value.trim() : new Error(`"${key}" must be a non-empty string`);
}

/** `target` as `{ ref: string }`; absent is undefined. */
function readTarget(body: Record<string, unknown>): PacketTarget | undefined | Error {
  const value = body.target;
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return new Error(`"target" must be an object`);
  const ref = optionalString(value as Record<string, unknown>, "ref");
  return ref instanceof Error ? ref : ref === undefined ? {} : { ref };
}

function sessionResponse(registry: SidecarSessionRegistry, session: SidecarSessionRecord): SidecarSessionResponse {
  const { input, output, cacheCreationInput = 0, cacheReadInput = 0 } = session.tokens;
  const totals = { inputTokens: input, outputTokens: output, cacheCreationTokens: cacheCreationInput, cacheReadTokens: cacheReadInput };
  // A session with no pinned model has none to price by: its tokens reach the
  // estimate as the unattributed residual, at the labelled fallback rate.
  const estimatedCost = estimateCostFromTotals(totals, session.model ? { [session.model]: totals } : undefined);
  return { session, running: registry.isRunning(session.id), estimatedCost };
}

/**
 * Start the turn in the background and announce every frame it appends.
 * The caller has checked that the session exists, is open and is idle.
 */
function startTurn(
  registry: SidecarSessionRegistry,
  broker: SidecarBroker,
  id: string,
  prompt: string,
  broadcast: WebSocketBroadcaster,
): void {
  const announce = (fields: Omit<SidecarFramesMessage, "type" | "sessionId" | "timestamp">): void => {
    const message: SidecarFramesMessage = {
      type: "sidecar:frames",
      sessionId: id,
      ...fields,
      timestamp: new Date().toISOString(),
    };
    broadcast(message);
  };
  // The user frame is appended synchronously inside sendTurn, before it
  // first awaits, so it is on disk by the time the POST answers.
  registry.sendTurn(id, prompt, (frame) => announce({ cursor: frame.seq, running: true })).finally(() => {
    // Nothing waits on a card once its turn is over.
    broker.withdraw(id, "The turn ended");
  }).then(
    (result) => {
      announce({
        cursor: registry.get(id)?.cursor ?? 0,
        running: false,
        status: result.status,
        ...(result.error && { error: result.error }),
        ...(result.status === "failed" && result.error && isAuthError(result.error) && { signedOut: true as const }),
      });
    },
    (err: unknown) => {
      const error = errorMessage(err);
      console.error(`[sidecar] turn in session ${id} failed: ${error}`);
      announce({
        cursor: registry.get(id)?.cursor ?? 0,
        running: false,
        status: "failed",
        error,
        ...(isAuthError(error) && { signedOut: true as const }),
      });
    },
  );
}

/** Parse `after` from the query: a non-negative integer, default 0. */
function parseAfter(search: string): number | Error {
  const raw = new URLSearchParams(search).get("after");
  if (raw === null || raw === "") return 0;
  const after = Number(raw);
  return Number.isInteger(after) && after >= 0 ? after : new Error(`"after" must be a non-negative integer, got "${raw}"`);
}

export async function handleSidecarRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast: WebSocketBroadcaster,
  opts: SidecarRouteOptions = {},
): Promise<boolean> {
  const [pathname, search = ""] = (req.url || "/").split("?");
  if (pathname !== PREFIX && !pathname.startsWith(`${PREFIX}/`) && pathname !== ALLOW_LIST_PATH) return false;
  const method = req.method || "GET";
  const registry = opts.registryFor ? opts.registryFor(ctx.projectDir) : defaultRegistryFor(ctx);
  const broker = opts.brokerFor ? opts.brokerFor(ctx.projectDir) : defaultBrokerFor(ctx.projectDir, broadcast);

  if (pathname === ALLOW_LIST_PATH) {
    if (method === "GET") {
      jsonResponse(res, 200, { rules: broker.allowList() });
      return true;
    }
    if (method === "DELETE") {
      const body = await readJsonObject(req, res);
      if (typeof body === "string") return refuse(res, 400, body);
      const { tool, key } = body;
      if (typeof tool !== "string" || !isBrokerTool(tool) || typeof key !== "string") {
        return refuse(res, 400, `"tool" must be a broker tool and "key" a string`);
      }
      jsonResponse(res, 200, { removed: broker.revoke({ tool, key }) });
      return true;
    }
    return refuse(res, 405, `${method} is not supported on ${ALLOW_LIST_PATH}`);
  }

  if (pathname === PREFIX) {
    if (method === "GET") {
      const sessions = registry.list({ worktree: ctx.projectDir })
        .map((session) => sessionResponse(registry, session));
      jsonResponse(res, 200, { sessions });
      return true;
    }
    if (method === "POST") {
      const body = await readJsonObject(req, res);
      if (typeof body === "string") return refuse(res, 400, body);
      const vendor = optionalString(body, "vendor");
      if (!vendor || vendor instanceof Error || !vendorSessionDriver(vendor)) {
        return refuse(res, 400, `"vendor" must be a vendor with a resumable CLI session (claude, codex)`);
      }
      const fields: Record<string, string | undefined> = {};
      for (const key of ["model", "name", "lens"] as const) {
        const value = optionalString(body, key);
        if (value instanceof Error) return refuse(res, 400, value.message);
        fields[key] = value;
      }
      const target = readTarget(body);
      if (target instanceof Error) return refuse(res, 400, target.message);
      const session = registry.create({
        scope: "worktree", worktree: ctx.projectDir, vendor, ...fields, ...(target && { target }),
      });
      jsonResponse(res, 201, sessionResponse(registry, session));
      return true;
    }
    return refuse(res, 405, `${method} is not supported on ${PREFIX}`);
  }

  const match = /^\/([\w-]+)(?:\/(turns|frames|interrupt|end|cards|mcp)(?:\/([\w-]+))?)?$/
    .exec(pathname.slice(PREFIX.length));
  if (!match) return false;
  const [, id, action, cardId] = match;
  if (cardId !== undefined && action !== "cards") return false;
  const session = registry.get(id);
  // One answer for a session this worktree does not hold, whether it does not
  // exist or belongs to another worktree's checkout.
  if (!session || session.worktree !== ctx.projectDir) return refuse(res, 404, `No Sidecar session ${id}`);

  if (action === undefined && method === "PATCH") {
    const body = await readJsonObject(req, res);
    if (typeof body === "string") return refuse(res, 400, body);
    const fields: { name?: string; lens?: string } = {};
    for (const key of ["name", "lens"] as const) {
      const value = optionalString(body, key);
      if (value instanceof Error) return refuse(res, 400, value.message);
      if (value !== undefined) fields[key] = value;
    }
    const target = readTarget(body);
    if (target instanceof Error) return refuse(res, 400, target.message);
    if ((fields.lens !== undefined || target) && session.endedAt) {
      return refuse(res, 409, `Sidecar session ${id} has ended`);
    }
    const updated = registry.update(id, { ...fields, ...(target && { target }) }) ?? session;
    jsonResponse(res, 200, sessionResponse(registry, updated));
    return true;
  }

  const reads = action === "frames" || action === undefined || (action === "cards" && cardId === undefined);
  const allowed = reads ? "GET" : "POST";
  if (method !== allowed) return refuse(res, 405, `${method} is not supported on ${pathname}`);

  switch (action) {
    case undefined:
      jsonResponse(res, 200, sessionResponse(registry, session));
      return true;

    case "frames": {
      const after = parseAfter(search);
      if (after instanceof Error) return refuse(res, 400, after.message);
      const frames = registry.readFrames(id, after);
      const response: SidecarFramesResponse = {
        frames,
        cursor: frames.at(-1)?.seq ?? after,
        running: registry.isRunning(id),
      };
      jsonResponse(res, 200, response);
      return true;
    }

    case "turns": {
      const body = await readJsonObject(req, res);
      if (typeof body === "string") return refuse(res, 400, body);
      const prompt = body.prompt;
      if (typeof prompt !== "string" || !prompt.trim()) return refuse(res, 400, `"prompt" must be a non-empty string`);
      if (session.endedAt) return refuse(res, 409, `Sidecar session ${id} has ended`);
      if (registry.isRunning(id)) return refuse(res, 409, `A turn is already running in Sidecar session ${id}`);
      startTurn(registry, broker, id, prompt, broadcast);
      const started = registry.get(id) ?? session;
      // The turn's frames start with its prompt, the last frame appended so far.
      const response: SidecarTurnStartedResponse = { ...sessionResponse(registry, started), from: started.cursor - 1 };
      jsonResponse(res, 202, response);
      return true;
    }

    case "interrupt":
      broker.withdraw(id, "The operator stopped the turn");
      jsonResponse(res, 200, { interrupted: await registry.interrupt(id) });
      return true;

    case "end":
      broker.withdraw(id, SIDECAR_SESSION_ENDED_REASON);
      await registry.end(id);
      jsonResponse(res, 200, sessionResponse(registry, registry.get(id) ?? session));
      return true;

    case "cards": {
      if (cardId === undefined) {
        jsonResponse(res, 200, { cards: broker.cards(id) });
        return true;
      }
      const body = await readJsonObject(req, res);
      if (typeof body === "string") return refuse(res, 400, body);
      if (body.decision !== "approve" && body.decision !== "deny") {
        return refuse(res, 400, `"decision" must be "approve" or "deny"`);
      }
      const reason = optionalString(body, "reason");
      if (reason instanceof Error) return refuse(res, 400, reason.message);
      if (body.remember !== undefined && typeof body.remember !== "boolean") {
        return refuse(res, 400, `"remember" must be a boolean`);
      }
      try {
        const card = broker.decide(id, cardId, {
          approve: body.decision === "approve",
          ...(reason && { reason }),
          ...(body.remember && { remember: true }),
        });
        jsonResponse(res, 200, { card });
      } catch (err) {
        if (!(err instanceof BrokerDecisionError)) throw err;
        return refuse(res, err.status, err.message);
      }
      return true;
    }

    case "mcp":
      // Only the session's own turn calls its broker; a card raised with no
      // turn running would wait on an agent that is not there.
      if (session.endedAt || !registry.isRunning(id)) {
        return refuse(res, 409, `Sidecar session ${id} has no running turn`);
      }
      await handleBrokerMcpRequest(req, res, broker, id);
      return true;
  }
  return false;
}
