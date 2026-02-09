/**
 * Server entry point — creates the HTTP server and wires up all routes.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, watch } from "node:fs";
import { resolve, join, dirname } from "node:path";
import type { ServerContext } from "./types.js";
import { resolveStaticAssets, handleStaticRoute } from "./routes-static.js";
import { createDataWatcher, handleDataRoute } from "./routes-data.js";
import { handleRexRoute } from "./routes-rex.js";
import { handleSourcevisionRoute } from "./routes-sourcevision.js";
import { handleTokenUsageRoute } from "./routes-token-usage.js";
import { handleValidationRoute } from "./routes-validation.js";
import { handleHenchRoute } from "./routes-hench.js";
import { createWebSocketManager } from "./websocket.js";
import { ALL_DATA_FILES } from "../../schema/data-files.js";

export interface ServerOptions {
  dev?: boolean;
}

export function startServer(
  targetDir: string,
  port: number = 3117,
  opts: ServerOptions = {},
): void {
  const absDir = resolve(targetDir);
  const svDir = join(absDir, ".sourcevision");
  const rexDir = join(absDir, ".rex");
  const dev = opts.dev ?? false;

  if (!existsSync(svDir)) {
    console.error(`No .sourcevision/ directory found in: ${absDir}`);
    console.error("Run 'sourcevision analyze' first.");
    process.exit(1);
  }

  // Resolve static assets
  const assets = resolveStaticAssets(dev);
  if (!assets) {
    console.error("Viewer HTML not found. Run 'npm run build:viewer' first.");
    process.exit(1);
  }

  // Create server context
  const ctx: ServerContext = { projectDir: absDir, svDir, rexDir, dev };

  // Set up data watcher for live-reload
  const watcher = createDataWatcher(ctx, assets.viewerPath);

  // Set up WebSocket manager
  const ws = createWebSocketManager();

  // Watch .sourcevision/ for changes
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

  // Watch .rex/ for prd.json changes
  if (existsSync(rexDir)) {
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
  if (existsSync(henchRunsDir)) {
    try {
      watch(henchRunsDir, (_eventType, filename) => {
        if (filename && filename.endsWith(".json")) {
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
        }
      });
    } catch {
      // ignore
    }
  }

  // Create HTTP server
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS headers for local dev
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    // Handle CORS preflight
    if ((req.method || "GET") === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Try each route handler in order
    // 1. Sourcevision API
    if (handleSourcevisionRoute(req, res, ctx)) return;

    // 2. Rex API
    const rexResult = handleRexRoute(req, res, ctx, ws.broadcast);
    if (rexResult instanceof Promise) {
      if (await rexResult) return;
    } else if (rexResult) {
      return;
    }

    // 3. Hench API
    if (handleHenchRoute(req, res, ctx)) return;

    // 4. Validation & dependency graph API
    if (handleValidationRoute(req, res, ctx)) return;

    // 5. Token usage API
    if (handleTokenUsageRoute(req, res, ctx)) return;

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

  server.listen(port, () => {
    console.log(`n-dx dashboard running at http://localhost:${port}`);
    console.log(`Serving data from: ${svDir}`);
    if (existsSync(rexDir)) {
      console.log(`Rex PRD data from: ${rexDir}`);
    }
    if (existsSync(henchRunsDir)) {
      console.log(`Hench runs from: ${henchRunsDir}`);
    }
    console.log(`WebSocket available at ws://localhost:${port}`);
    if (dev) console.log("Dev mode: live reload enabled");
    console.log("Press Ctrl+C to stop.");
  });
}
