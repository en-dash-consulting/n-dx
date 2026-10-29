/**
 * Data routes — serves .sourcevision/ data files and live-reload status.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream, existsSync, realpathSync, statSync } from "node:fs";
import { join, extname, sep } from "node:path";
import type { ServerContext } from "./types.js";
import { jsonResponse } from "./response-utils.js";
import { ALL_DATA_FILES, SUPPLEMENTARY_FILES, applyStrictContentPolicy } from "../shared/index.js";
import { prdExists, loadPRDSync, prdMaxMtimeMs } from "./prd-io.js";

/**
 * The files `/data/*` serves: the sourcevision data set and its supplementary
 * text files, plus the aggregated `prd.json`. Anything else under
 * `.sourcevision/` is not the dashboard's to serve, whatever its extension —
 * an `.html` or `.svg` there would otherwise run on the dashboard's origin.
 */
const SERVED_DATA_FILES: ReadonlySet<string> = new Set<string>([...ALL_DATA_FILES, ...SUPPLEMENTARY_FILES]);

/** Data, never a document: JSON as JSON, everything else as plain text. */
function dataContentType(file: string): string {
  return extname(file) === ".json" ? "application/json; charset=utf-8" : "text/plain; charset=utf-8";
}

/** Headers every `/data/*` answer carries, before its status is written. */
function applyDataHeaders(res: ServerResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  applyStrictContentPolicy(res);
}

function refuse(res: ServerResponse, status: 403 | 404): true {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(status === 403 ? "Forbidden" : "Not found");
  return true;
}

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
      // Track the prd.json mtime for live-reload polling
      try {
        const mtime = prdMaxMtimeMs(ctx.rexDir);
        if (mtime > 0) {
          watcher.fileMtimes["prd.json"] = mtime;
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
    applyDataHeaders(res);
    const dataFile = url.slice("/data/".length).split("?")[0]!;

    // Serve aggregated PRD from .rex/ directory (all prd_*.json + legacy prd.json)
    if (dataFile === "prd.json") {
      if (prdExists(ctx.rexDir)) {
        const doc = loadPRDSync(ctx.rexDir);
        if (doc) {
          const body = JSON.stringify(doc);
          res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": Buffer.byteLength(body),
            "Cache-Control": "no-cache",
          });
          res.end(body);
        } else {
          res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Failed to load PRD");
        }
      } else {
        refuse(res, 404);
      }
      return true;
    }

    // A name that is not a single path segment is a traversal attempt, not a
    // file this route could ever serve.
    if (dataFile === "" || dataFile.includes("/") || dataFile.includes("\\") || dataFile.includes("..")) {
      return refuse(res, 403);
    }
    if (!SERVED_DATA_FILES.has(dataFile)) return refuse(res, 404);

    // Confined by real path, so a symlink in .sourcevision/ cannot serve a
    // file from anywhere else on disk.
    let realFile: string;
    let realDir: string;
    try {
      realDir = realpathSync(ctx.svDir);
      realFile = realpathSync(join(ctx.svDir, dataFile));
    } catch {
      return refuse(res, 404);
    }
    if (!realFile.startsWith(realDir + sep)) return refuse(res, 403);

    let size: number;
    try {
      const stat = statSync(realFile);
      if (!stat.isFile()) return refuse(res, 404);
      size = stat.size;
    } catch {
      return refuse(res, 404);
    }
    res.writeHead(200, {
      "Content-Type": dataContentType(dataFile),
      "Content-Length": size,
    });
    createReadStream(realFile).pipe(res);
    return true;
  }

  return false;
}
