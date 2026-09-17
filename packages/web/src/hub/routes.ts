/**
 * `/api/hub/*` — the hub's own API, distinct from any project server's.
 *
 *   GET    /api/hub/health          — hub liveness: pid, port, uptime, project count
 *   GET    /api/hub/projects        — registered projects with live child status
 *   POST   /api/hub/projects        — register { id, repoRoot, ndxBin, worktree?, name? } and start its server
 *   DELETE /api/hub/projects/:id    — stop the server and forget the project
 *   DELETE /api/hub/projects/:id/worktrees/:path
 *                                   — unregister one worktree; the last one
 *                                     takes the project (and, with keepAlive
 *                                     off, the hub) with it
 *
 * Deliberately framework-free and self-contained: the hub must not import
 * from `src/server/`, so the two JSON helpers are local rather than shared
 * with response-utils.ts.
 *
 * @module web/hub/routes
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { Hub, RegisterProjectInput } from "./hub.js";

const HUB_PREFIX = "/api/hub";
const MAX_BODY_BYTES = 64 * 1024;
/** Ids appear in paths (`/p/:id/`) and file names; keep them to a safe alphabet. */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Run `fn` once the response is off to the client.
 *
 * The hub closes itself when its last project unregisters, and that close
 * destroys open sockets — including the one still carrying the answer that
 * said so. Waiting for `finish` means the caller reads its response and only
 * then finds the port gone.
 */
function afterResponse(res: ServerResponse, fn: () => void): void {
  if (res.writableFinished) setImmediate(fn);
  else res.once("finish", fn);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
}

function error(res: ServerResponse, status: number, message: string): void {
  json(res, status, { error: message });
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error(`request body exceeds ${MAX_BODY_BYTES} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf-8");
      if (!text.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error("request body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Validate a registration body. Returns the input or the first problem. */
export function parseRegisterInput(body: unknown): { input: RegisterProjectInput } | { problem: string } {
  if (!body || typeof body !== "object") return { problem: "body must be a JSON object" };
  const b = body as Record<string, unknown>;

  if (typeof b.id !== "string" || !ID_PATTERN.test(b.id)) {
    return { problem: "id must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" };
  }
  if (typeof b.repoRoot !== "string" || !isAbsolute(b.repoRoot)) {
    return { problem: "repoRoot must be an absolute path" };
  }
  if (!isDirectory(b.repoRoot)) return { problem: `repoRoot is not a directory: ${b.repoRoot}` };
  if (typeof b.ndxBin !== "string" || !isAbsolute(b.ndxBin)) {
    return { problem: "ndxBin must be an absolute path" };
  }
  if (!existsSync(b.ndxBin)) return { problem: `ndxBin does not exist: ${b.ndxBin}` };
  if (b.worktree !== undefined) {
    if (typeof b.worktree !== "string" || !isAbsolute(b.worktree)) {
      return { problem: "worktree must be an absolute path" };
    }
    if (!isDirectory(b.worktree)) return { problem: `worktree is not a directory: ${b.worktree}` };
  }
  if (b.name !== undefined && (typeof b.name !== "string" || !b.name.trim())) {
    return { problem: "name must be a non-empty string" };
  }

  return {
    input: {
      id: b.id,
      repoRoot: b.repoRoot,
      ndxBin: b.ndxBin,
      worktree: typeof b.worktree === "string" ? b.worktree : undefined,
      name: typeof b.name === "string" ? b.name.trim() : undefined,
    },
  };
}

/** Handle a `/api/hub/*` request. Returns false when the path is not the hub's. */
export async function handleHubRoute(req: IncomingMessage, res: ServerResponse, hub: Hub): Promise<boolean> {
  const url = (req.url || "/").split("?")[0];
  if (url !== HUB_PREFIX && !url.startsWith(`${HUB_PREFIX}/`)) return false;
  const path = url.slice(HUB_PREFIX.length);
  const method = req.method || "GET";

  if (path === "/health" && method === "GET") {
    json(res, 200, {
      ok: true,
      pid: process.pid,
      port: hub.listeningPort,
      startedAt: hub.startedAt,
      registryPath: hub.registryPath,
      projects: hub.listProjects().length,
    });
    return true;
  }

  if (path === "/projects" && method === "GET") {
    json(res, 200, { projects: hub.listProjects() });
    return true;
  }

  if (path === "/projects" && method === "POST") {
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      error(res, 400, (err as Error).message);
      return true;
    }
    const parsed = parseRegisterInput(body);
    if ("problem" in parsed) {
      error(res, 400, parsed.problem);
      return true;
    }
    const { created, project } = await hub.registerProject(parsed.input);
    json(res, created ? 201 : 200, { project });
    return true;
  }

  const projectMatch = path.match(/^\/projects\/([^/]+)$/);
  if (projectMatch) {
    const id = decodeURIComponent(projectMatch[1]);
    if (method === "GET") {
      const project = hub.getProject(id);
      if (!project) {
        error(res, 404, `No project registered as "${id}"`);
        return true;
      }
      json(res, 200, { project });
      return true;
    }
    if (method === "DELETE") {
      const removed = await hub.removeProject(id);
      if (!removed) {
        error(res, 404, `No project registered as "${id}"`);
        return true;
      }
      json(res, 200, { removed: id, hubExiting: hub.projectCount === 0 && !hub.keepAlive });
      afterResponse(res, () => hub.exitIfEmpty());
      return true;
    }
  }

  // DELETE /projects/:id/worktrees/:encodedPath — `ndx start stop` in one
  // worktree. The project stays up while other worktrees are registered.
  const worktreeMatch = path.match(/^\/projects\/([^/]+)\/worktrees\/([^/]+)$/);
  if (worktreeMatch && method === "DELETE") {
    let id: string;
    let worktree: string;
    try {
      id = decodeURIComponent(worktreeMatch[1]);
      worktree = decodeURIComponent(worktreeMatch[2]);
    } catch {
      error(res, 400, "Malformed project id or worktree path");
      return true;
    }
    const result = await hub.removeWorktree(id, worktree);
    if (!result.projectKnown) {
      error(res, 404, `No project registered as "${id}"`);
      return true;
    }
    json(res, 200, {
      project: result.project,
      projectId: id,
      worktree,
      worktreeKnown: result.worktreeKnown,
      projectRemoved: result.projectRemoved,
      remaining: result.remaining,
      hubExiting: result.hubExiting,
    });
    if (result.hubExiting) afterResponse(res, () => hub.exitIfEmpty());
    return true;
  }

  error(res, 405, `${method} ${url} is not supported`);
  return true;
}
