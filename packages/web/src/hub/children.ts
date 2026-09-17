/**
 * One project server per registered repository: spawn, attach, health, stop.
 *
 * The hub does not serve any repository itself. For each registered project
 * it runs today's `web serve` unchanged as a child on an ephemeral loopback
 * port, so every single-project assumption in that server stays intact and
 * each repository can run its own n-dx version (`ndxBin` is per project).
 *
 * ## Lifecycle
 *
 * - **start** — spawn `<ndxBin> serve --port=0 <repoRoot>`, then wait for the
 *   port the child bound. The child writes it to `<repoRoot>/.n-dx-web.port`
 *   (see PORT_FILE in server/start.ts); that file is the contract, so the
 *   stale one from a previous run is removed before spawning.
 * - **attach** — on hub restart, a project whose recorded pid is alive and
 *   whose port answers `GET /api/status` for the right directory is adopted
 *   as-is. The hub has no child handle for it, so stopping goes through
 *   `process.kill` with the same SIGTERM→SIGKILL escalation.
 * - **health** — every interval the hub asks each child `GET /api/status`.
 *   A child that stops answering is marked unreachable and respawned once;
 *   a second failure stays visible as `unreachable` for the operator rather
 *   than looping.
 * - **stop** — SIGTERM, grace period, SIGKILL.
 *
 * @module web/hub/children
 */

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { killWithFallback, spawnManaged } from "./exec-gateway.js";
import type { ManagedChild } from "./exec-gateway.js";
import { isPidAlive } from "./registry.js";
import type { ProjectRecord } from "./registry.js";

/** The project server writes its bound port here — same constant as server/start.ts. */
const PORT_FILE = ".n-dx-web.port";

export type ChildState =
  /** Spawned; waiting for the port file or the first health check. */
  | "starting"
  /** Last health check answered. */
  | "healthy"
  /** Last health check failed; the hub has used (or is using) its one respawn. */
  | "unreachable"
  /** Not running — never started, stopped on request, or exited on its own. */
  | "stopped";

export interface ChildStatus {
  state: ChildState;
  pid: number | null;
  port: number | null;
  /** Adopted from the registry on hub start rather than spawned by this hub. */
  attached: boolean;
  /** Automatic restarts after an unreachable health check. Capped at one. */
  respawns: number;
  lastHealthAt: string | null;
  lastError: string | null;
}

export interface SupervisorOptions {
  /** How long to wait for the child to publish its port. */
  portFileTimeoutMs?: number;
  /** Per-request timeout for `GET /api/status`. */
  healthTimeoutMs?: number;
  /** SIGTERM→SIGKILL grace when stopping. */
  stopGraceMs?: number;
  log?: (message: string) => void;
}

const DEFAULTS: Required<Omit<SupervisorOptions, "log">> = {
  portFileTimeoutMs: 20_000,
  healthTimeoutMs: 3_000,
  stopGraceMs: 5_000,
};

/** The hub restarts an unreachable child this many times before leaving it to the operator. */
export const MAX_RESPAWNS = 1;

/**
 * The command that serves one project. Pure, so the shape is testable.
 *
 * `ndxBin` is normally a path to `@n-dx/web`'s `dist/cli/index.js`; a script
 * is run with this hub's Node. Anything else is treated as an executable that
 * understands the same `serve` command, which keeps the door open for a
 * packaged binary without teaching the hub about it.
 */
export function buildServeCommand(ndxBin: string, repoRoot: string): { cmd: string; args: string[] } {
  const serveArgs = ["serve", "--port=0", repoRoot];
  if (/\.(m|c)?js$/.test(ndxBin)) {
    return { cmd: process.execPath, args: [ndxBin, ...serveArgs] };
  }
  return { cmd: ndxBin, args: serveArgs };
}

/** `GET /api/status` on a project server. Resolves `ok` only for an n-dx server answering for a directory. */
export async function checkProjectHealth(
  port: number,
  timeoutMs: number,
): Promise<{ ok: boolean; projectDir: string | null; error: string | null }> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/status`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, projectDir: null, error: `HTTP ${res.status}` };
    const body = (await res.json()) as { projectDir?: unknown };
    if (typeof body.projectDir !== "string") {
      return { ok: false, projectDir: null, error: "not an n-dx server (no projectDir)" };
    }
    return { ok: true, projectDir: body.projectDir, error: null };
  } catch (err) {
    return { ok: false, projectDir: null, error: (err as Error).message };
  }
}

function readPortFile(repoRoot: string): number | null {
  try {
    const port = parseInt(readFileSync(join(repoRoot, PORT_FILE), "utf-8").trim(), 10);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

function removePortFile(repoRoot: string): void {
  try {
    const path = join(repoRoot, PORT_FILE);
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // The child overwrites it anyway; this only shortens the stale window.
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Stop a process the hub did not spawn: SIGTERM, wait, SIGKILL. */
async function stopForeignPid(pid: number, graceMs: number): Promise<void> {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return; // already gone
  }
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return;
    await sleep(100);
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // gone between the check and the kill
  }
}

/** Supervises the server process for one registered project. */
export class ProjectSupervisor {
  readonly record: ProjectRecord;
  private readonly opts: Required<Omit<SupervisorOptions, "log">> & Pick<SupervisorOptions, "log">;

  private handle: ManagedChild | null = null;
  private state: ChildState = "stopped";
  private attached = false;
  private respawns = 0;
  private lastHealthAt: string | null = null;
  private lastError: string | null = null;
  /** Set while a stop is in progress so the child's exit is not read as a crash. */
  private stopping = false;
  /** Serialises start/stop/health so a health tick cannot respawn mid-stop. */
  private inFlight: Promise<void> = Promise.resolve();

  constructor(record: ProjectRecord, options: SupervisorOptions = {}) {
    this.record = record;
    this.opts = { ...DEFAULTS, ...options };
  }

  status(): ChildStatus {
    return {
      state: this.state,
      pid: this.record.pid,
      port: this.record.port,
      attached: this.attached,
      respawns: this.respawns,
      lastHealthAt: this.lastHealthAt,
      lastError: this.lastError,
    };
  }

  /** Run `fn` after whatever lifecycle operation is currently in flight. */
  private serialize(fn: () => Promise<void>): Promise<void> {
    const next = this.inFlight.then(fn, fn);
    this.inFlight = next.catch(() => {});
    return next;
  }

  /** Spawn the project server and wait for it to publish its port. */
  start(): Promise<void> {
    return this.serialize(() => this.spawnAndWait());
  }

  /**
   * Adopt the recorded process if it is alive and answering for this
   * repository; otherwise spawn a fresh one. Used on hub restart.
   */
  attach(): Promise<void> {
    return this.serialize(async () => {
      const { pid, port } = this.record;
      if (pid && port && isPidAlive(pid)) {
        const health = await checkProjectHealth(port, this.opts.healthTimeoutMs);
        if (health.ok) {
          this.attached = true;
          this.state = "healthy";
          this.lastHealthAt = new Date().toISOString();
          this.record.lastSeen = this.lastHealthAt;
          this.lastError = null;
          this.opts.log?.(`[hub] attached ${this.record.id} (pid ${pid}, port ${port})`);
          return;
        }
        this.lastError = health.error;
      }
      this.opts.log?.(`[hub] ${this.record.id}: recorded server not running — spawning`);
      await this.spawnAndWait();
    });
  }

  /** Stop the project server, escalating SIGTERM→SIGKILL. Idempotent. */
  stop(): Promise<void> {
    return this.serialize(() => this.stopNow());
  }

  /**
   * One health tick. Marks the child unreachable when it stops answering and
   * respawns it once; after that the state stays visible for the operator.
   */
  healthCheck(): Promise<void> {
    return this.serialize(async () => {
      if (this.state === "stopped" || this.record.port === null) return;
      const health = await checkProjectHealth(this.record.port, this.opts.healthTimeoutMs);
      if (health.ok) {
        this.state = "healthy";
        this.lastHealthAt = new Date().toISOString();
        this.record.lastSeen = this.lastHealthAt;
        this.lastError = null;
        return;
      }
      this.lastError = health.error;
      this.state = "unreachable";
      if (this.respawns >= MAX_RESPAWNS) {
        this.opts.log?.(`[hub] ${this.record.id} unreachable (${health.error}); respawn budget used`);
        return;
      }
      this.respawns++;
      this.opts.log?.(`[hub] ${this.record.id} unreachable (${health.error}); respawning`);
      await this.stopNow();
      await this.spawnAndWait();
    });
  }

  private async spawnAndWait(): Promise<void> {
    if (this.state !== "stopped" && this.record.pid && isPidAlive(this.record.pid)) return;

    const { cmd, args } = buildServeCommand(this.record.ndxBin, this.record.repoRoot);
    removePortFile(this.record.repoRoot);
    this.stopping = false;
    this.attached = false;
    this.state = "starting";
    this.lastError = null;

    // Inherit stdio: a dashboard server logs little, and buffering a daemon's
    // output for its whole life (what "pipe" would do) is a leak.
    const handle = spawnManaged(cmd, args, { cwd: this.record.repoRoot, stdio: "inherit", windowsHide: true });
    this.handle = handle;
    this.record.pid = handle.pid ?? null;
    this.record.port = null;

    let exited = false;
    let exitCode: number | null = null;
    void handle.done.then((result) => {
      exited = true;
      exitCode = result.exitCode;
      if (this.handle === handle) {
        this.handle = null;
        this.record.pid = null;
        this.record.port = null;
        if (!this.stopping) {
          this.state = "stopped";
          this.lastError = `exited with code ${result.exitCode ?? "null"}`;
          this.opts.log?.(`[hub] ${this.record.id} exited (${result.exitCode ?? "signal"})`);
        }
      }
    });

    if (handle.pid === undefined) {
      this.state = "stopped";
      this.lastError = `could not spawn ${cmd}`;
      return;
    }

    const deadline = Date.now() + this.opts.portFileTimeoutMs;
    while (Date.now() < deadline && !exited) {
      const port = readPortFile(this.record.repoRoot);
      if (port !== null) {
        this.record.port = port;
        const health = await checkProjectHealth(port, this.opts.healthTimeoutMs);
        if (health.ok) {
          this.state = "healthy";
          this.lastHealthAt = new Date().toISOString();
          this.record.lastSeen = this.lastHealthAt;
          this.opts.log?.(`[hub] ${this.record.id} up (pid ${handle.pid}, port ${port})`);
          return;
        }
        // Port published but not answering yet — keep polling until the deadline.
      }
      await sleep(100);
    }

    if (exited) {
      this.lastError = `exited with code ${exitCode ?? "null"} before publishing a port`;
    } else {
      this.lastError = `no port published within ${this.opts.portFileTimeoutMs}ms`;
      await this.stopNow();
    }
    this.state = "stopped";
  }

  private async stopNow(): Promise<void> {
    this.stopping = true;
    const handle = this.handle;
    const pid = this.record.pid;
    if (handle) {
      await killWithFallback(handle, this.opts.stopGraceMs);
    } else if (pid && isPidAlive(pid)) {
      await stopForeignPid(pid, this.opts.stopGraceMs);
    }
    this.handle = null;
    this.record.pid = null;
    this.record.port = null;
    this.attached = false;
    this.state = "stopped";
    removePortFile(this.record.repoRoot);
  }
}
