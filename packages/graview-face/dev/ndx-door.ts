/**
 * THE DEV-SERVER DOOR TO n-dx. The face runs in a browser; rex runs behind
 * the n-dx hub with a per-user token. This Vite plugin is the only thing
 * that holds that token: it proxies one MCP session to the hub's rex
 * endpoint, re-emits the projection on request, and serves the fresh files
 * straight from the project's graview dir. A production build has no door,
 * so a static face is read-only by construction.
 *
 * What the door lets through is as narrow as the sync needs: the four rex
 * tools the RemoteSystem calls, JSON bodies only, and only from this
 * server's own pages (a request another origin fires carries an Origin or
 * Sec-Fetch-Site that is not ours and is refused before it reaches rex).
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
import { spawn } from "node:child_process";
import { createReadStream, existsSync, readFileSync, realpathSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { Plugin } from "vite";

const PKG = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as { name: string; version: string };

/** The rex tools the sync loop uses (src/sync/ndx-system.ts); nothing else passes the door. */
export const ALLOWED_TOOLS: ReadonlySet<string> = new Set(["get_item", "update_task_status", "edit_item", "append_log"]);

interface McpResponse {
  result?: { content?: { type: string; text?: string }[]; isError?: boolean };
  error?: { message?: string };
}

/** Our own pages only: no Origin/Sec-Fetch-Site header (same-origin fetch, curl), or ones that name this server. */
export function isOwnRequest(headers: Record<string, string | string[] | undefined>, host: string | undefined): boolean {
  const site = headers["sec-fetch-site"];
  if (typeof site === "string" && site !== "same-origin" && site !== "none") return false;
  const origin = headers["origin"];
  if (typeof origin !== "string") return true;
  try {
    return host !== undefined && new URL(origin).host === host;
  } catch {
    return false;
  }
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

  let session: string | undefined;
  let sessionOpening: Promise<string> | undefined;
  let workspaceKey: string | undefined;

  const token = () => (tokenFile && existsSync(tokenFile) ? readFileSync(tokenFile, "utf-8").trim() : undefined);
  const headers = (extra: Record<string, string> = {}) => ({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...(token() ? { "x-ndx-token": token()! } : {}),
    ...(workspaceKey ? { "x-ndx-workspace": workspaceKey } : {}),
    ...extra,
  });

  /** A JSON-RPC body, from a JSON response or the last `data:` line of an event stream. */
  const readRpc = async (response: Response): Promise<McpResponse> => {
    const text = await response.text();
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      const data = text
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter(Boolean);
      return data.length ? (JSON.parse(data[data.length - 1]!) as McpResponse) : {};
    }
    return text ? (JSON.parse(text) as McpResponse) : {};
  };

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
    const response = await fetch(workspacesUrl, { headers: headers() });
    if (!response.ok) throw new Error(`workspaces: ${response.status}`);
    const { workspaces } = (await response.json()) as { workspaces?: { key: string; path: string }[] };
    const mine = workspaces?.find((w) => real(w.path) === real(worktree));
    if (!mine) throw new Error(`the hub does not list this worktree (${worktree}) as a workspace; sync is off rather than writing the main checkout`);
    workspaceKey = mine.key;
  };

  const openSession = async (): Promise<string> => {
    if (!rexUrl) throw new Error("NDX_REX_MCP_URL is not set");
    await resolveWorkspace();
    const init = await fetch(rexUrl, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: PKG.name, version: PKG.version } } }),
    });
    if (!init.ok) throw new Error(`rex: initialize answered ${init.status}`);
    const id = init.headers.get("mcp-session-id");
    if (!id) throw new Error("rex: no Mcp-Session-Id on initialize");
    await init.text();
    await fetch(rexUrl, { method: "POST", headers: headers({ "mcp-session-id": id }), body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
    return id;
  };

  const call = async (name: string, args: Record<string, unknown>, retry = true): Promise<unknown> => {
    session ??= await (sessionOpening ??= openSession().finally(() => (sessionOpening = undefined)));
    const response = await fetch(rexUrl!, {
      method: "POST",
      headers: headers({ "mcp-session-id": session }),
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args } }),
    });
    if ((response.status === 404 || response.status === 400) && retry) {
      // The hub or its child restarted and forgot the session: open another, once.
      session = undefined;
      await response.text();
      return call(name, args, false);
    }
    const body = await readRpc(response);
    if (body.error) throw new Error(body.error.message ?? "rex refused");
    const text = body.result?.content?.find((c) => c.type === "text")?.text ?? "";
    if (body.result?.isError) throw new Error(text || `rex: ${name} failed`);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  };

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
  const readBody = (req: IncomingMessage): Promise<string> =>
    new Promise((resolve) => {
      let text = "";
      req.on("data", (c) => (text += String(c)));
      req.on("end", () => resolve(text));
    });
  /** A write route takes JSON from our own pages and nothing else; the answer says why when it refuses. */
  const admit = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (!isOwnRequest(req.headers, req.headers.host)) {
      json(res, 403, { ok: false, error: "refused: not from this face's own origin" });
      return false;
    }
    if (!(req.headers["content-type"] ?? "").includes("application/json")) {
      json(res, 415, { ok: false, error: "refused: send application/json" });
      return false;
    }
    return true;
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
            res.setHeader("content-type", "application/json");
            res.setHeader("cache-control", "no-store");
            createReadStream(file).pipe(res);
            return;
          }
          if (url === "/ndx/sync-info") {
            return json(res, 200, { rex: Boolean(rexUrl), emit: Boolean(graviewCli && projectRoot), project: projectRoot ?? null, live: Boolean(graviewDir), worktree: Boolean(worktree) });
          }
          if (url === "/ndx/emit" && req.method === "POST") {
            if (!admit(req, res)) return;
            return json(res, 200, await emit());
          }
          if (url === "/ndx/mcp" && req.method === "POST") {
            if (!admit(req, res)) return;
            const { name, arguments: args } = JSON.parse((await readBody(req)) || "{}") as { name?: string; arguments?: Record<string, unknown> };
            if (!name) return json(res, 400, { ok: false, error: "name required" });
            if (!ALLOWED_TOOLS.has(name)) return json(res, 403, { ok: false, error: `refused: ${name} is not a tool this face uses (${[...ALLOWED_TOOLS].join(", ")})` });
            if (!rexUrl) return json(res, 503, { ok: false, error: "sync is off: no rex endpoint (run ndx start . and ndx graview serve .)" });
            try {
              return json(res, 200, { ok: true, result: await call(name, args ?? {}) });
            } catch (error) {
              return json(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) });
            }
          }
        } catch (error) {
          return json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
        next();
      });
    },
  };
}
