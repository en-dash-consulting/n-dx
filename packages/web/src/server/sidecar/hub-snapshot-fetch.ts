/**
 * Reads the hub snapshot's input over HTTP, through the hub only.
 *
 * The hub session never opens another repository: every fact comes from the
 * hub's own API (`/api/hub/overview`, `/api/hub/queue`) or a project server
 * behind the hub's `/p/<id>/` prefix (and `/p/<id>/w/<key>/` for a worktree),
 * with the per-user token. A read that fails becomes `{ ok: false, error }`
 * for that read alone, so one dead project or one gated route never costs the
 * rest of the snapshot.
 *
 * Where the hub listens and the token come from the per-user directory, which
 * `resolveNdxHome` names: the hub's pid file for the port, `auth.token` for
 * the token. See {@link resolveHubAccess}.
 */

import { readAuthToken, resolveAuthTokenPath } from "@n-dx/llm-client";
import { hubPidPath, readHubPidFile, resolveHubHome, type ProjectCard, type QueueSnapshot } from "../../hub/index.js";
import type { BranchHealth } from "../branch-health/index.js";
import { errorMessage } from "../response-utils.js";
import type { PendingChangeset } from "../routes-changesets.js";
import type {
  Fetched,
  HubSnapshotInput,
  ProjectReads,
  SnapshotClaims,
  SnapshotConcurrency,
  SnapshotStatus,
  SnapshotWorkspaces,
  SnapshotWorktree,
} from "./hub-snapshot.js";

/** Per request: a hub proxy that cannot answer in this long is reported, not waited on. */
const READ_TIMEOUT_MS = 10_000;

export interface HubAccess {
  /** `http://127.0.0.1:<port>`, no trailing slash. */
  baseUrl: string;
  /** The per-user token, or null when auth is off. */
  token: string | null;
}

/**
 * The running hub's address and the token, from the per-user directory; null
 * when no hub pid file names a port.
 */
export function resolveHubAccess(homeDir?: string): HubAccess | null {
  const home = resolveHubHome(homeDir);
  const pid = readHubPidFile(hubPidPath(home));
  if (!pid) return null;
  return { baseUrl: `http://127.0.0.1:${pid.port}`, token: readAuthToken(resolveAuthTokenPath({ ndxHome: home })) };
}

export interface FetchHubSnapshotOptions {
  /** Injected for tests; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Ask each worktree's branch health with `?github=1`. Default true; gh still runs only where the project allows it. */
  github?: boolean;
  now?: () => Date;
  signal?: AbortSignal;
}

/** Every read the snapshot is built from. Never throws: a failed read is recorded where it failed. */
export async function fetchHubSnapshotInput(access: HubAccess, options: FetchHubSnapshotOptions = {}): Promise<HubSnapshotInput> {
  const doFetch = options.fetch ?? fetch;
  const get = async <T>(path: string): Promise<Fetched<T>> => {
    try {
      const signal = options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(READ_TIMEOUT_MS)])
        : AbortSignal.timeout(READ_TIMEOUT_MS);
      const res = await doFetch(`${access.baseUrl}${path}`, {
        headers: access.token ? { "X-Ndx-Token": access.token } : {},
        signal,
      });
      if (!res.ok) {
        const body = await res.text().catch((err: unknown) => `(body unreadable: ${errorMessage(err)})`);
        return { ok: false, error: `HTTP ${res.status} from ${path}${body ? `: ${body.slice(0, 200)}` : ""}` };
      }
      return { ok: true, value: (await res.json()) as T };
    } catch (err) {
      return { ok: false, error: `${path}: ${errorMessage(err)}` };
    }
  };

  const [overview, queue] = await Promise.all([
    get<{ projects: ProjectCard[] }>("/api/hub/overview"),
    get<QueueSnapshot>("/api/hub/queue"),
  ]);
  const projects: Record<string, ProjectReads> = {};
  if (overview.ok) {
    const github = options.github ?? true;
    await Promise.all(overview.value.projects.filter((card) => card.reachable).map(async (card) => {
      projects[card.id] = await readProject(get, card.id, github);
    }));
  }
  return { overview, queue, projects, generatedAt: (options.now ?? (() => new Date()))().toISOString() };
}

type Get = <T>(path: string) => Promise<Fetched<T>>;

async function readProject(get: Get, id: string, github: boolean): Promise<ProjectReads> {
  const prefix = `/p/${encodeURIComponent(id)}`;
  const [status, concurrency, workspaces, worktrees, claims, changesets] = await Promise.all([
    get<SnapshotStatus>(`${prefix}/api/status`),
    get<SnapshotConcurrency>(`${prefix}/api/hench/concurrency`),
    get<SnapshotWorkspaces>(`${prefix}/api/workspaces`),
    get<SnapshotWorktree[]>(`${prefix}/api/worktrees`),
    get<SnapshotClaims>(`${prefix}/api/rex/claims`),
    get<{ changesets: PendingChangeset[] }>(`${prefix}/api/changesets`),
  ]);
  const branchHealth: Record<string, Fetched<BranchHealth>> = {};
  if (workspaces.ok) {
    const query = github ? "?github=1" : "";
    await Promise.all(workspaces.value.workspaces.map(async ({ key }) => {
      const slot = key === workspaces.value.anchor ? "" : `/w/${encodeURIComponent(key)}`;
      branchHealth[key] = await get<BranchHealth>(`${prefix}${slot}/api/branch-health${query}`);
    }));
  }
  return { status, concurrency, workspaces, worktrees, claims, changesets, branchHealth };
}
