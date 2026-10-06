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
import { fileURLToPath } from "node:url";
import { getMcpServers } from "./assistant-assets.js";
import { hubHome, hubRequest, isHubMarker, loadHubPort, readAuthTokenFile, readHubRegistry, readPidFile, resolveRepo } from "./web.js";

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
 * The workspace key a client root names, or why it names none.
 *
 * A root in the target repository addresses that repository's worktree:
 * null for the anchor (the project server resolves it without a header),
 * otherwise the worktree's basename, which is the key the server assigns.
 *
 * @param {Array<{uri?: string}>|undefined} roots  `roots/list` result.
 * @param {string} repoRoot  The registered project's repository root.
 * @param {(dir: string) => {isRepo: boolean, repoRoot: string, worktree: string}} resolveRepoImpl
 * @returns {{workspace: string|null, root: string} | {skip: string}}
 */
export function workspaceFromRoots(roots, repoRoot, resolveRepoImpl = resolveRepo) {
  const fileRoot = (Array.isArray(roots) ? roots : [])
    .find((root) => typeof root?.uri === "string" && root.uri.startsWith("file:"));
  if (!fileRoot) return { skip: "the client listed no file: root" };

  let path;
  try {
    path = fileURLToPath(fileRoot.uri);
  } catch (err) {
    return { skip: `client root ${fileRoot.uri} is not a usable path (${err.message})` };
  }
  const repo = resolveRepoImpl(path);
  if (!repo.isRepo || repo.repoRoot !== repoRoot) {
    return { skip: `client root ${path} is outside ${repoRoot}` };
  }
  return { workspace: repo.worktree === repo.repoRoot ? null : basenameOf(repo.worktree), root: path };
}

/** Prefix of the ids the shim gives its own `roots/list` requests to the client. */
const ROOTS_REQUEST_PREFIX = "ndx-shim-roots-";
/** How long held frames wait for the client to answer `roots/list`. */
const ROOTS_TIMEOUT_MS = 2_000;

/**
 * Bridge stdio frames to a hub endpoint until `input` ends.
 *
 * Messages are handled one at a time. Ordering is not a protocol requirement
 * — responses carry their request's id — but `initialize` has to complete
 * before anything else is sent, and a serial pipeline gets that for free
 * without a special case that could be got wrong.
 *
 * **Following the client's roots.** The editor may launch this shim in a
 * different checkout from the one its session runs in (Claude desktop starts
 * project MCP servers in the main checkout for a worktree session, #499), so
 * the cwd-derived `workspace` can name the wrong tree. When `repoRoot` is
 * given and the client advertises `capabilities.roots`, the bridge asks it
 * `roots/list` after `notifications/initialized`, holding later frames until
 * the answer (or `rootsTimeoutMs`). The hub binds a session's workspace at
 * `initialize`, so a root naming another worktree of the same repository
 * re-opens the session there — the remembered `initialize` and `initialized`
 * are replayed with the new header and their responses swallowed — and the
 * first session is closed. The client sees one session throughout.
 * `notifications/roots/list_changed` repeats the exchange and is not
 * forwarded: a POST-only bridge gives the hub server no way to ask back.
 *
 * @param {object} options
 * @param {string} options.url        `http://127.0.0.1:<port>/p/<id>/mcp/<server>`
 * @param {string|null} options.workspace  Worktree key for `X-Ndx-Workspace`.
 * @param {string} [options.repoRoot] Registered project's repository root; enables following roots.
 * @param {NodeJS.ReadableStream} options.input
 * @param {NodeJS.WritableStream} options.output
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.rootsTimeoutMs]
 * @param {typeof resolveRepo} [options.resolveRepoImpl]
 * @param {(message: string) => void} [options.log]
 * @returns {Promise<void>} Resolves once input ends and the session is closed.
 */
export async function bridgeStdio(options) {
  const {
    url,
    repoRoot,
    input,
    output,
    fetchImpl = fetch,
    timeoutMs = REQUEST_TIMEOUT_MS,
    rootsTimeoutMs = ROOTS_TIMEOUT_MS,
    resolveRepoImpl = resolveRepo,
    log = logStderr,
  } = options;

  let workspace = options.workspace;
  let sessionId = null;
  let closed = false;

  /** The client's handshake, kept to re-open the session on another workspace. */
  let initializeFrame = null;
  let initializedFrame = null;
  let clientHasRoots = false;
  /** Outstanding shim-owned `roots/list` requests, by id. */
  const rootsWaiters = new Map();
  let rootsSeq = 0;

  const headers = (session = sessionId, ws = workspace) => {
    const base = {
      "Content-Type": "application/json",
      // Both, because the transport picks per response and either is valid.
      Accept: "application/json, text/event-stream",
    };
    if (session) base["Mcp-Session-Id"] = session;
    if (ws) base["X-Ndx-Workspace"] = ws;
    // The hub requires the per-user token when `ndx start` created one; the
    // shim runs as the same user, so it reads the same file.
    const token = readAuthTokenFile();
    if (token) base["X-Ndx-Token"] = token;
    return base;
  };

  /** POST one frame, retrying once: a hub restart mid-session is a dropped socket, not an error to surface. */
  async function post(message, requestHeaders = headers()) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await fetchImpl(url, {
          method: "POST",
          headers: requestHeaders,
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

  /** DELETE a hub session. The hub reaps idle sessions anyway, so a failed goodbye is not worth a line. */
  async function deleteSession(session, ws) {
    try {
      await fetchImpl(url, {
        method: "DELETE",
        headers: headers(session, ws),
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
    } catch {
      // See above: nothing to do about it, and the hub cleans up after us.
    }
  }

  /** Tell the hub the session is over, so the server can release it. */
  async function closeSession() {
    if (closed || !sessionId) return;
    closed = true;
    await deleteSession(sessionId, workspace);
  }

  /**
   * Ask the client for its roots; null when it does not answer in time.
   * The answer is matched in the line handler, never on the serial chain this
   * runs on — the chain is what is waiting.
   */
  function askClientRoots() {
    const id = `${ROOTS_REQUEST_PREFIX}${++rootsSeq}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        rootsWaiters.delete(id);
        resolve(null);
      }, rootsTimeoutMs);
      rootsWaiters.set(id, (message) => {
        clearTimeout(timer);
        rootsWaiters.delete(id);
        resolve(message);
      });
      write({ jsonrpc: "2.0", id, method: "roots/list" });
    });
  }

  /**
   * Open a hub session for `next` with the client's remembered handshake,
   * swallowing the responses the client has already had from the first one.
   *
   * @returns {Promise<string|null>} the new session id, or null on failure
   */
  async function openSessionFor(next) {
    const res = await post(initializeFrame, headers(null, next));
    const assigned = res.headers.get("mcp-session-id");
    await res.text();
    if (!res.ok || !assigned) {
      log(`hub answered ${res.status} re-opening the session for workspace ${next ?? "(anchor)"}`);
      if (assigned) await deleteSession(assigned, next);
      return null;
    }
    if (initializedFrame) {
      const ack = await post(initializedFrame, headers(assigned, next));
      await ack.text();
    }
    return assigned;
  }

  /** Re-target the bridge at the worktree the client's roots name. */
  async function followClientRoots() {
    const answer = await askClientRoots();
    if (!answer) {
      log(`client did not answer roots/list within ${rootsTimeoutMs} ms — keeping workspace ${workspace ?? "(anchor)"}`);
      return;
    }
    if (answer.error) {
      log(`client refused roots/list (${answer.error.message ?? "error"}) — keeping workspace ${workspace ?? "(anchor)"}`);
      return;
    }

    const decision = workspaceFromRoots(answer.result?.roots, repoRoot, resolveRepoImpl);
    if ("skip" in decision) {
      log(`${decision.skip} — keeping workspace ${workspace ?? "(anchor)"}`);
      return;
    }
    if (decision.workspace === workspace) return;

    let next;
    try {
      next = await openSessionFor(decision.workspace);
    } catch (err) {
      log(`could not re-open the session for ${decision.root}: ${err.message}`);
      return;
    }
    if (!next) return;

    const previous = { session: sessionId, workspace };
    sessionId = next;
    workspace = decision.workspace;
    log(`bridging to ${url} (workspace ${workspace ?? "(anchor)"}, from client root)`);
    if (previous.session) await deleteSession(previous.session, previous.workspace);
  }

  const lines = createInterface({ input, crlfDelay: Infinity });
  const followsRoots = () => Boolean(repoRoot) && clientHasRoots && initializeFrame !== null;

  // Serial: each frame is awaited before the next is read, so `initialize`
  // has established the session before anything that needs it is sent.
  let chain = Promise.resolve();
  const enqueue = (step) => {
    chain = chain.then(step).catch((err) => log(`handler failed: ${err.message}`));
  };
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

    // The client's answer to the shim's own roots/list. Matched here, ahead of
    // the chain that is blocked waiting for it, and never forwarded. A late
    // answer to a timed-out request is dropped the same way.
    if (typeof message.id === "string" && message.id.startsWith(ROOTS_REQUEST_PREFIX) && message.method === undefined) {
      rootsWaiters.get(message.id)?.(message);
      return;
    }

    if (message.method === "initialize") {
      initializeFrame = message;
      clientHasRoots = Boolean(message.params?.capabilities?.roots);
    }

    if (message.method === "notifications/roots/list_changed") {
      if (followsRoots()) enqueue(followClientRoots);
      return;
    }

    enqueue(() => handle(message));
    if (message.method === "notifications/initialized") {
      initializedFrame = message;
      if (followsRoots()) enqueue(followClientRoots);
    }
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
    repoRoot: target.repoRoot,
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
 * leaves nothing in the per-user `config.json`, so a shim that read only the
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
 * 2. The per-user `config.json` plus a registry lookup by repository root, for a
 *    worktree that was never registered from itself.
 *
 * @returns {Promise<{url: string, workspace: string|null, repoRoot: string}|null>}
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
    repoRoot: repo.repoRoot,
  };
}

/** Last path segment, for either separator — the workspace key the server assigns. */
function basenameOf(path) {
  const trimmed = path.replace(/[/\\]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return cut === -1 ? trimmed : trimmed.slice(cut + 1);
}
