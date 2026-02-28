/**
 * Server entry point — creates the HTTP server and wires up all routes.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { writeFile, unlink } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import type { ServerContext, ViewerScope } from "./types.js";
import { resolveStaticAssets, handleStaticRoute, isProjectInitialized } from "./routes-static.js";
import { createDataWatcher, handleDataRoute } from "./routes-data.js";
import { handleRexRoute, shutdownRexExecution } from "./routes-rex.js";
import { handleSourcevisionRoute } from "./routes-sourcevision.js";
import { handleTokenUsageRoute } from "./routes-token-usage.js";
import { handleValidationRoute } from "./routes-validation.js";
import { handleHenchRoute, startHeartbeatMonitor, startConcurrencyMonitor, startMemoryMonitor, shutdownActiveExecutions, getAggregator } from "./routes-hench.js";
import { startUsageCleanupScheduler } from "./usage-cleanup-scheduler.js";
import { handleWorkflowRoute } from "./routes-workflow.js";
import { handleAdaptiveRoute } from "./routes-adaptive.js";
import { handleMcpRoute } from "./routes-mcp.js";
import { handleProjectRoute } from "./routes-project.js";
import { handleStatusRoute, clearStatusCache } from "./routes-status.js";
import { handleConfigRoute } from "./routes-config.js";
import { handleSearchRoute } from "./routes-search.js";
import { handleNotionRoute } from "./routes-notion.js";
import { handleIntegrationRoute } from "./routes-integrations.js";
import { handleFeaturesRoute } from "./routes-features.js";
import { createWebSocketManager } from "./websocket.js";
import { WsHealthTracker } from "./ws-health-tracker.js";
import { ALL_DATA_FILES } from "../shared/data-files.js";
import { findAvailablePort } from "./port.js";

/**
 * File written by the server process to communicate the actual port it bound to.
 * Used by the orchestrator (web.js) to discover the port in background mode,
 * where the server's stdout is not available.
 */
export const PORT_FILE = ".n-dx-web.port";

// ── Shutdown handler ──────────────────────────────────────────────────────

/** Maximum time in milliseconds for the full graceful-shutdown sequence. */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 30_000;

/** @internal Injection points used in tests instead of global process calls. */
export interface ShutdownDeps {
  /** Replaces `process.exit()` so tests can verify exit codes without dying. */
  exit?(code: number): void;
}

/**
 * Registers SIGINT / SIGTERM signal handlers that co-ordinate a graceful
 * shutdown of all dashboard components in dependency order:
 *
 *   1. Hench child processes  (highest priority: avoids orphaned agents)
 *   2. WebSocket connections  (clients receive a clean close frame)
 *   3. HTTP server            (stops accepting; drains in-flight requests)
 *   4. Port file              (orchestrator sees the port as free)
 *
 * **Double-signal handling** — a second SIGINT/SIGTERM received while the
 * graceful sequence is still running triggers an immediate `exit(1)`, so an
 * operator can always escape a stuck shutdown with a second Ctrl-C.
 *
 * **Timeout** — if the full sequence exceeds `timeoutMs` the process is
 * force-killed via `exit(1)` to prevent indefinite hangs.
 *
 * @param server       The HTTP server to drain and close.
 * @param ws           WebSocket manager whose connections should be torn down.
 * @param portFilePath Port file path to remove so the orchestrator sees the port as free.
 * @param actualPort   Bound port number (for log messages only).
 * @param timeoutMs    Max ms to wait before forcing exit (default 30 s, override
 *                     via `N_DX_SHUTDOWN_TIMEOUT_MS` env var).
 * @param deps         Injection points for unit testing (do not use in production).
 */
export function registerShutdownHandlers(
  server: { close(cb: (err?: Error) => void): void },
  ws: { shutdown(): void },
  portFilePath: string,
  actualPort: number,
  timeoutMs: number = Number(process.env["N_DX_SHUTDOWN_TIMEOUT_MS"] ?? DEFAULT_SHUTDOWN_TIMEOUT_MS),
  deps: ShutdownDeps = {},
  watcherHandles?: WatcherHandles,
): void {
  const doExit = deps.exit ?? ((code: number) => process.exit(code));

  const forceExit = (signal: string): void => {
    console.log(`[shutdown] ${signal} received during shutdown — forcing immediate exit`);
    doExit(1);
  };

  const gracefulShutdown = async (signal: string): Promise<void> => {
    // Re-register for a second signal → immediate force exit.
    // This lets an operator escape a stuck shutdown by pressing Ctrl-C again.
    process.once("SIGINT", () => forceExit("SIGINT"));
    process.once("SIGTERM", () => forceExit("SIGTERM"));

    console.log(`[shutdown] graceful shutdown initiated (${signal})`);

    // Arm an overall deadline so a hung cleanup step cannot block exit forever.
    const timer = setTimeout(() => {
      console.error(`[shutdown] timed out after ${timeoutMs}ms — forcing exit`);
      doExit(1);
    }, timeoutMs);
    // Does not prevent the event loop from exiting if cleanup completes first.
    timer.unref();

    // Track per-component status for the final verification summary.
    const componentStatus: { component: string; ok: boolean }[] = [];

    // Step 0 — close file system watchers (release OS file descriptors)
    if (watcherHandles) {
      closeWatchers(watcherHandles);
    }

    // Step 1 — terminate hench child processes (highest priority: avoids orphaned agents)
    // Covers both hench-route executions and the rex epic-by-epic execution engine.
    console.log("[shutdown] step 1/4 — child processes");
    const [henchResult, rexResult] = await Promise.all([
      shutdownActiveExecutions(),
      shutdownRexExecution(),
    ]);
    componentStatus.push({ component: "hench-executions", ok: henchResult.failed === 0 });
    componentStatus.push({
      component: "rex-execution",
      ok: !rexResult.hadActiveProcess || rexResult.terminated,
    });

    // Step 2 — close WebSocket connections (sends close frames, frees sockets)
    console.log("[shutdown] step 2/4 — WebSocket connections");
    ws.shutdown();
    console.log("[shutdown] WebSocket connections closed");
    componentStatus.push({ component: "websockets", ok: true });

    // Step 3 — close HTTP server (stop accepting new connections; wait for
    //           in-flight requests to drain so the port is fully released)
    console.log("[shutdown] step 3/4 — HTTP server");
    let httpOk = false;
    await new Promise<void>((resolve) => {
      server.close((err) => {
        if (err) {
          console.error(`[shutdown] server close error: ${err.message}`);
        } else {
          console.log(`[shutdown] HTTP server closed — port ${actualPort} released`);
          httpOk = true;
        }
        resolve();
      });
    });
    componentStatus.push({ component: "http-server", ok: httpOk });

    // Step 4 — remove port file (orchestrator sees port as free)
    console.log("[shutdown] step 4/4 — port file");
    let portFileOk = false;
    try {
      await unlink(portFilePath);
      console.log("[shutdown] port file removed");
      portFileOk = true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        // Already gone — that is fine.
        portFileOk = true;
      } else {
        console.error(`[shutdown] failed to remove port file: ${(err as Error).message}`);
      }
    }
    componentStatus.push({ component: "port-file", ok: portFileOk });

    // Verification summary — confirm all components shut down cleanly.
    const failedComponents = componentStatus.filter((c) => !c.ok).map((c) => c.component);
    if (failedComponents.length === 0) {
      console.log(`[shutdown] verified: all ${componentStatus.length} components shut down cleanly`);
    } else {
      console.error(`[shutdown] verification failed: ${failedComponents.join(", ")} did not shut down cleanly`);
    }

    clearTimeout(timer);
    console.log("[shutdown] complete");
    doExit(0);
  };

  process.once("SIGINT", () => gracefulShutdown("SIGINT"));
  process.once("SIGTERM", () => gracefulShutdown("SIGTERM"));
  // Last-resort safety net: remove the port file even if the graceful path
  // never runs (e.g. an uncaught exception that bypasses gracefulShutdown).
  process.once("exit", () => { unlink(portFilePath).catch(() => {}); });
}

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

// ── File watcher debouncing ──────────────────────────────────────────────────
// During builds, fs.watch fires many events in rapid succession. Debouncing
// batches them into a single refresh + broadcast, preventing memory spikes
// from concurrent fetch storms.

const WATCHER_DEBOUNCE_MS = 500;

/**
 * Create a debounced version of a callback. Multiple calls within `delayMs`
 * are collapsed into a single trailing invocation.
 */
function debounce<T extends (...args: unknown[]) => void>(fn: T, delayMs: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: unknown[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, delayMs);
  }) as T;
}

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
): FSWatcher | null {
  if (!isInScope(scope, "sourcevision") || !existsSync(svDir)) return null;
  const debouncedRefresh = debounce(() => {
    watcher.refresh();
    ws.broadcast({
      type: "sv:data-changed",
      timestamp: new Date().toISOString(),
    });
  }, WATCHER_DEBOUNCE_MS);
  try {
    return watch(svDir, (_eventType, filename) => {
      if (filename && (ALL_DATA_FILES as readonly string[]).includes(String(filename))) {
        debouncedRefresh();
      }
    });
  } catch {
    // fs.watch may not be supported everywhere
    return null;
  }
}

function registerRexWatcher(
  scope: ViewerScope | undefined,
  rexDir: string,
  watcher: ReturnType<typeof createDataWatcher>,
  ws: ReturnType<typeof createWebSocketManager>,
): FSWatcher | null {
  if (!isInScope(scope, "rex") || !existsSync(rexDir)) return null;
  const debouncedRefresh = debounce(() => {
    watcher.refresh();
    ws.broadcast({
      type: "rex:prd-changed",
      timestamp: new Date().toISOString(),
    });
  }, WATCHER_DEBOUNCE_MS);
  try {
    return watch(rexDir, (_eventType, filename) => {
      if (filename === "prd.json") {
        debouncedRefresh();
      }
    });
  } catch {
    // ignore
    return null;
  }
}

function registerHenchWatcher(
  scope: ViewerScope | undefined,
  henchRunsDir: string,
  ws: ReturnType<typeof createWebSocketManager>,
): FSWatcher | null {
  if (!isInScope(scope, "hench") || !existsSync(henchRunsDir)) return null;
  const debouncedBroadcast = debounce(() => {
    clearStatusCache();
    ws.broadcast({
      type: "hench:run-changed",
      timestamp: new Date().toISOString(),
    });
  }, WATCHER_DEBOUNCE_MS);
  try {
    return watch(henchRunsDir, (_eventType, filename) => {
      if (filename && String(filename).endsWith(".json")) {
        debouncedBroadcast();
      }
    });
  } catch {
    // ignore
    return null;
  }
}

function registerDevViewerWatcher(
  dev: boolean,
  viewerPath: string,
  watcher: ReturnType<typeof createDataWatcher>,
  ws: ReturnType<typeof createWebSocketManager>,
): FSWatcher | null {
  if (!dev || !viewerPath) return null;
  const debouncedRefresh = debounce(() => {
    watcher.refresh();
    ws.broadcast({
      type: "viewer:reload",
      timestamp: new Date().toISOString(),
    });
  }, WATCHER_DEBOUNCE_MS);
  try {
    return watch(dirname(viewerPath), (_eventType, filename) => {
      if (filename === "index.html") {
        debouncedRefresh();
      }
    });
  } catch {
    // ignore
    return null;
  }
}

/** Collected file system watchers and monitor intervals for cleanup during shutdown. */
interface WatcherHandles {
  watchers: FSWatcher[];
  henchRunsDir: string;
  /** Monitor intervals to clear on shutdown. */
  monitorIntervals: ReturnType<typeof setInterval>[];
}

function registerWatchers(
  ctx: ServerContext,
  watcher: ReturnType<typeof createDataWatcher>,
  ws: ReturnType<typeof createWebSocketManager>,
  viewerPath: string,
): WatcherHandles {
  const henchRunsDir = join(ctx.projectDir, ".hench", "runs");
  const watchers: FSWatcher[] = [];
  const sv = registerSourcevisionWatcher(ctx.scope, ctx.svDir, watcher, ws);
  if (sv) watchers.push(sv);
  const rex = registerRexWatcher(ctx.scope, ctx.rexDir, watcher, ws);
  if (rex) watchers.push(rex);
  const hench = registerHenchWatcher(ctx.scope, henchRunsDir, ws);
  if (hench) watchers.push(hench);
  const dev = registerDevViewerWatcher(ctx.dev, viewerPath, watcher, ws);
  if (dev) watchers.push(dev);
  return { watchers, henchRunsDir, monitorIntervals: [] };
}

/** Close all file system watchers and monitor intervals to release resources. */
function closeWatchers(handles: WatcherHandles): void {
  for (const w of handles.watchers) {
    try { w.close(); } catch { /* ignore */ }
  }
  handles.watchers.length = 0;
  for (const interval of handles.monitorIntervals) {
    try { clearInterval(interval); } catch { /* ignore */ }
  }
  handles.monitorIntervals.length = 0;
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

function handleWsHealthEndpoint(
  req: IncomingMessage,
  res: ServerResponse,
  wsHealthTracker: WsHealthTracker,
): boolean {
  if (req.url !== "/api/ws/health" || (req.method || "GET") !== "GET") return false;

  const snapshot = wsHealthTracker.getSnapshot();
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
  res.end(JSON.stringify(snapshot));
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
  wsHealthTracker: WsHealthTracker,
): Promise<boolean> {
  if (handleWsHealthEndpoint(req, res, wsHealthTracker)) return true;
  if (await handleMcpRoute(req, res, ctx)) return true;
  if (await handleProjectRoute(req, res, ctx)) return true;
  if (handleStatusRoute(req, res, ctx)) return true;
  if (await handleConfigRoute(req, res, ctx)) return true;
  if (await handleScopedRoute(isInScope(ctx.scope, "rex"), handleNotionRoute(req, res, ctx))) return true;
  if (await handleScopedRoute(isInScope(ctx.scope, "rex"), handleIntegrationRoute(req, res, ctx))) return true;
  if (await handleFeaturesRoute(req, res, ctx)) return true;
  if (isInScope(ctx.scope, "sourcevision") && handleSourcevisionRoute(req, res, ctx)) return true;
  if (isInScope(ctx.scope, "rex") && handleSearchRoute(req, res, ctx)) return true;
  if (await handleScopedRoute(isInScope(ctx.scope, "rex"), handleRexRoute(req, res, ctx, ws.broadcast))) return true;
  if (await handleScopedRoute(isInScope(ctx.scope, "hench"), handleHenchRoute(req, res, ctx, ws.broadcast))) return true;
  if (await handleScopedRoute(isInScope(ctx.scope, "hench"), handleWorkflowRoute(req, res, ctx))) return true;
  if (await handleScopedRoute(isInScope(ctx.scope, "hench"), handleAdaptiveRoute(req, res, ctx))) return true;
  if (isInScope(ctx.scope, "rex") && handleValidationRoute(req, res, ctx)) return true;
  if (await handleScopedRoute(isInScope(ctx.scope, "rex"), handleTokenUsageRoute(req, res, ctx))) return true;
  if (handleDataRoute(req, res, ctx, watcher)) return true;
  if (assets && handleStaticRoute(req, res, ctx, assets)) return true;
  return false;
}

function createHttpServer(
  ctx: ServerContext,
  watcher: ReturnType<typeof createDataWatcher>,
  ws: ReturnType<typeof createWebSocketManager>,
  assets: ReturnType<typeof resolveStaticAssets>,
  wsHealthTracker: WsHealthTracker,
) {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    setCorsHeaders(res);
    if (handlePreflight(req, res)) return;
    if (handleConfigEndpoint(req, res, ctx)) return;
    if (handleReloadSignalEndpoint(req, res, ws)) return;
    if (await handleApiRoutes(req, res, ctx, watcher, ws, assets, wsHealthTracker)) return;
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

/** Interval (ms) for broadcasting WS health metrics to connected clients. */
const WS_HEALTH_BROADCAST_INTERVAL_MS = 10_000;

/**
 * Periodically broadcast WebSocket connection health metrics.
 * Follows the same pattern as heartbeat/concurrency/memory monitors.
 */
function startWsHealthBroadcast(
  broadcast: (data: unknown) => void,
  tracker: WsHealthTracker,
  clientCount: () => number,
): ReturnType<typeof setInterval> {
  return setInterval(() => {
    // Sync active count with actual client set to correct any drift
    tracker.syncActiveCount(clientCount());
    const snapshot = tracker.getSnapshot();
    broadcast({
      type: "ws:health-status",
      ...snapshot,
    });
  }, WS_HEALTH_BROADCAST_INTERVAL_MS);
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
  // Try the requested port first (with retries to handle the TIME_WAIT window
  // that follows a recent server shutdown), then fall back to the next
  // available port in range 3117–3200 if the preferred port remains occupied.
  const allocation = await findAvailablePort(port, undefined, undefined, {
    maxRetries: 5,
    retryDelayMs: 100,
    backoffFactor: 2,
  });
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
  const wsHealthTracker = new WsHealthTracker();
  const ws = createWebSocketManager({ healthTracker: wsHealthTracker });
  const watcherHandles = registerWatchers(ctx, watcher, ws, assets.viewerPath);

  // Start heartbeat monitor — periodically checks for unresponsive tasks and
  // broadcasts alerts via WebSocket.
  if (isInScope(scope, "hench")) {
    startHeartbeatMonitor(watcherHandles.henchRunsDir, ws.broadcast);
    startConcurrencyMonitor(ctx, ws.broadcast);
    startMemoryMonitor(ws.broadcast);

    // Start periodic usage cleanup — prunes orphaned aggregation entries
    // for tasks that no longer exist in the PRD (configurable, default weekly).
    const cleanupInterval = startUsageCleanupScheduler(
      ctx,
      () => getAggregator(watcherHandles.henchRunsDir),
      ws.broadcast,
    );
    watcherHandles.monitorIntervals.push(cleanupInterval);
  }

  // Start WS health broadcast — periodically sends connection health
  // metrics to all connected dashboard clients.
  const wsHealthInterval = startWsHealthBroadcast(ws.broadcast, wsHealthTracker, ws.clientCount);
  watcherHandles.monitorIntervals.push(wsHealthInterval);

  const server = createHttpServer(ctx, watcher, ws, assets, wsHealthTracker);

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

      logStartup(actualPort, ctx, watcherHandles.henchRunsDir);

      // ── Graceful shutdown ───────────────────────────────────────────────
      // Single handler coordinates cleanup in dependency order:
      //   0. File watchers          (release OS file descriptors)
      //   1. Hench child processes  (avoid orphaned agents)
      //   2. WebSocket connections  (clean close frames)
      //   3. HTTP server            (drain in-flight requests)
      //   4. Port file              (orchestrator discovery)
      // A second signal forces immediate exit; overall timeout prevents hangs.
      registerShutdownHandlers(server, ws, portFilePath, actualPort, undefined, {}, watcherHandles);

      resolvePromise({
        port: actualPort,
        isFallback: !allocation.isOriginal,
      });
    });
  });
}
