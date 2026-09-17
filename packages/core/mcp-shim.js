/**
 * `ndx mcp <server> [dir]` — one MCP command that works whether or not the hub
 * is running.
 *
 * An editor launches an MCP server as a child process speaking JSON-RPC over
 * stdio, and it launches it once, from a fixed command line in `.mcp.json`.
 * That command cannot know whether a hub happens to be up, which repository
 * the checkout belongs to, or which worktree the editor was opened in. So it
 * asks this shim, which decides per launch:
 *
 * - **Hub alive and this repository registered** → bridge. Frames read from
 *   stdin are POSTed to `/p/<id>/mcp/<server>` with `X-Ndx-Workspace` naming
 *   the worktree, and the responses are written back to stdout. One server
 *   process per repository serves every editor, every worktree and the
 *   dashboard, and a tool call lands in the tree the editor is actually open
 *   on rather than whichever checkout the command happened to start in.
 * - **Anything else** → spawn the sub-package's own stdio server, exactly as
 *   `ndx rex mcp .` does today. No hub, an unregistered repository, a hub
 *   that stops answering mid-session: all the same answer, which is the one
 *   that has always worked.
 *
 * The fallback is not a degraded mode to apologise for. It is the default
 * every project starts in, and the bridge is what a running hub upgrades it
 * to.
 *
 * Everything diagnostic goes to stderr. stdout is the protocol: one stray
 * line on it and the editor's parser is out of sync for the rest of the
 * session.
 *
 * @module n-dx/mcp-shim
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { getMcpServers } from "./assistant-assets.js";
import { hubHome, hubRequest, isHubMarker, loadHubPort, readHubRegistry, readPidFile, resolveRepo } from "./web.js";

/** How long a single JSON-RPC round trip may take before it is abandoned. */
const REQUEST_TIMEOUT_MS = 120_000;
/** The health probe is a liveness check, not a request — it must not stall a launch. */
const HEALTH_TIMEOUT_MS = 1_500;

/** Diagnostics go to stderr; stdout belongs to the protocol. */
function logStderr(message) {
  process.stderr.write(`[ndx mcp] ${message}\n`);
}

/**
 * Parse a Streamable HTTP response body into the JSON-RPC messages it carries.
 *
 * The transport answers either `application/json` with one message, or
 * `text/event-stream` with one or more. Every message is forwarded: taking
 * only the last would drop a progress notification that arrived alongside a
 * result, which the client is entitled to see.
 *
 * @param {string} contentType
 * @param {string} body
 * @returns {object[]}
 */
export function parseTransportBody(contentType, body) {
  if (!body.trim()) return [];

  if (contentType.includes("text/event-stream")) {
    const messages = [];
    for (const line of body.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice("data:".length).trim();
      if (!payload) continue;
      try {
        messages.push(JSON.parse(payload));
      } catch {
        // A frame we cannot parse is not one we can forward; saying so on
        // stderr beats writing something the client's parser will choke on.
        logStderr(`dropped an unparseable SSE frame: ${payload.slice(0, 120)}`);
      }
    }
    return messages;
  }

  try {
    return [JSON.parse(body)];
  } catch {
    logStderr(`dropped an unparseable response body: ${body.slice(0, 120)}`);
    return [];
  }
}

/** A JSON-RPC message with no `id` expects no response. */
export function isNotification(message) {
  return message !== null && typeof message === "object" && message.id === undefined;
}

/**
 * The project the hub has registered for this repository, or null.
 *
 * Matched on `repoRoot` rather than by re-deriving the id: the id is the
 * hub's to choose (two clones named "app" get different ones), and guessing
 * it again here is how the shim would address the wrong project.
 *
 * @param {Record<string, {id?: string, repoRoot?: string}>} projects
 * @param {string} repoRoot
 * @returns {string|null}
 */
export function findRegisteredProject(projects, repoRoot) {
  for (const [id, record] of Object.entries(projects ?? {})) {
    if (record?.repoRoot === repoRoot) return record.id ?? id;
  }
  return null;
}

/**
 * Bridge stdio frames to a hub endpoint until `input` ends.
 *
 * Messages are handled one at a time. Ordering is not a protocol requirement
 * — responses carry their request's id — but `initialize` has to complete
 * before anything else is sent, and a serial pipeline gets that for free
 * without a special case that could be got wrong.
 *
 * @param {object} options
 * @param {string} options.url        `http://127.0.0.1:<port>/p/<id>/mcp/<server>`
 * @param {string|null} options.workspace  Worktree key for `X-Ndx-Workspace`.
 * @param {NodeJS.ReadableStream} options.input
 * @param {NodeJS.WritableStream} options.output
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.timeoutMs]
 * @param {(message: string) => void} [options.log]
 * @returns {Promise<void>} Resolves once input ends and the session is closed.
 */
export async function bridgeStdio(options) {
  const {
    url,
    workspace,
    input,
    output,
    fetchImpl = fetch,
    timeoutMs = REQUEST_TIMEOUT_MS,
    log = logStderr,
  } = options;

  let sessionId = null;
  let closed = false;

  const headers = () => {
    const base = {
      "Content-Type": "application/json",
      // Both, because the transport picks per response and either is valid.
      Accept: "application/json, text/event-stream",
    };
    if (sessionId) base["Mcp-Session-Id"] = sessionId;
    if (workspace) base["X-Ndx-Workspace"] = workspace;
    return base;
  };

  /** POST one frame, retrying once: a hub restart mid-session is a dropped socket, not an error to surface. */
  async function post(message) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await fetchImpl(url, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify(message),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        lastError = err;
        if (attempt === 0) log(`request failed (${err.message}) — retrying once`);
      }
    }
    throw lastError;
  }

  function write(message) {
    output.write(`${JSON.stringify(message)}\n`);
  }

  /**
   * Answer a request the hub could not be asked about.
   *
   * A client that gets nothing back waits forever; a JSON-RPC error it can
   * report is the difference between a visibly broken tool and a hung editor.
   * Notifications get nothing, because nothing is what they expect.
   */
  function writeTransportError(message, err) {
    if (isNotification(message)) return;
    write({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32603, message: `n-dx hub bridge: ${err.message}` },
    });
  }

  async function handle(message) {
    let res;
    try {
      res = await post(message);
    } catch (err) {
      log(`giving up on ${message.method ?? "message"}: ${err.message}`);
      writeTransportError(message, err);
      return;
    }

    // The session id arrives on the initialize response and is used from then on.
    const assigned = res.headers.get("mcp-session-id");
    if (assigned && assigned !== sessionId) sessionId = assigned;

    // 202 with no body is how the transport acknowledges a notification.
    const body = await res.text();
    if (!res.ok) {
      log(`hub answered ${res.status} for ${message.method ?? "message"}`);
      writeTransportError(message, new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`));
      return;
    }

    for (const out of parseTransportBody(res.headers.get("content-type") ?? "", body)) {
      write(out);
    }
  }

  /** Tell the hub the session is over, so the server can release it. */
  async function closeSession() {
    if (closed || !sessionId) return;
    closed = true;
    try {
      await fetchImpl(url, {
        method: "DELETE",
        headers: headers(),
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
    } catch {
      // The hub reaps idle sessions anyway; a failed goodbye is not worth a line.
    }
  }

  const lines = createInterface({ input, crlfDelay: Infinity });

  // Serial: each frame is awaited before the next is read, so `initialize`
  // has established the session before anything that needs it is sent.
  let chain = Promise.resolve();
  lines.on("line", (line) => {
    const text = line.trim();
    if (!text) return;
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      log(`ignored a line that is not JSON: ${text.slice(0, 120)}`);
      return;
    }
    chain = chain.then(() => handle(message)).catch((err) => log(`handler failed: ${err.message}`));
  });

  await new Promise((resolve) => {
    lines.on("close", resolve);
    input.on("error", resolve);
  });
  await chain;
  await closeSession();
}

/**
 * Run the sub-package's own stdio MCP server in this process's place.
 *
 * `stdio: "inherit"` rather than piping: the child then owns the same stdin
 * and stdout the editor opened, so the shim adds no framing, no buffering and
 * nothing that can get out of step.
 *
 * @returns {Promise<number>} the child's exit code
 */
function runInProcessServer(entry, dir, { spawnImpl = spawn } = {}) {
  return new Promise((resolve) => {
    const child = spawnImpl(process.execPath, [entry, "mcp", dir], { stdio: "inherit" });
    child.on("error", (err) => {
      logStderr(`could not start the ${entry} MCP server: ${err.message}`);
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 0));
  });
}

/**
 * Decide how this launch should serve MCP, and do it.
 *
 * @param {string} server  Server name from the manifest ("rex", "sourcevision").
 * @param {string} dir     Directory the editor launched in.
 * @param {object} deps
 * @param {Record<string, string>} deps.tools  Sub-package CLI entry paths, by name.
 * @returns {Promise<number>} exit code
 */
export async function runMcpShim(server, dir, { tools = {}, spawnImpl } = {}) {
  const descriptors = getMcpServers();
  const descriptor = descriptors[server];
  if (!descriptor) {
    process.stderr.write(`Unknown MCP server: ${server}\nAvailable: ${Object.keys(descriptors).join(", ")}\n`);
    return 1;
  }

  const entry = tools[descriptor.cliCommand] ?? tools[server];
  const target = await resolveHubTarget(server, dir);

  if (!target) {
    if (!entry) {
      process.stderr.write(`No CLI entry for the ${server} MCP server.\n`);
      return 1;
    }
    return runInProcessServer(entry, dir, { spawnImpl });
  }

  logStderr(`bridging to ${target.url}${target.workspace ? ` (workspace ${target.workspace})` : ""}`);
  await bridgeStdio({
    url: target.url,
    workspace: target.workspace,
    input: process.stdin,
    output: process.stdout,
  });
  return 0;
}

/**
 * The hub port and project id `ndx start` recorded in a directory, or null.
 *
 * `runHubMode` writes `.n-dx-web.pid` with `via: "hub"` in the directory it
 * registered, naming the hub's port and the id it was registered under. That
 * is the only place either is written down: a hub started with `--port=N`
 * leaves nothing in `~/.n-dx/config.json`, so a shim that read only the
 * config would look on 3117, find nothing, and quietly serve in-process
 * while a perfectly good hub ran on another port.
 *
 * @returns {Promise<{port: number, projectId: string}|null>}
 */
async function readHubMarker(dir) {
  const info = await readPidFile(dir);
  if (!info || !isHubMarker(info)) return null;
  if (!Number.isInteger(info.port) || !info.projectId) return null;
  return { port: info.port, projectId: info.projectId };
}

/**
 * Where to bridge to, or null when this launch should serve MCP itself.
 *
 * Null for every reason equally: no hub answering, this repository not
 * registered with the one that is, or not a repository at all. The shim does
 * not register a project on the editor's behalf — starting a dashboard server
 * is a thing an operator asks for with `ndx start`, not a side effect of
 * opening a file.
 *
 * Two ways to find the hub, in order of how much they know:
 *
 * 1. The marker `ndx start` left in this worktree (or the repository root),
 *    which names both the port and the project id.
 * 2. `~/.n-dx/config.json` plus a registry lookup by repository root, for a
 *    worktree that was never registered from itself.
 *
 * @returns {Promise<{url: string, workspace: string|null}|null>}
 */
export async function resolveHubTarget(server, dir) {
  const repo = resolveRepo(dir);
  if (!repo.isRepo) return null;

  const home = hubHome();
  const marker = (await readHubMarker(repo.worktree)) ?? (await readHubMarker(repo.repoRoot));
  const port = marker?.port ?? (await loadHubPort(home));

  const health = await hubRequest(port, "GET", "/api/hub/health", undefined, HEALTH_TIMEOUT_MS);
  if (health.status !== 200 || health.body?.ok !== true) {
    if (marker) logStderr(`no hub answering on port ${port} — serving MCP in-process`);
    return null;
  }

  const id = marker?.projectId ?? findRegisteredProject(await readHubRegistry(home), repo.repoRoot);
  if (!id) {
    logStderr(`hub is running but ${repo.repoRoot} is not registered — serving MCP in-process (run 'ndx start' to register it)`);
    return null;
  }

  // A worktree that is the repository root addresses the anchor, which the
  // project server resolves without a header.
  const workspace = repo.worktree === repo.repoRoot ? null : basenameOf(repo.worktree);
  return {
    url: `http://127.0.0.1:${port}/p/${encodeURIComponent(id)}/mcp/${encodeURIComponent(server)}`,
    workspace,
  };
}

/** Last path segment, for either separator — the workspace key the server assigns. */
function basenameOf(path) {
  const trimmed = path.replace(/[/\\]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return cut === -1 ? trimmed : trimmed.slice(cut + 1);
}
