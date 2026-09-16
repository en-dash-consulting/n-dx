/**
 * Hub registry and pid file — the machine-wide state under `~/.n-dx/`.
 *
 * One hub per user owns `~/.n-dx/hub.json` (which projects are registered,
 * and which server process serves each) and `~/.n-dx/hub.pid` (which
 * process is the hub). Both are plain JSON, written atomically — a
 * half-written registry read by the next hub start would drop projects.
 *
 * The directory is `$N_DX_HOME` when set, else `~/.n-dx`. Tests point it at
 * a temp directory through {@link resolveHubHome}'s argument.
 *
 * @module web/hub/registry
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Bumped when the on-disk shape changes incompatibly. */
export const HUB_REGISTRY_VERSION = 1;

export const HUB_REGISTRY_FILE = "hub.json";
export const HUB_PID_FILE = "hub.pid";

/** One registered repository and the server process serving it. */
export interface ProjectRecord {
  /** Stable id chosen by the registrar (`ndx start` derives it from the git common dir). */
  id: string;
  /** Display name — the repository directory's basename unless the registrar says otherwise. */
  name: string;
  /** Absolute path of the directory the project server serves. */
  repoRoot: string;
  /** Worktree roots registered under this project, `repoRoot` included. */
  worktrees: string[];
  /**
   * The `@n-dx/web` CLI entry that serves this project — a path to
   * `dist/cli/index.js`, or an executable exposing the same `serve` command.
   * Per project, so each repository can run its own n-dx version.
   */
  ndxBin: string;
  /** Loopback port the project server bound, or null when not running. */
  port: number | null;
  /** Pid of the project server, or null when not running. */
  pid: number | null;
  /** ISO timestamp of the last successful health check. */
  lastSeen: string | null;
}

export interface HubRegistry {
  version: number;
  projects: Record<string, ProjectRecord>;
}

/** Contents of `hub.pid`. */
export interface HubPidFile {
  pid: number;
  port: number;
  startedAt: string;
}

export function emptyRegistry(): HubRegistry {
  return { version: HUB_REGISTRY_VERSION, projects: {} };
}

/** `$N_DX_HOME`, else `~/.n-dx`; an explicit argument wins over both. */
export function resolveHubHome(homeDir?: string): string {
  return homeDir ?? process.env.N_DX_HOME ?? join(homedir(), ".n-dx");
}

export function registryPath(hubHome: string): string {
  return join(hubHome, HUB_REGISTRY_FILE);
}

export function hubPidPath(hubHome: string): string {
  return join(hubHome, HUB_PID_FILE);
}

/**
 * Read the registry. Missing, unreadable or malformed files yield an empty
 * registry rather than an error: the hub must still start on a machine whose
 * registry was damaged, and a start that fails here would leave the operator
 * with no way to repair it through the hub itself.
 */
export function loadRegistry(path: string): HubRegistry {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return emptyRegistry();
  }
  try {
    const parsed = JSON.parse(raw) as Partial<HubRegistry> | null;
    if (!parsed || typeof parsed !== "object" || typeof parsed.projects !== "object" || parsed.projects === null) {
      return emptyRegistry();
    }
    const projects: Record<string, ProjectRecord> = {};
    for (const [id, record] of Object.entries(parsed.projects)) {
      if (isProjectRecord(record)) projects[id] = { ...record, id };
    }
    return { version: HUB_REGISTRY_VERSION, projects };
  } catch {
    return emptyRegistry();
  }
}

function isProjectRecord(value: unknown): value is ProjectRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return typeof r.repoRoot === "string" && typeof r.ndxBin === "string";
}

/**
 * Write the registry atomically: serialise to a sibling temp file, then
 * rename over the target. A reader never sees a partial document.
 */
export function saveRegistry(path: string, registry: HubRegistry): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(registry, null, 2) + "\n", "utf-8");
  renameSync(tmp, path);
}

export function writeHubPidFile(path: string, info: HubPidFile): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(info, null, 2) + "\n", "utf-8");
  renameSync(tmp, path);
}

export function readHubPidFile(path: string): HubPidFile | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<HubPidFile>;
    if (typeof parsed.pid !== "number" || typeof parsed.port !== "number") return null;
    return { pid: parsed.pid, port: parsed.port, startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "" };
  } catch {
    return null;
  }
}

export function removeHubPidFile(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // Best-effort: a stale pid file is detected by the next hub start anyway.
  }
}

/**
 * Whether a process with this pid exists. `kill(pid, 0)` sends no signal;
 * EPERM means it exists but belongs to another user, which for "is the
 * server I recorded still there?" is still yes.
 */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
