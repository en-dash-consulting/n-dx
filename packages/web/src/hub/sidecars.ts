/**
 * Extension sidecars: the hub's second kind of child, next to the project
 * servers in children.ts (docs/architecture/extensions.md, "Sidecar lifecycle").
 *
 * The hub knows nothing about manifests. For `/x/<name>/` it asks n-dx —
 * `ndx extensions sidecar <name> --json`, spawned like every other
 * orchestration call — for a launch plan: the bin, the contract environment,
 * the health path, the idle limit and the log file. Discovery, approval and
 * the config check therefore happen in core, in the same place `ndx <name>`
 * does them, and the hub only runs what the plan names.
 *
 * ## Lifecycle
 *
 * - **Lazy start.** The first request starts the bin on an ephemeral loopback
 *   port (`PORT`) and holds until `health` answers 200, up to
 *   {@link SIDECAR_START_TIMEOUT_MS}; then 503 naming the log file.
 * - **Idle stop.** {@link SidecarManager.sweepIdle} stops a sidecar with no
 *   request in flight, no open WebSocket and no traffic for `idleStopMinutes`.
 * - **Crash handling.** An exit the hub did not ask for is a crash; the next
 *   request restarts it, except after {@link SIDECAR_CRASH_LIMIT} crashes in
 *   {@link SIDECAR_CRASH_WINDOW_MS}, when starts are refused until the oldest
 *   of them ages out. A start that never turns healthy counts as a crash, or a
 *   broken sidecar would be respawned by every request.
 * - **Budget.** No sidecar starts while available memory is at or below the
 *   hub's memory floor (`hub.memoryFloorBytes`), the one the admission gate
 *   holds agent runs to, so a sidecar never starves the project servers.
 *
 * Output goes to the plan's log file (`<ndx home>/ext/<name>/logs/`), never
 * buffered in the hub.
 *
 * @module web/hub/sidecars
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { dirname } from "node:path";
import { exec, killWithFallback, spawnManaged } from "./exec-gateway.js";
import type { ManagedChild } from "./exec-gateway.js";

/** How long the first request waits for `health` before answering 503. */
export const SIDECAR_START_TIMEOUT_MS = 20_000;
/** Crashes within {@link SIDECAR_CRASH_WINDOW_MS} after which restarts back off. */
export const SIDECAR_CRASH_LIMIT = 3;
export const SIDECAR_CRASH_WINDOW_MS = 5 * 60_000;

/** An extension name, as the manifest validator allows it. Anything else is no sidecar. */
const EXTENSION_NAME = /^[a-z0-9][a-z0-9-]*$/;
const LOOPBACK = "127.0.0.1";

/** What `ndx extensions sidecar <name> --json` prints on success. */
export interface SidecarPlan {
  name: string;
  /** The Node n-dx runs on; extensions run with the same one. */
  execPath: string;
  bin: string;
  cwd: string;
  /** The full environment, contract variables included. `PORT` is added by the hub. */
  env: Record<string, string | undefined>;
  health: string;
  idleStopMinutes: number;
  logFile: string;
}

export type PlanResult =
  | { ok: true; plan: SidecarPlan }
  /** `reason` is core's: `none` (no such sidecar), `refused` (not enabled, missing bin), `config`, `state`, or `error`. */
  | { ok: false; reason: string; error: string };

/** Asks n-dx for the launch plan of one sidecar. */
export type PlanSidecar = (name: string) => Promise<PlanResult>;

export type EnsureResult =
  | { ok: true; port: number }
  | { ok: false; status: number; error: string; logFile: string | null; retryAfterSeconds?: number };

export type SidecarState = "starting" | "running" | "stopped";

export interface SidecarStatus {
  name: string;
  state: SidecarState;
  pid: number | null;
  port: number | null;
  logFile: string | null;
  /** Crashes still inside the backoff window. */
  recentCrashes: number;
  lastError: string | null;
  openSockets: number;
}

export interface SidecarManagerOptions {
  /** Null when the hub was started without an n-dx CLI to ask; every start is then refused. */
  plan: PlanSidecar | null;
  memoryFloorBytes: number;
  /** Available memory, or null when the machine cannot be read (which admits). */
  freeMemory: () => number | null;
  startTimeoutMs?: number;
  healthPollMs?: number;
  healthTimeoutMs?: number;
  stopGraceMs?: number;
  crashLimit?: number;
  crashWindowMs?: number;
  /** Clock for idle and crash bookkeeping. */
  now?: () => number;
  log?: (message: string) => void;
}

/**
 * The plan function for a hub that knows where n-dx's CLI is: spawn
 * `<node> <ndxCli> extensions sidecar <name> --json` from `cwd` and parse it.
 * `cwd` is the n-dx home, so the `project` discovery source finds nothing: a
 * sidecar is served machine-wide, from the user, global and dev sources.
 */
export function ndxCliPlanner(ndxCli: string, cwd: string, timeoutMs = 30_000): PlanSidecar {
  return async (name) => {
    const result = await exec(process.execPath, [ndxCli, "extensions", "sidecar", name, "--json"], { cwd, timeout: timeoutMs });
    const lastLine = result.stdout.trim().split("\n").pop() ?? "";
    let body: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = JSON.parse(lastLine);
      if (parsed !== null && typeof parsed === "object") body = parsed as Record<string, unknown>;
    } catch {
      body = null; // reported below with whatever stderr said
    }
    if (result.exitCode === 0 && body && typeof body.bin === "string") {
      return { ok: true, plan: body as unknown as SidecarPlan };
    }
    if (body && typeof body.error === "string") {
      return { ok: false, reason: typeof body.reason === "string" ? body.reason : "error", error: body.error };
    }
    const detail = result.stderr.trim() || result.error?.message || `exit code ${result.exitCode ?? "null"}`;
    return { ok: false, reason: "error", error: `Could not ask n-dx for the ${name} sidecar: ${detail}` };
  };
}

/** A free loopback port, asked of the OS. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, LOOPBACK, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      server.close(() => resolve(port));
    });
  });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** Plan refusals as HTTP: no such sidecar is 404, a known one that must not run 403, anything else 503. */
function statusForReason(reason: string): number {
  if (reason === "none") return 404;
  if (reason === "refused") return 403;
  return 503;
}

class Sidecar {
  state: SidecarState = "stopped";
  handle: ManagedChild | null = null;
  port: number | null = null;
  logFile: string | null = null;
  idleStopMs = 0;
  crashes: number[] = [];
  lastError: string | null = null;
  lastActivity = 0;
  inflight = 0;
  sockets = 0;
  starting: Promise<EnsureResult> | null = null;

  constructor(readonly name: string) {}
}

/** Starts, tracks and stops every sidecar the hub runs. */
export class SidecarManager {
  private readonly sidecars = new Map<string, Sidecar>();
  private readonly opts: SidecarManagerOptions;
  private readonly now: () => number;
  private readonly log: (message: string) => void;

  constructor(options: SidecarManagerOptions) {
    this.opts = options;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? (() => {});
  }

  /** Whether `name` could address a sidecar at all; anything else is a 404 without asking n-dx. */
  static isName(name: string): boolean {
    return EXTENSION_NAME.test(name);
  }

  list(): SidecarStatus[] {
    return Array.from(this.sidecars.values(), (s) => ({
      name: s.name,
      state: s.state,
      pid: s.handle?.pid ?? null,
      port: s.port,
      logFile: s.logFile,
      recentCrashes: this.recentCrashes(s).length,
      lastError: s.lastError,
      openSockets: s.sockets,
    })).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * The port of `name`'s running sidecar, starting it first when it is not.
   * Concurrent first requests share one start.
   */
  ensure(name: string): Promise<EnsureResult> {
    if (!SidecarManager.isName(name)) {
      return Promise.resolve({ ok: false, status: 404, error: `No extension sidecar is named "${name}"`, logFile: null });
    }
    let s = this.sidecars.get(name);
    if (!s) {
      s = new Sidecar(name);
      this.sidecars.set(name, s);
    }
    if (s.state === "running" && s.port !== null) {
      s.lastActivity = this.now();
      return Promise.resolve({ ok: true, port: s.port });
    }
    if (s.starting) return s.starting;
    const sidecar = s;
    const starting = this.start(sidecar).finally(() => {
      sidecar.starting = null;
    });
    sidecar.starting = starting;
    return starting;
  }

  /** A proxied request to `name` began; it holds the sidecar up until {@link endRequest}. */
  beginRequest(name: string): void {
    const s = this.sidecars.get(name);
    if (!s) return;
    s.inflight++;
    s.lastActivity = this.now();
  }

  endRequest(name: string): void {
    const s = this.sidecars.get(name);
    if (!s) return;
    s.inflight = Math.max(0, s.inflight - 1);
    s.lastActivity = this.now();
  }

  /** A WebSocket to `name` opened; while any is open the sidecar is never idle. */
  openSocket(name: string): void {
    const s = this.sidecars.get(name);
    if (!s) return;
    s.sockets++;
    s.lastActivity = this.now();
  }

  closeSocket(name: string): void {
    const s = this.sidecars.get(name);
    if (!s) return;
    s.sockets = Math.max(0, s.sockets - 1);
    s.lastActivity = this.now();
  }

  /** Stop every running sidecar idle for its `idleStopMinutes`. */
  async sweepIdle(): Promise<void> {
    const now = this.now();
    const idle = Array.from(this.sidecars.values()).filter((s) =>
      s.state === "running" && s.inflight === 0 && s.sockets === 0 && now - s.lastActivity >= s.idleStopMs,
    );
    await Promise.all(idle.map((s) => {
      this.log(`[hub] sidecar ${s.name}: idle for ${Math.round(s.idleStopMs / 60_000)} min — stopping`);
      return this.stopSidecar(s);
    }));
  }

  /** Stop one sidecar. False when it was not running. */
  async stop(name: string): Promise<boolean> {
    const s = this.sidecars.get(name);
    if (!s || !s.handle) return false;
    await this.stopSidecar(s);
    return true;
  }

  /** Stop every sidecar: hub shutdown and `ndx hub stop`. */
  async stopAll(): Promise<void> {
    await Promise.all(Array.from(this.sidecars.values(), (s) => this.stopSidecar(s)));
  }

  private recentCrashes(s: Sidecar): number[] {
    const windowMs = this.opts.crashWindowMs ?? SIDECAR_CRASH_WINDOW_MS;
    const since = this.now() - windowMs;
    s.crashes = s.crashes.filter((at) => at > since);
    return s.crashes;
  }

  private refuse(s: Sidecar, status: number, error: string, retryAfterSeconds?: number): EnsureResult {
    s.lastError = error;
    const logged = s.logFile ? ` See ${s.logFile}` : "";
    return {
      ok: false,
      status,
      error: `${error}${status === 503 ? logged : ""}`,
      logFile: s.logFile,
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    };
  }

  private recordCrash(s: Sidecar, error: string): void {
    s.crashes.push(this.now());
    s.lastError = error;
    this.log(`[hub] sidecar ${s.name}: ${error}`);
  }

  private async start(s: Sidecar): Promise<EnsureResult> {
    const limit = this.opts.crashLimit ?? SIDECAR_CRASH_LIMIT;
    const crashes = this.recentCrashes(s);
    if (crashes.length >= limit) {
      const windowMs = this.opts.crashWindowMs ?? SIDECAR_CRASH_WINDOW_MS;
      const retryAt = crashes[crashes.length - limit] + windowMs;
      const retryAfterSeconds = Math.max(1, Math.ceil((retryAt - this.now()) / 1000));
      return this.refuse(
        s,
        503,
        `The ${s.name} sidecar crashed ${crashes.length} times in the last ${Math.round(windowMs / 60_000)} minutes; the hub tries again in ${retryAfterSeconds}s.`,
        retryAfterSeconds,
      );
    }

    const available = this.opts.freeMemory();
    if (available !== null && available <= this.opts.memoryFloorBytes) {
      return this.refuse(
        s,
        503,
        `Not starting the ${s.name} sidecar: ${megabytes(available)} of memory is available, at or below the hub's memory floor of ${megabytes(this.opts.memoryFloorBytes)} (hub.memoryFloorBytes). Free some memory, or lower the floor.`,
      );
    }

    if (!this.opts.plan) {
      return this.refuse(s, 503, "This hub was started without an n-dx CLI to launch extension sidecars. Restart it: ndx hub stop, then ndx start.");
    }
    const planned = await this.opts.plan(s.name);
    if (!planned.ok) return this.refuse(s, statusForReason(planned.reason), planned.error);
    const plan = planned.plan;
    s.logFile = plan.logFile;
    s.idleStopMs = plan.idleStopMinutes * 60_000;

    const port = await freePort();
    mkdirSync(dirname(plan.logFile), { recursive: true });
    appendFileSync(plan.logFile, `\n[hub] ${new Date().toISOString()} starting ${plan.bin} on port ${port}\n`);
    const handle = spawnManaged(plan.execPath, [plan.bin], {
      cwd: plan.cwd,
      env: { ...plan.env, PORT: String(port) },
      logFile: plan.logFile,
      windowsHide: true,
    });
    if (handle.pid === undefined) {
      this.recordCrash(s, `could not spawn ${plan.bin}`);
      return this.refuse(s, 503, `The ${s.name} sidecar could not be started (${plan.bin}).`);
    }
    s.handle = handle;
    s.port = port;
    s.state = "starting";
    s.lastError = null;

    let exitCode: number | null | undefined;
    void handle.done.then((result) => {
      exitCode = result.exitCode;
      // A handle the hub already let go of was stopped on purpose.
      if (s.handle !== handle) return;
      s.handle = null;
      s.port = null;
      s.state = "stopped";
      this.recordCrash(s, `exited with code ${result.exitCode ?? "null"}`);
    });

    const deadline = Date.now() + (this.opts.startTimeoutMs ?? SIDECAR_START_TIMEOUT_MS);
    const url = `http://${LOOPBACK}:${port}${plan.health}`;
    while (Date.now() < deadline) {
      if (s.handle !== handle) {
        const how = exitCode === undefined ? "was stopped" : `exited with code ${exitCode ?? "null"}`;
        return this.refuse(s, 503, `The ${s.name} sidecar ${how} before answering ${plan.health}.`);
      }
      if (await this.healthy(url)) {
        s.state = "running";
        s.lastActivity = this.now();
        this.log(`[hub] sidecar ${s.name} up (pid ${handle.pid}, port ${port})`);
        return { ok: true, port };
      }
      await sleep(this.opts.healthPollMs ?? 200);
    }

    const seconds = Math.round((this.opts.startTimeoutMs ?? SIDECAR_START_TIMEOUT_MS) / 1000);
    await this.stopSidecar(s);
    this.recordCrash(s, `did not answer ${plan.health} within ${seconds}s`);
    return this.refuse(s, 503, `The ${s.name} sidecar did not answer ${plan.health} within ${seconds}s.`);
  }

  private async healthy(url: string): Promise<boolean> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(this.opts.healthTimeoutMs ?? 2_000) });
      await res.body?.cancel();
      return res.status === 200;
    } catch {
      return false; // not listening yet
    }
  }

  private async stopSidecar(s: Sidecar): Promise<void> {
    const handle = s.handle;
    // Let go first, so the exit is not read as a crash.
    s.handle = null;
    s.port = null;
    s.state = "stopped";
    s.inflight = 0;
    s.sockets = 0;
    if (handle) await killWithFallback(handle, this.opts.stopGraceMs ?? 5_000);
  }
}
