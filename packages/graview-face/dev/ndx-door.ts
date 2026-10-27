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
 * Every write route answers only this server's own pages: `sameOrigin` (no
 * foreign Origin or Sec-Fetch-Site, and a Host that is this machine), and
 * the key this launch writes into the page (`<meta name="ndx-door">`) sent
 * back as `x-ndx-door`. Same-origin alone admits a request with no browser
 * headers at all, which any process on the host can send; the hub's token
 * exists because loopback is shared by every account on a host, so the door
 * must not hand its four write tools to whoever asks.
 *
 * A re-emit runs only when something the projection reads has changed since
 * the last one (`projectStamp`): the loop asks every 30 s and after each
 * edit, and a full emit reads the whole PRD and git.
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
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
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

/** The header a page sends the door's key in, and the meta tag the key is written to. */
export const DOOR_KEY_HEADER = "x-ndx-door";
export const DOOR_KEY_META = "ndx-door";

/** What the projection reads, under either layout, relative to the project. */
const READS = [".rex", ".ndx/rex", ".hench/runs", ".ndx/hench/runs", ".sourcevision", ".ndx/sourcevision", ".n-dx.json", ".n-dx.local.json", ".ndx/config.json"];

/**
 * A stamp of everything a projection reads: the newest modification time and
 * the number of entries under the PRD, the runs and the analysis (so an edit,
 * an addition and a removal all move it), and every ref git has (a commit, a
 * tag, a fetch). Equal stamps mean an emit would write the same files.
 */
export function projectStamp(root: string): string {
  let newest = 0;
  let entries = 0;
  const walk = (path: string): void => {
    let stat;
    try {
      stat = statSync(path);
    } catch {
      return;
    }
    entries += 1;
    newest = Math.max(newest, stat.mtimeMs);
    if (!stat.isDirectory()) return;
    for (const name of readdirSync(path)) if (name !== ".cache") walk(join(path, name));
  };
  for (const rel of READS) walk(join(root, rel));
  let refs = "";
  try {
    refs = execFileSync("git", ["for-each-ref", "--format=%(objectname) %(refname)"], { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 });
    refs += execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 });
  } catch {
    // Not a repository: the files alone decide.
  }
  return `${newest}:${entries}:${refs}`;
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
  const key = randomBytes(24).toString("hex");
  const keyed = (req: IncomingMessage) => req.headers[DOOR_KEY_HEADER] === key;

  // One re-emit at a time: the loop, "Sync now" and a second tab all ask, and every asker gets the run in flight.
  let emitting: Promise<{ ok: boolean; output: string }> | undefined;
  // The stamp of the last emit that succeeded: an ask with nothing new answers from the files already written.
  let emitted: string | undefined;
  const emit = (): Promise<{ ok: boolean; output: string }> =>
    (emitting ??= new Promise<{ ok: boolean; output: string }>((resolve) => {
      if (!graviewCli || !projectRoot) return resolve({ ok: false, output: "no NDX_GRAVIEW_CLI / NDX_PROJECT_ROOT" });
      const stamp = projectStamp(projectRoot);
      if (stamp === emitted) return resolve({ ok: true, output: "" });
      const child = spawn(process.execPath, [graviewCli, "emit", projectRoot, "--quiet"], { stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (c) => (output += String(c)));
      child.stderr.on("data", (c) => (output += String(c)));
      child.on("exit", (code) => {
        emitted = code === 0 ? stamp : undefined;
        resolve({ ok: code === 0, output });
      });
      child.on("error", (error) => resolve({ ok: false, output: String(error) }));
    }).finally(() => (emitting = undefined)));

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
  };
  /** The re-emit takes JSON from our own pages and nothing else, as the door does; the answer says why when it refuses. */
  const admit = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (!sameOrigin(req.headers) || !keyed(req)) {
      json(res, 403, { ok: false, error: "refused: not from this face's own pages" });
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
    // The key reaches the page in its HTML, which only a reader of this origin sees.
    transformIndexHtml: () => [{ tag: "meta", attrs: { name: DOOR_KEY_META, content: key }, injectTo: "head" }],
    configureServer(server) {
      // The door's routes sit under Vite's base: `/` at the root, `/x/<name>/` under the hub.
      const base = server.config.base;
      server.middlewares.use(async (req, res, next) => {
        const asked = (req.url ?? "").split("?")[0] ?? "";
        const url = asked.startsWith(base) ? asked.slice(base.length - 1) : asked;
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
          if (url === "/ndx/mcp") {
            if (!keyed(req)) return json(res, 403, { ok: false, error: "refused: not from this face's own pages" });
            return door(req, res, next);
          }
        } catch (error) {
          return json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
        next();
      });
    },
  };
}
