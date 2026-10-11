/**
 * THE DEV-SERVER DOOR TO n-dx. The face runs in a browser; rex runs behind
 * the n-dx hub with a per-user token. This Vite plugin is the only thing
 * that holds that token: Graview's `mcpDoor` over an `mcpClient` to the hub's
 * rex endpoint (one session, a JSON or event-stream answer, one retry when
 * the hub forgot the session, only the four tools the sync calls), a re-emit
 * on request, and the fresh projection served straight from the project's
 * graview dir, by byte range when asked, so the loop reads two kinds of a
 * 3 MB snapshot. A production build has no door, so a static face is
 * read-only by construction.
 *
 * Every write route answers only this server's own pages (`sameOrigin`: no
 * foreign Origin or Sec-Fetch-Site, and a Host that is this machine).
 *
 * Environment (what `ndx graview serve .` sets):
 *   NDX_GRAVIEW_DIR    the project's graview dir: document.json and snapshot.json
 *   NDX_PROJECT_ROOT   the n-dx project; with NDX_GRAVIEW_CLI, what `POST /ndx/emit` re-emits
 *   NDX_GRAVIEW_CLI    @n-dx/graview's cli entry, run under this Node
 *   NDX_REX_MCP_URL    the hub's rex MCP endpoint; without it, sync is off
 *   NDX_TOKEN_FILE     the per-user auth token file; read per request, never sent to the browser
 *   NDX_WORKTREE       set when the project is a worktree: its root. The project's server writes the
 *   NDX_WORKSPACES_URL workspace a request names (X-Ndx-Workspace), so the door resolves this
 *                      worktree's key from the listing at NDX_WORKSPACES_URL before any write, and
 *                      keeps sync off rather than write the main checkout's PRD when it cannot.
 */
import { mcpClient, mcpDoor, sameOrigin, type ToolCall } from "@graview/core/sync";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { Plugin } from "vite";

const PKG = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as { name: string; version: string };

/** The rex tools the sync loop uses (src/sync/ndx-system.ts); nothing else passes the door. */
export const ALLOWED_TOOLS: ReadonlySet<string> = new Set(["get_item", "update_task_status", "edit_item", "append_log"]);

/** The one byte range a `Range` header asks for, within a file of `size` bytes; undefined for none, or one that cannot be served. */
export function rangeOf(header: string | undefined, size: number): { start: number; end: number } | undefined {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header ?? "");
  if (!m || (m[1] === "" && m[2] === "")) return undefined;
  const start = m[1] === "" ? Math.max(0, size - Number(m[2])) : Number(m[1]);
  const end = m[1] === "" ? size - 1 : m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return undefined;
  return { start, end };
}

export function ndxDoor(): Plugin {
  const env = process.env;
  const graviewDir = env["NDX_GRAVIEW_DIR"];
  const rexUrl = env["NDX_REX_MCP_URL"];
  const tokenFile = env["NDX_TOKEN_FILE"];
  const projectRoot = env["NDX_PROJECT_ROOT"];
  const graviewCli = env["NDX_GRAVIEW_CLI"];
  const worktree = env["NDX_WORKTREE"];
  const workspacesUrl = env["NDX_WORKSPACES_URL"];

  let workspaceKey: string | undefined;
  const token = () => (tokenFile && existsSync(tokenFile) ? readFileSync(tokenFile, "utf-8").trim() : undefined);
  const real = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };

  /** A worktree's workspace key, from the project server's listing; the anchor needs none. */
  const resolveWorkspace = async (): Promise<void> => {
    if (!worktree || workspaceKey) return;
    if (!workspacesUrl) throw new Error("this is a worktree but no workspace listing was given; sync is off");
    const response = await fetch(workspacesUrl, { headers: { accept: "application/json", ...(token() ? { "x-ndx-token": token()! } : {}) } });
    if (!response.ok) throw new Error(`workspaces: ${response.status}`);
    const { workspaces } = (await response.json()) as { workspaces?: { key: string; path: string }[] };
    const mine = workspaces?.find((w) => real(w.path) === real(worktree));
    if (!mine) throw new Error(`the hub does not list this worktree (${worktree}) as a workspace; sync is off rather than writing the main checkout`);
    workspaceKey = mine.key;
  };

  /** The token and the workspace, read when a call is made and never handed to the page. */
  const headers = async (): Promise<Record<string, string>> => {
    await resolveWorkspace();
    return { ...(token() ? { "x-ndx-token": token()! } : {}), ...(workspaceKey ? { "x-ndx-workspace": workspaceKey } : {}) };
  };

  const rex: ToolCall = rexUrl
    ? mcpClient({ url: rexUrl, allow: ALLOWED_TOOLS, headers, clientInfo: { name: PKG.name, version: PKG.version } })
    : async () => {
        throw new Error("sync is off: no rex endpoint (run ndx start . and ndx graview serve .)");
      };
  const door = mcpDoor({ path: "/ndx/mcp", call: rex, allow: ALLOWED_TOOLS });

  // One re-emit at a time: the loop, "Sync now" and a second tab all ask, and every asker gets the run in flight.
  let emitting: Promise<{ ok: boolean; output: string }> | undefined;
  const emit = (): Promise<{ ok: boolean; output: string }> =>
    (emitting ??= new Promise<{ ok: boolean; output: string }>((resolve) => {
      if (!graviewCli || !projectRoot) return resolve({ ok: false, output: "no NDX_GRAVIEW_CLI / NDX_PROJECT_ROOT" });
      const child = spawn(process.execPath, [graviewCli, "emit", projectRoot, "--quiet"], { stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (c) => (output += String(c)));
      child.stderr.on("data", (c) => (output += String(c)));
      child.on("exit", (code) => resolve({ ok: code === 0, output }));
      child.on("error", (error) => resolve({ ok: false, output: String(error) }));
    }).finally(() => (emitting = undefined)));

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
  };
  /** The re-emit takes JSON from our own pages and nothing else, as the door does; the answer says why when it refuses. */
  const admit = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (!sameOrigin(req.headers)) {
      json(res, 403, { ok: false, error: "refused: not from this face's own origin" });
      return false;
    }
    if ((req.headers["content-type"] ?? "").split(";")[0]!.trim() !== "application/json") {
      json(res, 415, { ok: false, error: "refused: send application/json" });
      return false;
    }
    return true;
  };
  /** The fresh projection, whole or by the byte range the snapshot reader asks for. */
  const serveData = (req: IncomingMessage, res: ServerResponse, file: string): void => {
    const size = statSync(file).size;
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    res.setHeader("accept-ranges", "bytes");
    const range = rangeOf(typeof req.headers.range === "string" ? req.headers.range : undefined, size);
    if (range) {
      res.statusCode = 206;
      res.setHeader("content-range", `bytes ${range.start}-${range.end}/${size}`);
      res.setHeader("content-length", String(range.end - range.start + 1));
      createReadStream(file, range).pipe(res);
      return;
    }
    res.setHeader("content-length", String(size));
    createReadStream(file).pipe(res);
  };

  return {
    name: "ndx-door",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url ?? "").split("?")[0] ?? "";
        try {
          if (graviewDir && (url === "/data/document.json" || url === "/data/snapshot.json")) {
            const file = join(graviewDir, url.slice("/data/".length));
            if (!existsSync(file)) return next();
            return serveData(req, res, file);
          }
          if (url === "/ndx/sync-info") {
            return json(res, 200, { rex: Boolean(rexUrl), emit: Boolean(graviewCli && projectRoot), project: projectRoot ?? null, live: Boolean(graviewDir), worktree: Boolean(worktree) });
          }
          if (url === "/ndx/emit" && req.method === "POST") {
            if (!admit(req, res)) return;
            return json(res, 200, await emit());
          }
          if (url === "/ndx/mcp") return door(req, res, next);
        } catch (error) {
          return json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
        next();
      });
    },
  };
}
