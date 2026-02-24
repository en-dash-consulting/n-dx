/**
 * Server entry point — creates the HTTP server and wires up all routes.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, watch } from "node:fs";
import { writeFile, unlink } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import type { ServerContext, ViewerScope } from "./types.js";
import { resolveStaticAssets, handleStaticRoute, isProjectInitialized } from "./routes-static.js";
import { createDataWatcher, handleDataRoute } from "./routes-data.js";
import { handleRexRoute } from "./routes-rex.js";
import { handleSourcevisionRoute } from "./routes-sourcevision.js";
import { handleTokenUsageRoute } from "./routes-token-usage.js";
import { handleValidationRoute } from "./routes-validation.js";
import { handleHenchRoute, startHeartbeatMonitor, shutdownActiveExecutions } from "./routes-hench.js";
import { handleWorkflowRoute } from "./routes-workflow.js";
import { handleAdaptiveRoute } from "./routes-adaptive.js";
import { handleMcpRoute } from "./routes-mcp.js";
import { handleProjectRoute } from "./routes-project.js";
import { handleStatusRoute, clearStatusCache } from "./routes-status.js";
import { handleConfigRoute } from "./routes-config.js";
import { handleNotionRoute } from "./routes-notion.js";
import { handleIntegrationRoute } from "./routes-integrations.js";
import { handleFeaturesRoute } from "./routes-features.js";
import { createWebSocketManager } from "./websocket.js";
import { ALL_DATA_FILES } from "../schema/data-files.js";
import { findAvailablePort } from "./port.js";

/**
 * File written by the server process to communicate the actual port it bound to.
 * Used by the orchestrator (web.js) to discover the port in background mode,
 * where the server's stdout is not available.
 */
export const PORT_FILE = ".n-dx-web.port";

/** Result returned by startServer with the actual port used. */
export interface StartResult {
  /** The actual port the server is listening on. */
  port: number;
  /** Whether a fallback port was used (requested port was unavailable). */
  isFallback: boolean;
}

export interface ServerOptions {
  dev?: boolean;
  /** Restrict dashboard to a single package's views and APIs. */
  scope?: ViewerScope;
}

type RouteResult = boolean | Promise<boolean>;

function isInScope(scope: ViewerScope | undefined, pkg: ViewerScope): boolean {
  return !scope || scope === pkg;
}

function resolveRouteResult(result: RouteResult): Promise<boolean> | boolean {
  return result instanceof Promise ? result : result;
}

function registerSourcevisionWatcher(
  scope: ViewerScope | undefined,
  svDir: string,
  watcher: ReturnType<typeof createDataWatcher>,
  ws: ReturnType<typeof createWebSocketManager>,
): void {
  if (!isInScope(scope, "sourcevision") || !existsSync(svDir)) return;
  try {
    watch(svDir, (_eventType, filename) => {
      if (filename && (ALL_DATA_FILES as readonly string[]).includes(String(filename))) {
        watcher.refresh();
        ws.broadcast({
          type: "sv:data-changed",
          file: String(filename),
          timestamp: new Date().toISOString(),
        });
      }
    });
  } catch {
    // fs.watch may not be supported everywhere
  }
}

function registerRexWatcher(
  scope: ViewerScope | undefined,
  rexDir: string,
  watcher: ReturnType<typeof createDataWatcher>,
  ws: ReturnType<typeof createWebSocketManager>,
): void {
  if (!isInScope(scope, "rex") || !existsSync(rexDir)) return;
  try {
    watch(rexDir, (_eventType, filename) => {
      if (filename === "prd.json") {
        watcher.refresh();
        ws.broadcast({
          type: "rex:prd-changed",
          timestamp: new Date().toISOString(),
        });
      }
    });
  } catch {
    // ignore
  }
}

function registerHenchWatcher(
  scope: ViewerScope | undefined,
  henchRunsDir: string,
  ws: ReturnType<typeof createWebSocketManager>,
): void {
  if (!isInScope(scope, "hench") || !existsSync(henchRunsDir)) return;
  try {
    watch(henchRunsDir, (_eventType, filename) => {
      if (filename && String(filename).endsWith(".json")) {
        clearStatusCache();
        ws.broadcast({
          type: "hench:run-changed",
          file: String(filename),
          timestamp: new Date().toISOString(),
        });
      }
    });
  } catch {
    // ignore
  }
}

function registerDevViewerWatcher(
  dev: boolean,
  viewerPath: string,
  watcher: ReturnType<typeof createDataWatcher>,
  ws: ReturnType<typeof createWebSocketManager>,
): void {
  if (!dev || !viewerPath) return;
  try {
    watch(dirname(viewerPath), (_eventType, filename) => {
      if (filename === "index.html") {
        watcher.refresh();
        ws.broadcast({
          type: "viewer:reload",
          timestamp: new Date().toISOString(),
        });
      }
    });
  } catch {
    // ignore
  }
}

function registerWatchers(
  ctx: ServerContext,
  watcher: ReturnType<typeof createDataWatcher>,
  ws: ReturnType<typeof createWebSocketManager>,
  viewerPath: string,
): string {
  const henchRunsDir = join(ctx.projectDir, ".hench", "runs");
  registerSourcevisionWatcher(ctx.scope, ctx.svDir, watcher, ws);
  registerRexWatcher(ctx.scope, ctx.rexDir, watcher, ws);
  registerHenchWatcher(ctx.scope, henchRunsDir, ws);
  registerDevViewerWatcher(ctx.dev, viewerPath, watcher, ws);
  return henchRunsDir;
}

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
}

function handlePreflight(req: IncomingMessage, res: ServerResponse): boolean {
  if ((req.method || "GET") !== "OPTIONS") return false;
  res.writeHead(204);
  res.end();
  return true;
}

function handleConfigEndpoint(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): boolean {
  if ((req.url !== "/api/config") || (req.method || "GET") !== "GET") return false;
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
  res.end(JSON.stringify({ scope: ctx.scope ?? null, initialized: isProjectInitialized(ctx) }));
  return true;
}

function handleReloadSignalEndpoint(
  req: IncomingMessage,
  res: ServerResponse,
  ws: ReturnType<typeof createWebSocketManager>,
): boolean {
  if (req.url !== "/api/reload") return false;

  if ((req.method || "GET") !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return true;
  }

  const timestamp = new Date().toISOString();
  ws.broadcast({
    type: "viewer:reload",
    source: "ndx-refresh",
    timestamp,
  });
  ws.broadcast({
    type: "sv:data-changed",
    source: "ndx-refresh",
    timestamp,
  });
  ws.broadcast({
    type: "rex:prd-changed",
    source: "ndx-refresh",
    timestamp,
  });

  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
  res.end(JSON.stringify({
    ok: true,
    websocketClients: ws.clientCount(),
    timestamp,
  }));
  return true;
}

async function handleScopedRoute(
  enabled: boolean,
  result: RouteResult,
): Promise<boolean> {
  if (!enabled) return false;
  return await resolveRouteResult(result);
}

async function handleApiRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  watcher: ReturnType<typeof createDataWatcher>,
  ws: ReturnType<typeof createWebSocketManager>,
  assets: ReturnType<typeof resolveStaticAssets>,
): Promise<boolean> {
  if (await handleMcpRoute(req, res, ctx)) return true;
  if (await handleProjectRoute(req, res, ctx)) return true;
  if (handleStatusRoute(req, res, ctx)) return true;
  if (await handleConfigRoute(req, res, ctx)) return true;
  if (await handleScopedRoute(isInScope(ctx.scope, "rex"), handleNotionRoute(req, res, ctx))) return true;
  if (await handleScopedRoute(isInScope(ctx.scope, "rex"), handleIntegrationRoute(req, res, ctx))) return true;
  if (await handleFeaturesRoute(req, res, ctx)) return true;
  if (isInScope(ctx.scope, "sourcevision") && handleSourcevisionRoute(req, res, ctx)) return true;
  if (await handleScopedRoute(isInScope(ctx.scope, "rex"), handleRexRoute(req, res, ctx, ws.broadcast))) return true;
  if (await handleScopedRoute(isInScope(ctx.scope, "hench"), handleHenchRoute(req, res, ctx, ws.broadcast))) return true;
  if (await handleScopedRoute(isInScope(ctx.scope, "hench"), handleWorkflowRoute(req, res, ctx))) return true;
  if (await handleScopedRoute(isInScope(ctx.scope, "hench"), handleAdaptiveRoute(req, res, ctx))) return true;
  if (isInScope(ctx.scope, "rex") && handleValidationRoute(req, res, ctx)) return true;
  if (isInScope(ctx.scope, "rex") && handleTokenUsageRoute(req, res, ctx)) return true;
  if (handleDataRoute(req, res, ctx, watcher)) return true;
  if (assets && handleStaticRoute(req, res, ctx, assets)) return true;
  return false;
}

function createHttpServer(
  ctx: ServerContext,
  watcher: ReturnType<typeof createDataWatcher>,
  ws: ReturnType<typeof createWebSocketManager>,
  assets: ReturnType<typeof resolveStaticAssets>,
) {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    setCorsHeaders(res);
    if (handlePreflight(req, res)) return;
    if (handleConfigEndpoint(req, res, ctx)) return;
    if (handleReloadSignalEndpoint(req, res, ws)) return;
    if (await handleApiRoutes(req, res, ctx, watcher, ws, assets)) return;
    res.writeHead(404);
    res.end("Not found");
  });

  server.on("upgrade", (req, socket, head) => {
    ws.handleUpgrade(req, socket, head);
  });
  return server;
}

function logStartup(
  actualPort: number,
  ctx: ServerContext,
  henchRunsDir: string,
): void {
  const label = ctx.scope ? `${ctx.scope} viewer` : "n-dx dashboard";
  console.log(`${label} running at http://localhost:${actualPort}`);
  if (isInScope(ctx.scope, "sourcevision")) {
    console.log(`Serving data from: ${ctx.svDir}`);
  }
  if (isInScope(ctx.scope, "rex") && existsSync(ctx.rexDir)) {
    console.log(`Rex PRD data from: ${ctx.rexDir}`);
  }
  if (isInScope(ctx.scope, "hench") && existsSync(henchRunsDir)) {
    console.log(`Hench runs from: ${henchRunsDir}`);
  }
  console.log(`MCP (rex):          http://localhost:${actualPort}/mcp/rex`);
  console.log(`MCP (sourcevision): http://localhost:${actualPort}/mcp/sourcevision`);
  console.log(`WebSocket available at ws://localhost:${actualPort}`);
  if (ctx.scope) console.log(`Scope: ${ctx.scope} (standalone mode)`);
  if (ctx.dev) console.log("Dev mode: live reload enabled");
  console.log("");
  console.log("Claude Code MCP setup:");
  console.log(`  claude mcp add --transport http rex http://localhost:${actualPort}/mcp/rex`);
  console.log(`  claude mcp add --transport http sourcevision http://localhost:${actualPort}/mcp/sourcevision`);
  console.log("");
  console.log("Press Ctrl+C to stop.");
}

export async function startServer(
  targetDir: string,
  port: number = 3117,
  opts: ServerOptions = {},
): Promise<StartResult> {
  const absDir = resolve(targetDir);
  const svDir = join(absDir, ".sourcevision");
  const rexDir = join(absDir, ".rex");
  const dev = opts.dev ?? false;
  const scope = opts.scope;

  // ── Dynamic port allocation ───────────────────────────────────────────────
  // Try the requested port first; fall back to the next available port in
  // range 3117–3200 if it's already in use.
  const allocation = await findAvailablePort(port);
  const actualPort = allocation.port;

  if (!allocation.isOriginal) {
    console.log(
      `Port ${allocation.requestedPort} is in use — using port ${actualPort} instead.`,
    );
  }

  if (isInScope(scope, "sourcevision") && !existsSync(svDir)) {
    console.log("No .sourcevision/ directory found — landing page will be shown at /");
    console.log("Run 'ndx init .' to initialize, then 'ndx plan .' to analyze.");
  }

  // Resolve static assets
  const assets = resolveStaticAssets(dev);
  if (!assets) {
    console.error("Viewer HTML not found. Run 'npm run build:viewer' first.");
    process.exit(1);
  }

  // Create server context
  const ctx: ServerContext = { projectDir: absDir, svDir, rexDir, dev, scope };

  const watcher = createDataWatcher(ctx, assets.viewerPath);
  const ws = createWebSocketManager();
  const henchRunsDir = registerWatchers(ctx, watcher, ws, assets.viewerPath);

  // Start heartbeat monitor — periodically checks for unresponsive tasks and
  // broadcasts alerts via WebSocket.
  if (isInScope(scope, "hench")) {
    startHeartbeatMonitor(henchRunsDir, ws.broadcast);
  }

  const server = createHttpServer(ctx, watcher, ws, assets);

  return new Promise<StartResult>((resolvePromise, rejectPromise) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        rejectPromise(
          new Error(`Port ${actualPort} became unavailable during startup. Please try again.`),
        );
      } else if (err.code === "EACCES") {
        rejectPromise(
          new Error(
            `Permission denied for port ${actualPort}. ` +
            `Try a port above 1024 or run with elevated privileges.`,
          ),
        );
      } else {
        rejectPromise(err);
      }
    });

    server.listen(actualPort, async () => {
      // Write port file so the orchestrator can discover the actual port
      // (especially important in background mode where stdout is unavailable).
      const portFilePath = join(absDir, PORT_FILE);
      try {
        await writeFile(portFilePath, String(actualPort) + "\n", "utf-8");
      } catch {
        // Non-fatal: port file is a convenience, not a requirement
      }

      logStartup(actualPort, ctx, henchRunsDir);

      // ── Graceful shutdown ───────────────────────────────────────────────
      // On SIGINT/SIGTERM: terminate all active hench child processes (with
      // force-kill fallback), close the HTTP server, then remove the port
      // file and exit.  The `exit` handler is a last-resort safety net that
      // removes the port file even if we crash before the graceful path runs.
      const gracefulShutdown = async () => {
        await shutdownActiveExecutions();
        server.close();
        unlink(portFilePath).catch(() => {});
        process.exit(0);
      };
      process.once("SIGINT", gracefulShutdown);
      process.once("SIGTERM", gracefulShutdown);
      process.once("exit", () => { unlink(portFilePath).catch(() => {}); });

      resolvePromise({
        port: actualPort,
        isFallback: !allocation.isOriginal,
      });
    });
  });
}
