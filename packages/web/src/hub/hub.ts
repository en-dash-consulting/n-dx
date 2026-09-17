/**
 * The hub daemon — one process per user that owns 127.0.0.1:3117 and the
 * machine-wide concerns: which repositories are registered, one dashboard
 * server per repository, and (in later PRs) the home page and the `/p/:id/`
 * proxy. See the epic "0.7.0 / PR 8 · ndx hub daemon".
 *
 * This module is the composition root: it loads the registry, adopts or
 * respawns each project's server, serves `/api/hub/*`, proxies everything
 * else to a project server (proxy.ts), runs the health loop, and tears
 * everything down on `close()`. Route handling is in routes.ts and per-child
 * process control in children.ts.
 *
 * Orchestration rule: core's `web.js` will spawn this (`web hub`, PR 10). The
 * hub itself is web-package code and stays inside `src/hub/` — it imports
 * node built-ins, `src/shared/` (the base-path helpers it shares with the
 * viewer) and the exec helpers through `exec-gateway.ts`, nothing from
 * `src/server/` or `src/viewer/`.
 *
 * @module web/hub/hub
 */

import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { mkdirSync } from "node:fs";
import { basename } from "node:path";
import { ProjectSupervisor } from "./children.js";
import type { ChildStatus, SupervisorOptions } from "./children.js";
import { AdmissionGate, countProjectExecutions } from "./admission.js";
import type { AdmissionLimits, QueueEntry, QueueSnapshot } from "./admission.js";
import {
  hubConfigPath,
  hubPidPath,
  readHubConfig,
  loadRegistry,
  registryPath,
  removeHubPidFile,
  resolveHubHome,
  saveRegistry,
  writeHubPidFile,
} from "./registry.js";
import type { HubConfigProblem, HubRegistry, ProjectRecord } from "./registry.js";
import { handleHubRoute } from "./routes.js";
import { handleProxyRequest, handleProxyUpgrade } from "./proxy.js";
import { guardHubRequest, upgradeAllowed } from "./request-guard.js";

export const DEFAULT_HUB_PORT = 3117;
const LOOPBACK_HOST = "127.0.0.1";

export interface HubOptions {
  /** Port to listen on. 0 asks the OS for a free one (tests). Default 3117. */
  port?: number;
  /** Directory holding hub.json and hub.pid. Default `$N_DX_HOME` or `~/.n-dx`. */
  homeDir?: string;
  /** How often each project server is health-checked. Default 15 s. */
  healthIntervalMs?: number;
  /** Passed to every {@link ProjectSupervisor}. */
  supervisor?: SupervisorOptions;
  /**
   * Stay up when the last project unregisters. Defaults to `hub.keepAlive`
   * in `~/.n-dx/config.json`, which itself defaults to false.
   */
  keepAlive?: boolean;
  /**
   * Machine-wide admission limits. Default to `hub.maxSessions` and
   * `hub.memoryFloorBytes` from the same file.
   */
  limits?: Partial<AdmissionLimits>;
  /** Injectable for tests — the gate's view of free memory. */
  freeMemory?: () => number;
  /** How often the gate retries queued runs. Default 2 s. */
  drainIntervalMs?: number;
  /**
   * Called once the registry has just become empty and `keepAlive` is off —
   * {@link startHub} closes the hub. Fired by {@link Hub.exitIfEmpty} rather
   * than from the removal itself, so the caller can wait until its HTTP
   * response has flushed before pulling the server out from under it.
   */
  onEmpty?: () => void;
  log?: (message: string) => void;
}

export interface CloseOptions {
  /**
   * Stop every project server too (default). `false` leaves them running so
   * the next hub start re-attaches — how a hub upgrade avoids restarting
   * every dashboard on the machine.
   */
  stopChildren?: boolean;
}

export interface HubHandle {
  port: number;
  hubHome: string;
  registryPath: string;
  startedAt: string;
  close(options?: CloseOptions): Promise<void>;
}

/** What `POST /api/hub/projects` accepts. */
export interface RegisterProjectInput {
  id: string;
  repoRoot: string;
  ndxBin: string;
  /** A worktree of the repository to record under the project; `repoRoot` is always recorded. */
  worktree?: string;
  name?: string;
}

/** A registry record joined with its supervisor's live status. */
export interface ProjectView extends ProjectRecord {
  status: ChildStatus;
}

/** Outcome of unregistering one worktree from a project. */
export interface WorktreeRemoval {
  /** False when no project carries that id — the caller's marker files are stale. */
  projectKnown: boolean;
  /** False when the project is known but never had that worktree registered. */
  worktreeKnown: boolean;
  /** The project was unregistered and its server stopped: that was the last worktree. */
  projectRemoved: boolean;
  /** Worktrees still registered under the project, after the removal. */
  remaining: string[];
  /** The project as it now stands, or null once removed. */
  project: ProjectView | null;
  /** The hub has nothing left to serve and will exit (keepAlive is off). */
  hubExiting: boolean;
}

/**
 * Trailing separators are the only difference worth absorbing: both sides
 * realpath their paths before they get here, so anything else that differs is
 * a different directory.
 */
export function normalizeWorktree(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  return trimmed || path;
}

/**
 * Hub state and operations, independent of HTTP so the routes stay thin and
 * the lifecycle is testable without a socket.
 */
export class Hub {
  readonly hubHome: string;
  readonly registryPath: string;
  readonly startedAt = new Date().toISOString();
  /** Stay up with an empty registry. Resolved once, at construction. */
  readonly keepAlive: boolean;
  /** Machine-wide admission control for dashboard-started runs. */
  readonly admission: AdmissionGate;
  /** Keys `~/.n-dx/config.json` got wrong, for {@link startHub} to report once. */
  readonly configProblems: HubConfigProblem[];
  private readonly registry: HubRegistry;
  private readonly supervisors = new Map<string, ProjectSupervisor>();
  private readonly supervisorOptions: SupervisorOptions;
  private readonly log: (message: string) => void;
  private readonly onEmpty: (() => void) | undefined;
  private port = 0;

  constructor(options: HubOptions = {}) {
    this.hubHome = resolveHubHome(options.homeDir);
    this.registryPath = registryPath(this.hubHome);
    this.log = options.log ?? (() => {});
    this.onEmpty = options.onEmpty;
    mkdirSync(this.hubHome, { recursive: true });
    const { config, problems } = readHubConfig(hubConfigPath(this.hubHome));
    this.configProblems = problems;
    this.keepAlive = options.keepAlive ?? config.keepAlive;
    this.supervisorOptions = { log: this.log, ...options.supervisor };
    this.registry = loadRegistry(this.registryPath);
    for (const record of Object.values(this.registry.projects)) {
      this.supervisors.set(record.id, new ProjectSupervisor(record, this.supervisorOptions));
    }
    this.admission = new AdmissionGate({
      limits: {
        maxSessions: options.limits?.maxSessions ?? config.maxSessions,
        memoryFloorBytes: options.limits?.memoryFloorBytes ?? config.memoryFloorBytes,
      },
      countRunning: () => this.countRunningExecutions(),
      start: (entry) => this.startQueuedExecution(entry),
      freeMemory: options.freeMemory,
      drainIntervalMs: options.drainIntervalMs,
      log: this.log,
    });
  }

  /** Dashboard-started runs in flight across every project that has a server. */
  private async countRunningExecutions(): Promise<number> {
    const ports = this.listProjects()
      .map((project) => project.status.port ?? project.port)
      .filter((port): port is number => typeof port === "number");
    const counts = await Promise.all(ports.map((port) => countProjectExecutions(port)));
    return counts.reduce((total, n) => total + n, 0);
  }

  /**
   * Start a queued run on its project's server, as the hub rather than as the
   * client that queued it — that client got its 202 and is long gone.
   */
  private async startQueuedExecution(entry: QueueEntry): Promise<boolean> {
    const project = this.getProject(entry.projectId);
    const port = project?.status.port ?? project?.port ?? null;
    if (port === null) return false;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/hench/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(entry.workspace ? { "x-ndx-workspace": entry.workspace } : {}),
        },
        body: JSON.stringify({ taskId: entry.taskId }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        this.log(`[hub] admission: ${entry.projectId}/${entry.taskId} refused by its server (HTTP ${res.status})`);
        return false;
      }
      this.log(`[hub] admission: started queued ${entry.projectId}/${entry.taskId}`);
      return true;
    } catch (err) {
      this.log(`[hub] admission: could not start ${entry.projectId}/${entry.taskId} — ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Current admission and queue state, for `GET /api/hub/queue`.
   *
   * The counts and limits are the machine's — that is what they measure, and
   * a project waiting behind another project's run needs to see why. Only the
   * entry list narrows: asked through `/p/<id>/`, a viewer gets its own
   * project's queue, since it can neither act on nor identify another's.
   */
  queueSnapshot(projectId?: string): QueueSnapshot {
    const snapshot = this.admission.snapshot();
    if (projectId === undefined) return snapshot;
    return {
      ...snapshot,
      entries: snapshot.entries.filter((entry) => entry.projectId === projectId),
      /** Queued across every project, so "2 of 5 waiting" stays truthful. */
      queuedTotal: snapshot.entries.length,
    };
  }

  get listeningPort(): number {
    return this.port;
  }

  setPort(port: number): void {
    this.port = port;
  }

  /** Re-attach or respawn every registered project. Failures are recorded on the project, not thrown. */
  async attachAll(): Promise<void> {
    await Promise.all(
      Array.from(this.supervisors.values()).map(async (sup) => {
        try {
          await sup.attach();
        } catch (err) {
          this.log(`[hub] ${sup.record.id}: attach failed — ${(err as Error).message}`);
        }
      }),
    );
    this.persist();
  }

  listProjects(): ProjectView[] {
    return Array.from(this.supervisors.values())
      .map((sup) => ({ ...sup.record, status: sup.status() }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  getProject(id: string): ProjectView | null {
    const sup = this.supervisors.get(id);
    return sup ? { ...sup.record, status: sup.status() } : null;
  }

  /**
   * Register a project (or add a worktree to an existing one) and make sure
   * its server is running. Resolves once the server has published its port
   * or the supervisor has given up; the returned view says which.
   */
  async registerProject(input: RegisterProjectInput): Promise<{ created: boolean; project: ProjectView }> {
    let sup = this.supervisors.get(input.id);
    const created = !sup;
    if (!sup) {
      const record: ProjectRecord = {
        id: input.id,
        name: input.name ?? basename(input.repoRoot),
        repoRoot: input.repoRoot,
        worktrees: [input.repoRoot],
        ndxBin: input.ndxBin,
        port: null,
        pid: null,
        lastSeen: null,
      };
      this.registry.projects[record.id] = record;
      sup = new ProjectSupervisor(record, this.supervisorOptions);
      this.supervisors.set(record.id, sup);
    } else {
      // Re-registration refreshes what may have changed: a newer n-dx, a rename.
      sup.record.ndxBin = input.ndxBin;
      if (input.name) sup.record.name = input.name;
    }
    if (input.worktree && !sup.record.worktrees.includes(input.worktree)) {
      sup.record.worktrees.push(input.worktree);
    }
    this.persist();

    if (sup.status().state === "stopped") {
      await sup.start();
      this.persist();
    }
    return { created, project: { ...sup.record, status: sup.status() } };
  }

  /** How many projects are registered. */
  get projectCount(): number {
    return this.supervisors.size;
  }

  /**
   * Unregister one worktree from a project.
   *
   * Each worktree that ran `ndx start` is listed under the project, and the
   * repository root is listed from the first registration onwards because it
   * is what the project's server actually serves. Removing the last of them
   * unregisters the project and stops that server; while any remain, the
   * server keeps running for them.
   */
  async removeWorktree(id: string, worktree: string): Promise<WorktreeRemoval> {
    const sup = this.supervisors.get(id);
    if (!sup) {
      return { projectKnown: false, worktreeKnown: false, projectRemoved: false, remaining: [], project: null, hubExiting: false };
    }
    const target = normalizeWorktree(worktree);
    const before = sup.record.worktrees;
    const remaining = before.filter((wt) => normalizeWorktree(wt) !== target);
    const worktreeKnown = remaining.length !== before.length;
    sup.record.worktrees = remaining;

    if (remaining.length === 0) {
      await this.removeProject(id);
      const hubExiting = this.supervisors.size === 0 && !this.keepAlive;
      return { projectKnown: true, worktreeKnown, projectRemoved: true, remaining, project: null, hubExiting };
    }
    this.persist();
    return {
      projectKnown: true,
      worktreeKnown,
      projectRemoved: false,
      remaining,
      project: { ...sup.record, status: sup.status() },
      hubExiting: false,
    };
  }

  /**
   * Invoke the {@link HubOptions.onEmpty} hook when nothing is registered any
   * more. Called by the route layer once its response has flushed — closing
   * the server mid-response would strand the client that asked for it.
   */
  exitIfEmpty(): void {
    if (this.supervisors.size > 0 || this.keepAlive) return;
    this.onEmpty?.();
  }

  /** Stop a project's server and forget it. False when the id is unknown. */
  async removeProject(id: string): Promise<boolean> {
    const sup = this.supervisors.get(id);
    if (!sup) return false;
    await sup.stop();
    this.supervisors.delete(id);
    delete this.registry.projects[id];
    // Anything queued for it can never start now.
    this.admission.forgetProject(id);
    this.persist();
    return true;
  }

  /** One health tick across every project. */
  async healthCheckAll(): Promise<void> {
    await Promise.all(Array.from(this.supervisors.values()).map((sup) => sup.healthCheck()));
    this.persist();
  }

  /** Stop every project server (registry entries are kept). */
  async stopAll(): Promise<void> {
    await Promise.all(Array.from(this.supervisors.values()).map((sup) => sup.stop()));
    this.persist();
  }

  persist(): void {
    saveRegistry(this.registryPath, this.registry);
  }
}

/** Start the hub: adopt registered servers, listen, health-check. */
export async function startHub(options: HubOptions = {}): Promise<HubHandle> {
  const requestedPort = options.port ?? DEFAULT_HUB_PORT;
  const healthIntervalMs = options.healthIntervalMs ?? 15_000;
  const log = options.log ?? (() => {});

  // Closing on the last unregistration: `close` is only defined once the
  // handle below exists, and nothing can call this before the server is
  // listening, so the late binding is safe.
  let closeSelf: (() => Promise<void>) | null = null;
  const hub = new Hub({
    ...options,
    onEmpty: () => {
      log("[hub] last project unregistered — exiting (set hub.keepAlive in ~/.n-dx/config.json to stay up)");
      void closeSelf?.();
      options.onEmpty?.();
    },
  });

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    // The origin gate is the hub's outer boundary and runs before any routing:
    // registration spawns a process, and the project servers behind the proxy
    // see a rewritten Origin, so this is where a browser request is judged.
    if (guardHubRequest(req, res, hub.listeningPort)) return;
    void handleHubRoute(req, res, hub)
      .then((handled) => {
        // Everything that is not the hub's own API belongs to a project server:
        // /p/<id>/… explicitly, or the root alias when one project is registered.
        if (!handled) void handleProxyRequest(req, res, hub);
      })
      .catch((err: unknown) => {
        // A throw here is an unhandled rejection, which ends the hub and every
        // project server it supervises. Answer 500 instead.
        console.error("[hub] request failed:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        }
        if (!res.writableEnded) res.end(JSON.stringify({ error: "Internal server error" }));
      });
  });
  server.on("upgrade", (req, socket, head) => {
    if (!upgradeAllowed(req, hub.listeningPort)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      socket.destroy();
      return;
    }
    handleProxyUpgrade(req, socket, head, hub);
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, LOOPBACK_HOST, () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : requestedPort);
    });
  });
  hub.setPort(port);
  writeHubPidFile(hubPidPath(hub.hubHome), { pid: process.pid, port, startedAt: hub.startedAt });
  log(`[hub] listening on http://${LOOPBACK_HOST}:${port}`);

  // Once, at start, and never again: a settings key the operator got wrong is
  // otherwise invisible — the hub runs on the default and the limit gets
  // blamed for not working.
  for (const problem of hub.configProblems) {
    log(`[hub] ~/.n-dx/config.json: ${problem.key} — ${problem.message} (using the default)`);
  }

  await hub.attachAll();

  const healthTimer = setInterval(() => {
    void hub.healthCheckAll();
  }, healthIntervalMs);
  healthTimer.unref();

  let closed = false;
  const handle: HubHandle = {
    port,
    hubHome: hub.hubHome,
    registryPath: hub.registryPath,
    startedAt: hub.startedAt,
    async close(closeOptions: CloseOptions = {}) {
      if (closed) return;
      closed = true;
      clearInterval(healthTimer);
      hub.admission.stop();
      if (closeOptions.stopChildren ?? true) {
        await hub.stopAll();
      } else {
        hub.persist();
      }
      removeHubPidFile(hubPidPath(hub.hubHome));
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    },
  };
  closeSelf = () => handle.close({ stopChildren: true });
  return handle;
}
