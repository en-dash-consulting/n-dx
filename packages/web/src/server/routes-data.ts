/**
 * Data routes — serves .sourcevision/ data files and live-reload status.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import type { ServerContext } from "./types.js";
import { jsonResponse } from "./types.js";
import { ALL_DATA_FILES, SUPPLEMENTARY_FILES } from "../shared/index.js";
import { prdExists, prdPath } from "./prd-io.js";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".md": "text/markdown",
  ".txt": "text/plain",
};

export interface DataWatcher {
  fileMtimes: Record<string, number>;
  viewerMtime: number;
  refresh: () => void;
}

/** Create a mtime tracker for live-reload support. */
export function createDataWatcher(ctx: ServerContext, viewerPath?: string): DataWatcher {
  const watcher: DataWatcher = {
    fileMtimes: {},
    viewerMtime: 0,
    refresh() {
      for (const file of ALL_DATA_FILES) {
        const filePath = join(ctx.svDir, file);
        try {
          if (existsSync(filePath)) {
            watcher.fileMtimes[file] = statSync(filePath).mtimeMs;
          }
        } catch {
          // File may be mid-write
        }
      }
      // Track prd.json mtime
      try {
        if (prdExists(ctx.rexDir)) {
          watcher.fileMtimes["prd.json"] = statSync(prdPath(ctx.rexDir)).mtimeMs;
        }
      } catch {
        // ignore
      }
      // Track viewer HTML mtime in dev mode
      if (ctx.dev && viewerPath) {
        try {
          watcher.viewerMtime = statSync(viewerPath).mtimeMs;
        } catch {
          // ignore
        }
      }
    },
  };
  watcher.refresh();
  return watcher;
}

/** Handle data file requests. Returns true if the request was handled. */
export function handleDataRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  watcher: DataWatcher,
): boolean {
  const url = req.url || "/";
  const method = req.method || "GET";

  if (method !== "GET") return false;

  // Status endpoint for live reload polling
  if (url === "/data/status") {
    const status: Record<string, unknown> = { mtimes: watcher.fileMtimes };
    if (ctx.dev) status.viewerMtime = watcher.viewerMtime;
    jsonResponse(res, 200, status);
    return true;
  }

  // List available data files
  if (url === "/data") {
    const files: string[] = [...ALL_DATA_FILES, ...SUPPLEMENTARY_FILES];
    const available: string[] = files.filter((f) => existsSync(join(ctx.svDir, f)));
    if (prdExists(ctx.rexDir)) {
      available.push("prd.json");
    }
    jsonResponse(res, 200, { files: available });
    return true;
  }

  // Serve individual data files
  if (url.startsWith("/data/")) {
    const dataFile = url.replace("/data/", "");

    // Serve prd.json from .rex/ directory
    if (dataFile === "prd.json") {
      const resolvedPrdPath = prdPath(ctx.rexDir);
      if (prdExists(ctx.rexDir)) {
        const stat = statSync(resolvedPrdPath);
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Length": stat.size,
          "Cache-Control": "no-cache",
        });
        createReadStream(resolvedPrdPath).pipe(res);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
      return true;
    }

    const filePath = join(ctx.svDir, dataFile);

    // Prevent directory traversal
    if (!filePath.startsWith(ctx.svDir)) {
      res.writeHead(403);
      res.end("Forbidden");
      return true;
    }

    if (existsSync(filePath)) {
      const ext = extname(filePath);
      const mime = MIME_TYPES[ext] || "application/octet-stream";
      const stat = statSync(filePath);
      res.writeHead(200, {
        "Content-Type": mime,
        "Content-Length": stat.size,
      });
      createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
    return true;
  }

  return false;
}
