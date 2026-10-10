/**
 * THE DEV-SERVER DOOR TO n-dx. The face runs in a browser; rex runs behind
 * the n-dx hub with a per-user token. This Vite plugin is the only thing
 * that holds that token: it proxies one MCP session to the hub's rex
 * endpoint, re-emits the projection on request, and serves the fresh files
 * straight from the project's graview dir. A production build has no door,
 * so a static face is read-only by construction.
 *
 * Environment (what `ndx graview serve .` sets):
 *   NDX_GRAVIEW_DIR    the project's graview dir: document.json and snapshot.json
 *   NDX_PROJECT_ROOT   the n-dx project; with NDX_GRAVIEW_CLI, what `POST /ndx/emit` re-emits
 *   NDX_GRAVIEW_CLI    @n-dx/graview's cli entry, run under this Node
 *   NDX_REX_MCP_URL    the hub's rex MCP endpoint; without it, sync is off
 *   NDX_TOKEN_FILE     the per-user auth token file; read per request, never sent to the browser
 */
import { spawn } from "node:child_process";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { Plugin } from "vite";

interface McpResponse {
  result?: { content?: { type: string; text?: string }[]; isError?: boolean };
  error?: { message?: string };
}

export function ndxDoor(): Plugin {
  const env = process.env;
  const graviewDir = env["NDX_GRAVIEW_DIR"];
  const rexUrl = env["NDX_REX_MCP_URL"];
  const tokenFile = env["NDX_TOKEN_FILE"];
  const projectRoot = env["NDX_PROJECT_ROOT"];
  const graviewCli = env["NDX_GRAVIEW_CLI"];

  let session: string | undefined;
  let sessionOpening: Promise<string> | undefined;

  const token = () => (tokenFile && existsSync(tokenFile) ? readFileSync(tokenFile, "utf-8").trim() : undefined);
  const headers = (extra: Record<string, string> = {}) => ({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...(token() ? { "x-ndx-token": token()! } : {}),
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

  const openSession = async (): Promise<string> => {
    if (!rexUrl) throw new Error("NDX_REX_MCP_URL is not set");
    const init = await fetch(rexUrl, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "n-dx-graview", version: "0.1.0" } } }),
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

  const emit = (): Promise<{ ok: boolean; output: string }> =>
    new Promise((resolve) => {
      if (!graviewCli || !projectRoot) return resolve({ ok: false, output: "no NDX_GRAVIEW_CLI / NDX_PROJECT_ROOT" });
      const child = spawn(process.execPath, [graviewCli, "emit", projectRoot, "--quiet"], { stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (c) => (output += String(c)));
      child.stderr.on("data", (c) => (output += String(c)));
      child.on("exit", (code) => resolve({ ok: code === 0, output }));
      child.on("error", (error) => resolve({ ok: false, output: String(error) }));
    });

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

  return {
    name: "ndx-door",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? "";
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
            return json(res, 200, { rex: Boolean(rexUrl), emit: Boolean(graviewCli && projectRoot), project: projectRoot ?? null, live: Boolean(graviewDir) });
          }
          if (url === "/ndx/emit" && req.method === "POST") return json(res, 200, await emit());
          if (url === "/ndx/mcp" && req.method === "POST") {
            if (!rexUrl) return json(res, 503, { ok: false, error: "sync is off: no rex endpoint (run ndx start . and ndx graview serve .)" });
            const { name, arguments: args } = JSON.parse((await readBody(req)) || "{}") as { name?: string; arguments?: Record<string, unknown> };
            if (!name) return json(res, 400, { ok: false, error: "name required" });
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
