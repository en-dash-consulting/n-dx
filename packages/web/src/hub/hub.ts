/**
 * The n-dx hub daemon — one process per user, owning 127.0.0.1:3117 and the
 * machine-wide concerns: the project registry (~/.n-dx/hub.json), a pid file
 * (~/.n-dx/hub.pid), and a server process per registered repository.
 *
 * This is the PR 8 skeleton: registry + child lifecycle + /api/hub/* routes.
 * The reverse proxy under /p/:id/, the root alias for a sole project, and the
 * per-project MCP endpoints are sibling tasks and deliberately absent here.
 *
 * Zone contract (enforced by boundary-check.test.ts): src/hub/ imports only
 * node built-ins, hub siblings, src/shared (through the barrel), and the
 * llm-client exec helpers via ./llm-gateway.js. In particular it must not
 * import from src/server — the hub manages servers, it does not become one.
 *
 * Lifecycle:
 *  - startup: load the registry; for each project whose recorded pid is alive
 *    and answering /api/status, attach (keep pid/port, no spawn handle);
 *    otherwise respawn. The registry survives hub restarts by design.
 *  - health: every HEALTH_CHECK_INTERVAL_MS probe each child's /api/status.
 *    A reachable child refreshes lastSeen (and clears any respawn debt). An
 *    unreachable child is respawned once; if it is unreachable again before
 *    ever recovering, it is marked unreachable and left alone — a crash loop
 *    is an operator problem, not something to hammer every 15 seconds.
 *  - shutdown: stop every child (handles via killWithFallback, attached
 *    children by pid escalation), remove hub.pid, close the HTTP server.
 *
 * @module hub/hub
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { writeFile, rm } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import {
  defaultHubDir,
  emptyRegistry,
  loadRegistry,
  saveRegistry,
  HUB_PID_FILENAME,
  type HubProject,
  type HubRegistry,
} from "./registry.js";
import {
  spawnProjectServer,
  probeChildHealth,
  stopChild,
  isPidAlive,
  ChildSpawnError,
  type ChildServer,
} from "./children.js";

export const DEFAULT_HUB_PORT = 3117;
const HEALTH_CHECK_INTERVAL_MS = 15_000;
const LOOPBACK_HOST = "127.0.0.1";
/** Cap on request bodies — a registration payload is a few hundred bytes. */
const MAX_BODY_BYTES = 64 * 1024;

export interface StartHubOptions {
  /** Hub state directory; defaults to ~/.n-dx. Tests point this at a temp dir. */
  hubDir?: string;
  /** Health-check cadence; tests shorten it. */
  healthCheckIntervalMs?: number;
  /** Suppress console output. */
  quiet?: boolean;
}

export interface HubCloseOptions {
  /**
   * Stop the child servers too (the default — hub shutdown takes its children
   * with it). Tests pass false to simulate a crashed hub leaving children
   * running, which is exactly the state the restart/attach path recovers.
   */
  stopChildren?: boolean;
}

export interface HubHandle {
  /** Port the hub actually bound. */
  port: number;
  hubDir: string;
  close(opts?: HubCloseOptions): Promise<void>;
}

/** Per-project runtime state the registry does not persist. */
interface ProjectRuntime {
  child?: ChildServer;
  reachable: boolean;
  /** One respawn is owed per unreachability episode; recovery re-arms it. */
  respawned: boolean;
}

interface HubState {
  hubDir: string;
  registry: HubRegistry;
  runtime: Map<string, ProjectRuntime>;
  /**
   * Ids with a registration or removal currently awaiting a spawn/stop.
   * Route handlers interleave across those awaits, so without this a second
   * POST for the same id double-spawns a child server.
   */
  inFlight: Set<string>;
  quiet: boolean;
}

function log(state: HubState, ...args: unknown[]): void {
  if (!state.quiet) console.log("[hub]", ...args);
}

// ---------------------------------------------------------------------------
// Route handling
// ---------------------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf-8");
    req.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

/** The wire shape of a project: registry fields plus runtime observations. */
function projectView(state: HubState, project: HubProject): Record<string, unknown> {
  const runtime = state.runtime.get(project.id);
  return {
    ...project,
    reachable: runtime?.reachable ?? false,
  };
}

async function handleRegister(state: HubState, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { error: "body must be JSON" });
    return;
  }
  if (!parsed || typeof parsed !== "object") {
    sendJson(res, 400, { error: "body must be an object" });
    return;
  }
  const body = parsed as Record<string, unknown>;
  const id = body["id"];
  const repoRoot = body["repoRoot"];
  const ndxBin = body["ndxBin"];
  const worktree = body["worktree"];
  if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    sendJson(res, 400, { error: "id is required: alphanumeric plus . _ - (must not start with a separator)" });
    return;
  }
  if (typeof repoRoot !== "string" || !isAbsolute(repoRoot)) {
    sendJson(res, 400, { error: "repoRoot is required and must be an absolute path" });
    return;
  }
  if (typeof ndxBin !== "string" || ndxBin.length === 0) {
    sendJson(res, 400, { error: "ndxBin is required" });
    return;
  }

  if (state.inFlight.has(id)) {
    sendJson(res, 409, { error: `project ${id} has a registration or removal in progress` });
    return;
  }
  state.inFlight.add(id);
  try {
    await registerProject(state, id, { repoRoot, ndxBin, worktree, name: body["name"] }, res);
  } finally {
    state.inFlight.delete(id);
  }
}

async function registerProject(
  state: HubState,
  id: string,
  input: { repoRoot: string; ndxBin: string; worktree: unknown; name: unknown },
  res: ServerResponse,
): Promise<void> {
  const { repoRoot, ndxBin, worktree } = input;
  const existing = state.registry.projects[id];
  if (existing) {
    // Same id again: record the extra worktree if it brings one, and report
    // the running child. Registration is idempotent — `ndx start` in an
    // already-registered repo must not double-spawn.
    if (typeof worktree === "string" && worktree.length > 0 && !existing.worktrees.includes(worktree)) {
      existing.worktrees.push(worktree);
      await saveRegistry(state.hubDir, state.registry);
    }
    const runtime = state.runtime.get(id);
    if (runtime?.child && isPidAlive(runtime.child.pid)) {
      sendJson(res, 200, { project: projectView(state, existing) });
      return;
    }
    // Registered but not running — fall through to spawn for it.
  }

  const project: HubProject = existing ?? {
    id,
    name: typeof input.name === "string" && input.name.length > 0 ? input.name : id,
    repoRoot,
    worktrees: typeof worktree === "string" && worktree.length > 0 ? [worktree] : [],
    ndxBin,
    port: null,
    pid: null,
    lastSeen: null,
  };

  let child: ChildServer;
  try {
    child = await spawnProjectServer(project.ndxBin, project.repoRoot);
  } catch (err) {
    const message = err instanceof ChildSpawnError ? err.message : String(err);
    sendJson(res, 502, { error: `failed to start project server: ${message}` });
    return;
  }

  project.port = child.port;
  project.pid = child.pid;
  project.lastSeen = new Date().toISOString();
  state.registry.projects[id] = project;
  state.runtime.set(id, { child, reachable: true, respawned: false });
  await saveRegistry(state.hubDir, state.registry);

  log(state, `registered ${id} → pid ${child.pid}, port ${child.port}`);
  sendJson(res, existing ? 200 : 201, { project: projectView(state, project) });
}

async function handleUnregister(state: HubState, id: string, res: ServerResponse): Promise<void> {
  const project = state.registry.projects[id];
  if (!project) {
    sendJson(res, 404, { error: `unknown project: ${id}` });
    return;
  }
  if (state.inFlight.has(id)) {
    sendJson(res, 409, { error: `project ${id} has a registration or removal in progress` });
    return;
  }
  state.inFlight.add(id);
  try {
    const runtime = state.runtime.get(id);
    if (runtime?.child) {
      await stopChild(runtime.child);
    }
    delete state.registry.projects[id];
    state.runtime.delete(id);
    await saveRegistry(state.hubDir, state.registry);
    log(state, `unregistered ${id}`);
    sendJson(res, 200, { removed: id });
  } finally {
    state.inFlight.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Child lifecycle
// ---------------------------------------------------------------------------

/**
 * Bring up (or re-attach) every registered project on hub startup.
 *
 * A recorded pid that is alive AND answering /api/status on the recorded port
 * is re-attached — the hub adopts it without a spawn handle. Anything else is
 * respawned. Spawn failures are recorded as unreachable rather than failing
 * hub startup: one broken repo must not take the hub down for the rest.
 */
async function reconcileOnStartup(state: HubState): Promise<void> {
  for (const project of Object.values(state.registry.projects)) {
    const { pid, port } = project;
    if (pid !== null && port !== null && isPidAlive(pid) && (await probeChildHealth(port))) {
      state.runtime.set(project.id, { child: { pid, port }, reachable: true, respawned: false });
      project.lastSeen = new Date().toISOString();
      log(state, `attached ${project.id} (pid ${pid}, port ${port})`);
      continue;
    }
    try {
      const child = await spawnProjectServer(project.ndxBin, project.repoRoot);
      project.pid = child.pid;
      project.port = child.port;
      project.lastSeen = new Date().toISOString();
      state.runtime.set(project.id, { child, reachable: true, respawned: false });
      log(state, `respawned ${project.id} (pid ${child.pid}, port ${child.port})`);
    } catch (err) {
      state.runtime.set(project.id, { reachable: false, respawned: true });
      log(state, `could not start ${project.id}: ${String(err)}`);
    }
  }
  await saveRegistry(state.hubDir, state.registry);
}

/** One health-check sweep over every registered project. */
async function healthSweep(state: HubState): Promise<void> {
  let dirty = false;
  for (const project of Object.values(state.registry.projects)) {
    const runtime = state.runtime.get(project.id);
    if (!runtime || project.port === null) continue;

    if (await probeChildHealth(project.port)) {
      runtime.reachable = true;
      runtime.respawned = false; // recovery re-arms the single respawn
      project.lastSeen = new Date().toISOString();
      dirty = true;
      continue;
    }

    runtime.reachable = false;
    if (runtime.respawned) continue; // already spent this episode's respawn
    runtime.respawned = true;
    log(state, `${project.id} unreachable on port ${project.port} — respawning once`);
    try {
      if (runtime.child) await stopChild(runtime.child);
      const child = await spawnProjectServer(project.ndxBin, project.repoRoot);
      project.pid = child.pid;
      project.port = child.port;
      project.lastSeen = new Date().toISOString();
      runtime.child = child;
      runtime.reachable = true;
      dirty = true;
    } catch (err) {
      log(state, `respawn of ${project.id} failed: ${String(err)}`);
    }
  }
  if (dirty) await saveRegistry(state.hubDir, state.registry);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Start the hub daemon. Resolves once the HTTP server is listening and every
 * registered project has been attached or respawned.
 */
export async function startHub(port: number = DEFAULT_HUB_PORT, opts: StartHubOptions = {}): Promise<HubHandle> {
  const hubDir = opts.hubDir ?? defaultHubDir();
  const state: HubState = {
    hubDir,
    registry: emptyRegistry(),
    runtime: new Map(),
    inFlight: new Set(),
    quiet: opts.quiet ?? false,
  };

  state.registry = await loadRegistry(hubDir);

  const server: Server = createServer((req, res) => {
    void routeRequest(state, req, res);
  });

  const boundPort = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, LOOPBACK_HOST, () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : port);
    });
  });

  await reconcileOnStartup(state);

  const pidFile = join(hubDir, HUB_PID_FILENAME);
  await writeFile(
    pidFile,
    JSON.stringify({ pid: process.pid, port: boundPort, startedAt: new Date().toISOString() }, null, 2) + "\n",
    "utf-8",
  );

  const sweepTimer = setInterval(() => {
    void healthSweep(state);
  }, opts.healthCheckIntervalMs ?? HEALTH_CHECK_INTERVAL_MS);
  // A daemon's own timer must not hold an otherwise-finished process open.
  sweepTimer.unref();

  log(state, `listening on http://${LOOPBACK_HOST}:${boundPort} (${Object.keys(state.registry.projects).length} project(s))`);

  let closed = false;
  const close = async (closeOpts: HubCloseOptions = {}): Promise<void> => {
    if (closed) return;
    closed = true;
    clearInterval(sweepTimer);
    if (closeOpts.stopChildren !== false) {
      for (const runtime of state.runtime.values()) {
        if (runtime.child) await stopChild(runtime.child);
      }
    }
    await rm(pidFile, { force: true });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return { port: boundPort, hubDir, close };

  async function routeRequest(st: HubState, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${LOOPBACK_HOST}:${boundPort}`);
    try {
      if (req.method === "GET" && url.pathname === "/api/hub/health") {
        sendJson(res, 200, {
          ok: true,
          pid: process.pid,
          port: boundPort,
          projects: Object.keys(st.registry.projects).length,
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/hub/projects") {
        sendJson(res, 200, {
          projects: Object.values(st.registry.projects).map((p) => projectView(st, p)),
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/hub/projects") {
        await handleRegister(st, req, res);
        return;
      }
      const idMatch = url.pathname.match(/^\/api\/hub\/projects\/([^/]+)$/);
      if (req.method === "DELETE" && idMatch) {
        await handleUnregister(st, decodeURIComponent(idMatch[1]!), res);
        return;
      }
      sendJson(res, 404, { error: `no such route: ${req.method} ${url.pathname}` });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
  }
}
