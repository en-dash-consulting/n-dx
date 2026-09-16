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
import {
  hubPidPath,
  loadRegistry,
  registryPath,
  removeHubPidFile,
  resolveHubHome,
  saveRegistry,
  writeHubPidFile,
} from "./registry.js";
import type { HubRegistry, ProjectRecord } from "./registry.js";
import { handleHubRoute } from "./routes.js";
import { handleProxyRequest, handleProxyUpgrade } from "./proxy.js";

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

/**
 * Hub state and operations, independent of HTTP so the routes stay thin and
 * the lifecycle is testable without a socket.
 */
export class Hub {
  readonly hubHome: string;
  readonly registryPath: string;
  readonly startedAt = new Date().toISOString();
  private readonly registry: HubRegistry;
  private readonly supervisors = new Map<string, ProjectSupervisor>();
  private readonly supervisorOptions: SupervisorOptions;
  private readonly log: (message: string) => void;
  private port = 0;

  constructor(options: HubOptions = {}) {
    this.hubHome = resolveHubHome(options.homeDir);
    this.registryPath = registryPath(this.hubHome);
    this.log = options.log ?? (() => {});
    this.supervisorOptions = { log: this.log, ...options.supervisor };
    mkdirSync(this.hubHome, { recursive: true });
    this.registry = loadRegistry(this.registryPath);
    for (const record of Object.values(this.registry.projects)) {
      this.supervisors.set(record.id, new ProjectSupervisor(record, this.supervisorOptions));
    }
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

  /** Stop a project's server and forget it. False when the id is unknown. */
  async removeProject(id: string): Promise<boolean> {
    const sup = this.supervisors.get(id);
    if (!sup) return false;
    await sup.stop();
    this.supervisors.delete(id);
    delete this.registry.projects[id];
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
  const hub = new Hub(options);
  const requestedPort = options.port ?? DEFAULT_HUB_PORT;
  const healthIntervalMs = options.healthIntervalMs ?? 15_000;
  const log = options.log ?? (() => {});

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleHubRoute(req, res, hub).then((handled) => {
      // Everything that is not the hub's own API belongs to a project server:
      // /p/<id>/… explicitly, or the root alias when one project is registered.
      if (!handled) handleProxyRequest(req, res, hub);
    });
  });
  server.on("upgrade", (req, socket, head) => handleProxyUpgrade(req, socket, head, hub));

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

  await hub.attachAll();

  const healthTimer = setInterval(() => {
    void hub.healthCheckAll();
  }, healthIntervalMs);
  healthTimer.unref();

  let closed = false;
  return {
    port,
    hubHome: hub.hubHome,
    registryPath: hub.registryPath,
    startedAt: hub.startedAt,
    async close(closeOptions: CloseOptions = {}) {
      if (closed) return;
      closed = true;
      clearInterval(healthTimer);
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
}
