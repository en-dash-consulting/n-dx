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
/** User settings for the hub itself, distinct from any project's `.n-dx.json`. */
export const HUB_CONFIG_FILE = "config.json";

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

/** The `hub` section of `~/.n-dx/config.json`. Everything is optional. */
export interface HubConfig {
  /** Port the hub listens on. Core reads the same key to find it. */
  port?: number;
  /**
   * Keep the hub running once its last project unregisters. Off by default:
   * a hub with nothing to serve is a process holding 3117 for no reason, and
   * the next `ndx start` spawns one in well under a second.
   */
  keepAlive?: boolean;
  /** Dashboard-started agent runs in flight across every registered project. */
  maxSessions?: number;
  /** Free system memory below which the hub queues runs instead of starting them. */
  memoryFloorBytes?: number;
}

/** Applied wherever the file says nothing, or says something unusable. */
export const HUB_CONFIG_DEFAULTS: Required<HubConfig> = {
  port: 3117,
  keepAlive: false,
  // Four concurrent agent runs is what a 16 GB laptop carries without
  // swapping, which is the machine this limit exists for.
  maxSessions: 4,
  memoryFloorBytes: 2 * 1024 * 1024 * 1024,
};

/** A key the file got wrong, named so the hub can say so once at start. */
export interface HubConfigProblem {
  key: string;
  message: string;
}

export interface HubConfigResult {
  config: Required<HubConfig>;
  problems: HubConfigProblem[];
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

export function hubConfigPath(hubHome: string): string {
  return join(hubHome, HUB_CONFIG_FILE);
}

/**
 * Read `~/.n-dx/config.json`, reporting what it got wrong.
 *
 * A bad value never stops the hub: settings are a convenience, and refusing
 * to start over a stray comma would take every dashboard on the machine with
 * it. Each unusable key falls back to its default and is named in `problems`,
 * which {@link startHub} prints once — silently ignoring a `maxSessions` the
 * operator meant is how a limit gets blamed for not working.
 */
export function readHubConfig(path: string): HubConfigResult {
  const config: Required<HubConfig> = { ...HUB_CONFIG_DEFAULTS };
  const problems: HubConfigProblem[] = [];

  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return { config, problems }; // absent is the normal case, not a problem
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    problems.push({ key: "(file)", message: `not valid JSON: ${(err as Error).message}` });
    return { config, problems };
  }

  const hub = (parsed as { hub?: unknown })?.hub;
  if (hub === undefined) return { config, problems };
  if (!hub || typeof hub !== "object" || Array.isArray(hub)) {
    problems.push({ key: "hub", message: "expected an object" });
    return { config, problems };
  }

  const { port, keepAlive, maxSessions, memoryFloorBytes } = hub as Record<string, unknown>;

  if (port !== undefined) {
    if (typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535) config.port = port;
    else problems.push({ key: "hub.port", message: "expected an integer between 1 and 65535" });
  }
  if (keepAlive !== undefined) {
    if (typeof keepAlive === "boolean") config.keepAlive = keepAlive;
    else problems.push({ key: "hub.keepAlive", message: "expected true or false" });
  }
  if (maxSessions !== undefined) {
    if (typeof maxSessions === "number" && Number.isInteger(maxSessions) && maxSessions >= 1) config.maxSessions = maxSessions;
    else problems.push({ key: "hub.maxSessions", message: "expected an integer of at least 1" });
  }
  if (memoryFloorBytes !== undefined) {
    if (typeof memoryFloorBytes === "number" && Number.isFinite(memoryFloorBytes) && memoryFloorBytes >= 0) {
      config.memoryFloorBytes = memoryFloorBytes;
    } else {
      problems.push({ key: "hub.memoryFloorBytes", message: "expected a non-negative number of bytes" });
    }
  }

  return { config, problems };
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
