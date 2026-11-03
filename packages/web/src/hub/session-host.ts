/**
 * Who hosts the hub-scope Sidecar session.
 *
 * There is one hub session per machine. It runs on a project server the hub
 * picks — the hub itself spawns no vendor CLI — and its state lives under
 * `<ndx home>/hub/sidecar/`, so any project server can pick it up from disk.
 *
 * - **The host lock** (`<ndx home>/hub/sidecar/host.lock`) holds the pid and
 *   port of the server hosting it. A server claims it before serving a hub
 *   session route; a live holder that is not the caller keeps it, a dead
 *   one is replaced. {@link claimHubSessionHost} is the host's side.
 * - **The pick** is the hub's side: the lock's holder while it is a healthy
 *   registered project, else the first healthy registered project. A host
 *   the proxy could not reach is skipped until its next health check
 *   succeeds, so the next request moves on to another one.
 *
 * @module web/hub/session-host
 */

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { HUB_SIDECAR_HOST_LOCK_SEGMENTS } from "../shared/index.js";
import type { ProjectView } from "./hub.js";
import { isPidAlive } from "./registry.js";

export interface HubSessionHostLock {
  pid: number;
  port: number;
  acquiredAt: string;
}

/** `<hubHome>/hub/sidecar/`: the hub session's index, transcripts, ledger and cards. */
export function hubSidecarDir(hubHome: string): string {
  return join(hubHome, ...HUB_SIDECAR_HOST_LOCK_SEGMENTS.slice(0, -1));
}

export function hubSessionHostLockPath(hubHome: string): string {
  return join(hubHome, ...HUB_SIDECAR_HOST_LOCK_SEGMENTS);
}

/** The lock's holder, or null when there is no readable lock. */
export function readHubSessionHostLock(hubHome: string): HubSessionHostLock | null {
  const path = hubSessionHostLockPath(hubHome);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<HubSessionHostLock>;
    return Number.isInteger(parsed.pid) && Number.isInteger(parsed.port) && typeof parsed.acquiredAt === "string"
      ? (parsed as HubSessionHostLock)
      : null;
  } catch {
    // Half-written by a claimant that died mid-write: no holder, the next claim replaces it.
    return null;
  }
}

export type HubSessionHostClaim =
  | { held: true; lock: HubSessionHostLock; acquired: boolean }
  | { held: false; holder: HubSessionHostLock };

export interface ClaimHubSessionHostInput {
  pid: number;
  port: number;
  now?: () => Date;
  /** Injected for tests. */
  isAlive?: (pid: number) => boolean;
}

/**
 * Hold the host lock for `pid` on `port`, or name the live server that holds
 * it. `acquired` is true when this claim took the lock from nobody or from a
 * dead holder: the caller's view of the session is then stale and must be
 * read again from disk.
 */
export function claimHubSessionHost(hubHome: string, input: ClaimHubSessionHostInput): HubSessionHostClaim {
  const isAlive = input.isAlive ?? isPidAlive;
  const path = hubSessionHostLockPath(hubHome);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const holder = readHubSessionHostLock(hubHome);
    if (holder && holder.pid === input.pid && holder.port === input.port) return { held: true, lock: holder, acquired: false };
    if (holder && holder.pid !== input.pid && isAlive(holder.pid)) return { held: false, holder };
    // No holder, a dead one, or this process on a new port: replace it.
    if (existsSync(path)) rmSync(path, { force: true });
    const lock: HubSessionHostLock = { pid: input.pid, port: input.port, acquiredAt: (input.now ?? (() => new Date()))().toISOString() };
    mkdirSync(dirname(path), { recursive: true });
    let fd: number;
    try {
      // Exclusive create: of two servers replacing a dead holder at once, one wins and the other reads it next round.
      fd = openSync(path, "wx", 0o600);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw err;
    }
    try {
      writeSync(fd, JSON.stringify(lock) + "\n");
    } finally {
      closeSync(fd);
    }
    return { held: true, lock, acquired: holder?.pid !== input.pid };
  }
  const holder = readHubSessionHostLock(hubHome);
  if (holder) return { held: false, holder };
  throw new Error(`Could not claim ${path}: it changed on every attempt`);
}

/** The project's port, when its last health check answered. */
function healthyPort(project: ProjectView): number | null {
  if (project.status.state !== "healthy") return null;
  return project.status.port ?? project.port;
}

/**
 * The hub's choice of host. Holds no session state: a host change costs the
 * session nothing, because the next host resumes it from disk.
 */
export class HubSessionHostPicker {
  /** Project id → the health stamp it had when the proxy failed to reach it. */
  private readonly unreachable = new Map<string, string | null>();

  constructor(private readonly hubHome: string) {}

  /**
   * The project to send a hub session request to, or null when no registered
   * project is healthy. `projects` is the hub's sorted list.
   */
  pick(projects: readonly ProjectView[]): { project: ProjectView; port: number } | null {
    const candidates = projects
      .filter((project) => !this.skipped(project))
      .map((project) => ({ project, port: healthyPort(project) }))
      .filter((c): c is { project: ProjectView; port: number } => c.port !== null);
    const lock = readHubSessionHostLock(this.hubHome);
    return (lock && candidates.find((c) => c.port === lock.port)) || candidates[0] || null;
  }

  /** The proxy could not reach `project`: skip it until a newer health check answers. */
  markUnreachable(project: ProjectView): void {
    this.unreachable.set(project.id, project.status.lastHealthAt);
  }

  private skipped(project: ProjectView): boolean {
    if (!this.unreachable.has(project.id)) return false;
    if (this.unreachable.get(project.id) !== project.status.lastHealthAt) {
      this.unreachable.delete(project.id);
      return false;
    }
    return true;
  }
}
