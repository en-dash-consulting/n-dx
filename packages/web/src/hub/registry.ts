/**
 * The hub's project registry — `~/.n-dx/hub.json`.
 *
 * One hub process per user owns the machine-wide map of registered projects.
 * Each entry records where the project lives (`repoRoot`, plus any worktrees
 * registered under the same id), how to start its server (`ndxBin` — each repo
 * may run its own n-dx version), and what the hub last knew about the running
 * child (`port`, `pid`, `lastSeen`). The child fields are observations, not
 * commands: on restart the hub re-attaches to a pid that is alive and
 * answering, and respawns otherwise.
 *
 * Writes are atomic (temp file + rename in the same directory) because the
 * registry outlives the hub process — a torn write would turn every registered
 * project into a respawn on the next start. A missing or malformed file reads
 * as an empty registry rather than an error: the hub must come up on a fresh
 * machine and after a corrupted write alike.
 *
 * @module hub/registry
 */

import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** A registered project and what the hub last knew about its server. */
export interface HubProject {
  id: string;
  /** Display name; defaults to the id at registration. */
  name: string;
  /** Primary checkout the child server serves. */
  repoRoot: string;
  /** Additional worktrees registered under the same project id. */
  worktrees: string[];
  /** Executable that starts this repo's server (`<ndxBin> serve --port=0 <repoRoot>`). */
  ndxBin: string;
  /** Bound port of the last known child, or null before first spawn. */
  port: number | null;
  /** Pid of the last known child, or null before first spawn. */
  pid: number | null;
  /** ISO-8601 timestamp of the last successful health check, or null. */
  lastSeen: string | null;
}

export interface HubRegistry {
  projects: Record<string, HubProject>;
}

export const REGISTRY_FILENAME = "hub.json";
export const HUB_PID_FILENAME = "hub.pid";

/** The per-user hub state directory. Overridable for tests via startHub opts. */
export function defaultHubDir(): string {
  return join(homedir(), ".n-dx");
}

export function emptyRegistry(): HubRegistry {
  return { projects: {} };
}

/**
 * Parse raw registry file contents. Pure, so corruption handling is
 * assertable without a filesystem: anything that is not an object with a
 * `projects` object reads as empty, and each project entry is kept only if it
 * carries the fields the hub cannot invent (`id`, `repoRoot`, `ndxBin`).
 */
export function parseRegistry(raw: string): HubRegistry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyRegistry();
  }
  if (!parsed || typeof parsed !== "object") return emptyRegistry();
  const projects = (parsed as Record<string, unknown>)["projects"];
  if (!projects || typeof projects !== "object" || Array.isArray(projects)) {
    return emptyRegistry();
  }

  const out: HubRegistry = emptyRegistry();
  for (const [id, value] of Object.entries(projects as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const p = value as Record<string, unknown>;
    if (typeof p["id"] !== "string" || typeof p["repoRoot"] !== "string" || typeof p["ndxBin"] !== "string") {
      continue;
    }
    out.projects[id] = {
      id: p["id"],
      name: typeof p["name"] === "string" ? p["name"] : p["id"],
      repoRoot: p["repoRoot"],
      worktrees: Array.isArray(p["worktrees"])
        ? p["worktrees"].filter((w): w is string => typeof w === "string")
        : [],
      ndxBin: p["ndxBin"],
      port: typeof p["port"] === "number" ? p["port"] : null,
      pid: typeof p["pid"] === "number" ? p["pid"] : null,
      lastSeen: typeof p["lastSeen"] === "string" ? p["lastSeen"] : null,
    };
  }
  return out;
}

/** Load the registry, treating a missing file as empty. */
export async function loadRegistry(hubDir: string): Promise<HubRegistry> {
  let raw: string;
  try {
    raw = await readFile(join(hubDir, REGISTRY_FILENAME), "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyRegistry();
    throw err;
  }
  return parseRegistry(raw);
}

/**
 * Persist the registry atomically: write a temp file in the same directory,
 * then rename over the target. Rename within a directory is atomic on the
 * platforms we support, so a reader never observes a half-written registry.
 */
export async function saveRegistry(hubDir: string, registry: HubRegistry): Promise<void> {
  await mkdir(hubDir, { recursive: true });
  const target = join(hubDir, REGISTRY_FILENAME);
  const tmp = join(hubDir, `${REGISTRY_FILENAME}.${process.pid}.tmp`);
  await writeFile(tmp, JSON.stringify(registry, null, 2) + "\n", "utf-8");
  await rename(tmp, target);
}
