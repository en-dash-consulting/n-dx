/**
 * MCP over HTTP routes — mounts rex and sourcevision MCP servers on the web server.
 *
 * POST/GET/DELETE /mcp/rex          — Rex MCP endpoint (Streamable HTTP transport)
 * POST/GET/DELETE /mcp/sourcevision — Sourcevision MCP endpoint (Streamable HTTP transport)
 *
 * Each endpoint manages its own transport + MCP server lifecycle.
 * Sessions are stateful (session ID generated per initialize request).
 *
 * Unlike the REST API routes (which read JSON files from disk and shell
 * out to CLIs), MCP routes require the actual MCP server factory functions
 * at runtime.  The factories are injected via {@link initMcpRoutes} so that
 * this module has no compile-time dependency on specific gateway modules.
 *
 * @see ./rex-gateway.ts — Rex runtime gateway (wired in start.ts)
 * @see ./domain-gateway.ts — Sourcevision runtime gateway (wired in start.ts)
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerContext } from "./types.js";

const MCP_REX_PATH = "/mcp/rex";
const MCP_SV_PATH = "/mcp/sourcevision";

/**
 * A per-session MCP transport + server pair.
 * Sessions are identified by the Mcp-Session-Id header.
 */
interface McpSession {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  /** Timestamp of last activity (Date.now()), used for TTL-based cleanup. */
  lastActivityAt: number;
  /**
   * Optional cleanup invoked when the session is destroyed.
   * Used by subprocess-backed proxy servers to terminate the child process.
   */
  cleanup?: () => Promise<void>;
}

/**
 * Extended factory result that includes an optional lifecycle cleanup.
 * Factories that spawn subprocesses return this form so the session
 * manager can terminate child processes when sessions expire or close.
 */
export interface McpServerWithLifecycle {
  server: McpServer;
  /** Called once when the session using this server is destroyed. */
  cleanup?: () => Promise<void>;
}

/** Session maps keyed by session ID. */
const rexSessions = new Map<string, McpSession>();
const svSessions = new Map<string, McpSession>();

// ── Session TTL cleanup ──────────────────────────────────────────────────────

/** Maximum session idle time before automatic cleanup (15 minutes). */
const SESSION_TTL_MS = 15 * 60 * 1000;

/** How often to sweep for stale sessions (5 minutes). */
const SESSION_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Close a session's transport.
 *
 * The `cleanup` callback (if any) is invoked via `transport.onclose` —
 * not called here — so that cleanup fires exactly once regardless of which
 * code path (TTL sweep, graceful shutdown, client DELETE) closes the transport.
 */
function closeSession(session: McpSession): void {
  session.transport.close().catch(() => {});
}

/** Sweep a session map, closing sessions idle longer than SESSION_TTL_MS. */
function sweepStaleSessions(sessions: Map<string, McpSession>): void {
  const now = Date.now();
  for (const [sid, session] of sessions) {
    if (now - session.lastActivityAt > SESSION_TTL_MS) {
      closeSession(session);
      sessions.delete(sid);
    }
  }
}

/** Periodic sweep timer (started lazily on first session creation). */
let sweepTimer: ReturnType<typeof setInterval> | null = null;

function ensureSweepTimer(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    sweepStaleSessions(rexSessions);
    sweepStaleSessions(svSessions);
    // Stop the timer if no sessions remain — avoid holding the process open
    if (rexSessions.size === 0 && svSessions.size === 0 && sweepTimer) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
  }, SESSION_SWEEP_INTERVAL_MS);
  // Don't prevent process exit
  if (sweepTimer.unref) sweepTimer.unref();
}

type McpServerFactory = (ctx: ServerContext) => McpServer | McpServerWithLifecycle | Promise<McpServer | McpServerWithLifecycle>;

/**
 * Factory functions for MCP server creation.
 * Set once via {@link initMcpRoutes} before the HTTP server handles requests.
 * @see packages/web/src/server/start.ts — production wiring
 */
export interface McpRouteFactories {
  /** Factory that creates a Rex MCP server instance. */
  rex: McpServerFactory;
  /** Factory that creates a Sourcevision MCP server instance. */
  sv: McpServerFactory;
}

/** Module-level factories — populated by {@link initMcpRoutes}. */
let configuredFactories: McpRouteFactories | null = null;

/**
 * Wire the MCP server factory functions. Must be called once before the first
 * request reaches {@link handleMcpRoute}.
 *
 * This is an injection seam — callers (start.ts) own the factory wiring so
 * routes-mcp.ts has no compile-time dependency on specific gateway modules.
 */
export function initMcpRoutes(factories: McpRouteFactories): void {
  configuredFactories = factories;
}

/**
 * Replace one or both MCP server factories at runtime.
 *
 * Called by the MCP schema watcher ({@link mcp-schema-watcher.ts}) after a
 * package rebuild is detected. Factories are swapped atomically — sessions
 * already in progress continue with their existing McpServer instances;
 * only new sessions (POST without a session header) will use the updated
 * factories and therefore serve the freshly compiled tool schemas.
 */
export function reloadMcpFactories(updates: Partial<McpRouteFactories>): void {
  if (!configuredFactories) return;
  if (updates.rex !== undefined) configuredFactories.rex = updates.rex;
  if (updates.sv !== undefined) configuredFactories.sv = updates.sv;
}

/** Unpack a factory result into { server, cleanup }. */
function unpackFactory(result: McpServer | McpServerWithLifecycle): { server: McpServer; cleanup?: () => Promise<void> } {
  if ("server" in result) return result as McpServerWithLifecycle;
  return { server: result as McpServer };
}

/**
 * Create a new MCP session: transport + server, connected but not yet handling requests.
 * The session is registered in the session map once the transport assigns a session ID
 * (which happens during the first handleRequest call for the initialize request).
 */
async function createSession(
  ctx: ServerContext,
  sessions: Map<string, McpSession>,
  factory: McpServerFactory,
): Promise<McpSession> {
  const { server, cleanup } = unpackFactory(await factory(ctx));
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) {
      const existing = sessions.get(sid);
      if (existing?.cleanup) existing.cleanup().catch(() => {});
      sessions.delete(sid);
    }
  };
  await server.connect(transport);
  ensureSweepTimer();
  return { transport, server, lastActivityAt: Date.now(), cleanup };
}

/**
 * Look up an existing session by the Mcp-Session-Id header, or return null
 * if no session header is present (indicating an initialization request).
 */
function findSession(
  req: IncomingMessage,
  sessions: Map<string, McpSession>,
): McpSession | null {
  const sessionId = req.headers["mcp-session-id"];
  if (!sessionId || typeof sessionId !== "string") return null;
  return sessions.get(sessionId) ?? null;
}

/**
 * Handle an MCP HTTP request for a given endpoint.
 *
 * - POST without session header → create new session, delegate to transport, register session
 * - POST/GET/DELETE with session header → delegate to existing transport
 * - Unknown session → 404
 */
async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  sessions: Map<string, McpSession>,
  factory: McpServerFactory,
): Promise<boolean> {
  const method = req.method || "GET";

  // POST requests: either initialization (no session) or existing session
  if (method === "POST") {
    const existing = findSession(req, sessions);
    if (existing) {
      existing.lastActivityAt = Date.now();
      await existing.transport.handleRequest(req, res);
      return true;
    }
    // No session header — this should be an initialization request.
    // Create transport + server, handle the request, then register the session.
    const session = await createSession(ctx, sessions, factory);
    await session.transport.handleRequest(req, res);
    // After handleRequest, the transport has generated a session ID
    const sid = session.transport.sessionId;
    if (sid) sessions.set(sid, session);
    return true;
  }

  // GET (SSE streaming) and DELETE (session termination) require an existing session
  if (method === "GET" || method === "DELETE") {
    const existing = findSession(req, sessions);
    if (!existing) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No valid session. Send an initialization request first." }));
      return true;
    }
    existing.lastActivityAt = Date.now();
    await existing.transport.handleRequest(req, res);
    return true;
  }

  // Unsupported method
  res.writeHead(405, { "Content-Type": "application/json", Allow: "GET, POST, DELETE" });
  res.end(JSON.stringify({ error: "Method not allowed" }));
  return true;
}

/**
 * Route handler for MCP endpoints.
 *
 * Handles `/mcp/rex` and `/mcp/sourcevision` paths.
 * Returns `true` if the request was handled, `false` otherwise.
 */
export async function handleMcpRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  const url = req.url ?? "/";
  // Strip query string for path matching
  const path = url.split("?")[0];

  // Only claim MCP paths; non-MCP paths fall through to other handlers.
  if (path !== MCP_REX_PATH && path !== MCP_SV_PATH) return false;

  if (!configuredFactories) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "MCP routes not initialised — call initMcpRoutes() at server startup." }));
    return true;
  }

  if (path === MCP_REX_PATH) {
    return handleMcpRequest(req, res, ctx, rexSessions, configuredFactories.rex);
  }

  return handleMcpRequest(req, res, ctx, svSessions, configuredFactories.sv);
}

/**
 * Close all active MCP sessions and stop the sweep timer.
 * Used for graceful shutdown.
 */
export async function closeAllMcpSessions(): Promise<void> {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
  const closers: Promise<void>[] = [];
  // transport.close() fires onclose synchronously, which calls session.cleanup() if set.
  for (const session of [...rexSessions.values(), ...svSessions.values()]) {
    closers.push(session.transport.close());
  }
  await Promise.allSettled(closers);
  rexSessions.clear();
  svSessions.clear();
}
