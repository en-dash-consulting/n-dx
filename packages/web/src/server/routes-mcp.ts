/**
 * MCP over HTTP routes — mounts rex and sourcevision MCP servers on the web server.
 *
 * POST/GET/DELETE /mcp/rex          — Rex MCP endpoint (Streamable HTTP transport)
 * POST/GET/DELETE /mcp/sourcevision — Sourcevision MCP endpoint (Streamable HTTP transport)
 *
 * Each endpoint manages its own transport + MCP server lifecycle.
 * Sessions are stateful (session ID generated per initialize request).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createRexMcpServer } from "rex";
import { createSourcevisionMcpServer } from "sourcevision";
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
}

/** Session maps keyed by session ID. */
const rexSessions = new Map<string, McpSession>();
const svSessions = new Map<string, McpSession>();

type McpServerFactory = (ctx: ServerContext) => McpServer | Promise<McpServer>;

/** Factory that creates a Rex MCP server instance. */
const createRexServer: McpServerFactory = async (ctx) =>
  createRexMcpServer(ctx.projectDir);

/** Factory that creates a Sourcevision MCP server instance. */
const createSvServer: McpServerFactory = (ctx) =>
  createSourcevisionMcpServer(ctx.projectDir);

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
  const server = await factory(ctx);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) sessions.delete(sid);
  };
  await server.connect(transport);
  return { transport, server };
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

  if (path === MCP_REX_PATH) {
    return handleMcpRequest(req, res, ctx, rexSessions, createRexServer);
  }

  if (path === MCP_SV_PATH) {
    return handleMcpRequest(req, res, ctx, svSessions, createSvServer);
  }

  return false;
}

/**
 * Close all active MCP sessions. Used for graceful shutdown.
 */
export async function closeAllMcpSessions(): Promise<void> {
  const closers: Promise<void>[] = [];
  for (const session of rexSessions.values()) {
    closers.push(session.transport.close());
  }
  for (const session of svSessions.values()) {
    closers.push(session.transport.close());
  }
  await Promise.allSettled(closers);
  rexSessions.clear();
  svSessions.clear();
}
