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
import { handleHenchRoute, startHeartbeatMonitor } from "./routes-hench.js";
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

  // Helper: is this package in scope?
  const inScope = (pkg: ViewerScope): boolean => !scope || scope === pkg;

  if (inScope("sourcevision") && !existsSync(svDir)) {
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

  // Set up data watcher for live-reload
  const watcher = createDataWatcher(ctx, assets.viewerPath);

  // Set up WebSocket manager
  const ws = createWebSocketManager();

  // Watch .sourcevision/ for changes
  if (inScope("sourcevision") && existsSync(svDir)) {
    try {
      watch(svDir, (_eventType, filename) => {
        if (filename && (ALL_DATA_FILES as readonly string[]).includes(filename)) {
          watcher.refresh();
          // Broadcast file-change event over WebSocket
          ws.broadcast({
            type: "sv:data-changed",
            file: filename,
            timestamp: new Date().toISOString(),
          });
        }
      });
    } catch {
      // fs.watch may not be supported everywhere
    }
  }

  // Watch .rex/ for prd.json changes
  if (inScope("rex") && existsSync(rexDir)) {
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

  // Watch .hench/runs/ for run file changes
  const henchRunsDir = join(absDir, ".hench", "runs");
  if (inScope("hench") && existsSync(henchRunsDir)) {
    try {
      watch(henchRunsDir, (_eventType, filename) => {
        if (filename && filename.endsWith(".json")) {
          // Invalidate status cache so the next /api/status request gets fresh counts
          clearStatusCache();
          ws.broadcast({
            type: "hench:run-changed",
            file: filename,
            timestamp: new Date().toISOString(),
          });
        }
      });
    } catch {
      // ignore
    }
  }

  // In dev mode, also watch the viewer HTML for rebuilds
  if (dev && assets.viewerPath) {
    try {
      watch(dirname(assets.viewerPath), (_eventType, filename) => {
        if (filename === "index.html") {
          watcher.refresh();
          // Notify connected browsers to reload via WebSocket
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

  // Start heartbeat monitor — periodically checks for unresponsive tasks and
  // broadcasts alerts via WebSocket.
  if (inScope("hench")) {
    startHeartbeatMonitor(henchRunsDir, ws.broadcast);
  }

  // Create HTTP server
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS headers for local dev (also required for cross-origin MCP clients)
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    // Handle CORS preflight
    if ((req.method || "GET") === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Viewer config endpoint — exposes scope and init status to the client
    if ((req.url === "/api/config") && (req.method || "GET") === "GET") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
      res.end(JSON.stringify({ scope: scope ?? null, initialized: isProjectInitialized(ctx) }));
      return;
    }

    // Try each route handler in order
    // 0. MCP endpoints (/mcp/rex, /mcp/sourcevision)
    if (await handleMcpRoute(req, res, ctx)) return;

    // 0b. Project metadata (cross-cutting, not scope-gated)
    if (await handleProjectRoute(req, res, ctx)) return;

    // 0c. Project status indicators (cross-cutting, not scope-gated)
    if (handleStatusRoute(req, res, ctx)) return;

    // 0d. Configuration display and project detection (cross-cutting)
    if (await handleConfigRoute(req, res, ctx)) return;

    // 0e. Notion integration config (rex-related)
    if (inScope("rex") && await handleNotionRoute(req, res, ctx)) return;

    // 0f. Generic integration config (rex-related)
    if (inScope("rex") && await handleIntegrationRoute(req, res, ctx)) return;

    // 0g. Feature toggles (cross-cutting, not scope-gated)
    if (await handleFeaturesRoute(req, res, ctx)) return;

    // 1. Sourcevision API
    if (inScope("sourcevision") && handleSourcevisionRoute(req, res, ctx)) return;

    // 2. Rex API
    if (inScope("rex")) {
      const rexResult = handleRexRoute(req, res, ctx, ws.broadcast);
      if (rexResult instanceof Promise) {
        if (await rexResult) return;
      } else if (rexResult) {
        return;
      }
    }

    // 3. Hench API
    if (inScope("hench")) {
      const henchResult = handleHenchRoute(req, res, ctx, ws.broadcast);
      if (henchResult instanceof Promise) {
        if (await henchResult) return;
      } else if (henchResult) {
        return;
      }
    }

    // 3b. Hench Workflow Optimization API
    if (inScope("hench")) {
      const workflowResult = handleWorkflowRoute(req, res, ctx);
      if (workflowResult instanceof Promise) {
        if (await workflowResult) return;
      } else if (workflowResult) {
        return;
      }
    }

    // 3c. Hench Adaptive Workflow Adjustment API
    if (inScope("hench")) {
      const adaptiveResult = handleAdaptiveRoute(req, res, ctx);
      if (adaptiveResult instanceof Promise) {
        if (await adaptiveResult) return;
      } else if (adaptiveResult) {
        return;
      }
    }

    // 4. Validation & dependency graph API (rex-related)
    if (inScope("rex") && handleValidationRoute(req, res, ctx)) return;

    // 5. Token usage API (cross-cutting, but lives in rex section)
    if (inScope("rex") && handleTokenUsageRoute(req, res, ctx)) return;

    // 6. Data files (existing /data/* routes for backward compatibility)
    if (handleDataRoute(req, res, ctx, watcher)) return;

    // 7. Static assets
    if (handleStaticRoute(req, res, ctx, assets)) return;

    // 404
    res.writeHead(404);
    res.end("Not found");
  });

  // Handle WebSocket upgrades
  server.on("upgrade", (req, socket, head) => {
    ws.handleUpgrade(req, socket, head);
  });

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

      const label = scope ? `${scope} viewer` : "n-dx dashboard";
      console.log(`${label} running at http://localhost:${actualPort}`);
      if (inScope("sourcevision")) {
        console.log(`Serving data from: ${svDir}`);
      }
      if (inScope("rex") && existsSync(rexDir)) {
        console.log(`Rex PRD data from: ${rexDir}`);
      }
      if (inScope("hench") && existsSync(henchRunsDir)) {
        console.log(`Hench runs from: ${henchRunsDir}`);
      }
      console.log(`MCP (rex):          http://localhost:${actualPort}/mcp/rex`);
      console.log(`MCP (sourcevision): http://localhost:${actualPort}/mcp/sourcevision`);
      console.log(`WebSocket available at ws://localhost:${actualPort}`);
      if (scope) console.log(`Scope: ${scope} (standalone mode)`);
      if (dev) console.log("Dev mode: live reload enabled");
      console.log("");
      console.log("Claude Code MCP setup:");
      console.log(`  claude mcp add --transport http rex http://localhost:${actualPort}/mcp/rex`);
      console.log(`  claude mcp add --transport http sourcevision http://localhost:${actualPort}/mcp/sourcevision`);
      console.log("");
      console.log("Press Ctrl+C to stop.");

      // Clean up port file on process exit
      const removePortFile = () => {
        unlink(portFilePath).catch(() => {});
      };
      process.once("SIGINT", removePortFile);
      process.once("SIGTERM", removePortFile);
      process.once("exit", removePortFile);

      resolvePromise({
        port: actualPort,
        isFallback: !allocation.isOriginal,
      });
    });
  });
}
