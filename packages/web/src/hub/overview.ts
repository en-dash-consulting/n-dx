/**
 * What the hub knows about each registered project, for the home page.
 *
 * The registry says which repositories exist and whether their servers are
 * up. Everything a person actually chooses between — which branch, whether
 * it is dirty, how far the PRD has got, whether an agent is running right now
 * — lives in the project's own server, behind `/api/status` and
 * `/api/git/status`. This module asks every child in parallel and joins the
 * answers onto the registry.
 *
 * A child that cannot be reached is not an error. A hub with four projects
 * routinely has one whose server died, and the card for it still has to
 * render: its name, its path, and the plain fact that it is not answering.
 * So every field a child would have supplied is nullable, and `reachable`
 * says why they are null.
 *
 * @module web/hub/overview
 */

import type { ProjectView } from "./hub.js";

/** One project as the home page shows it. */
export interface ProjectCard {
  id: string;
  name: string;
  repoRoot: string;
  /** Where the dashboard for it lives, relative to the hub root. */
  url: string;
  /** Supervisor state: healthy, starting, unreachable, stopped. */
  state: string;
  port: number | null;
  /** False when the child's own endpoints did not answer. */
  reachable: boolean;
  /** Why it did not answer, when it did not. */
  error: string | null;
  branch: string | null;
  /** Uncommitted paths, or null when git could not be asked. */
  dirtyFiles: number | null;
  /** Dashboard-started agent runs in flight for this project. */
  activeRuns: number | null;
  /** PRD completion, 0–100, or null when there is no PRD. */
  percentComplete: number | null;
  /** Title of the next actionable task, for the card's one line of "what next". */
  nextTaskTitle: string | null;
  /** ISO timestamp of the last sourcevision analysis. */
  analyzedAt: string | null;
}

export interface HubOverview {
  projects: ProjectCard[];
  generatedAt: string;
}

/** The two child responses a card is built from. Either may be missing. */
export interface ChildSnapshot {
  status: {
    rex?: { exists?: boolean; percentComplete?: number; nextTaskTitle?: string | null };
    hench?: { activeRuns?: number };
    sv?: { analyzedAt?: string | null };
  } | null;
  git: { branch?: string | null; files?: unknown[] } | null;
  error: string | null;
}

/** Everything a card needs from one child, or the reason it has none. */
export async function fetchChildSnapshot(port: number, timeoutMs = 2_000): Promise<ChildSnapshot> {
  const get = async (path: string): Promise<unknown | null> => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${path}`);
    return res.json();
  };

  try {
    // Both at once: the card is one render, and a serial pair doubles the
    // slowest child's contribution to the whole page.
    const [status, git] = await Promise.all([
      get("/api/status"),
      // Git is the softer of the two — a project outside a repository answers
      // `isRepo: false`, and a failure here should not cost the rest of the card.
      get("/api/git/status").catch(() => null),
    ]);
    return { status: status as ChildSnapshot["status"], git: git as ChildSnapshot["git"], error: null };
  } catch (err) {
    return { status: null, git: null, error: (err as Error).message };
  }
}

/**
 * Join a registry entry and its child's answers into a card. Pure.
 *
 * `snapshot` is null for a project with no running server at all — the
 * registry knows it, nothing is listening, and the card says so without any
 * request having been made.
 */
export function toProjectCard(project: ProjectView, snapshot: ChildSnapshot | null): ProjectCard {
  const port = project.status.port ?? project.port;
  const status = snapshot?.status ?? null;
  const rex = status?.rex;
  return {
    id: project.id,
    name: project.name,
    repoRoot: project.repoRoot,
    url: `/p/${encodeURIComponent(project.id)}/`,
    state: project.status.state,
    port: port ?? null,
    reachable: status !== null,
    error: snapshot?.error ?? project.status.lastError ?? null,
    branch: snapshot?.git?.branch ?? null,
    dirtyFiles: Array.isArray(snapshot?.git?.files) ? snapshot.git.files.length : null,
    activeRuns: typeof status?.hench?.activeRuns === "number" ? status.hench.activeRuns : null,
    // A project with no PRD has no percentage to show, which is different
    // from one sitting at zero.
    percentComplete: rex?.exists && typeof rex.percentComplete === "number" ? rex.percentComplete : null,
    nextTaskTitle: rex?.nextTaskTitle ?? null,
    analyzedAt: status?.sv?.analyzedAt ?? null,
  };
}

/**
 * Every registered project, with its child's answers joined on.
 *
 * @param fetchSnapshot Injected so the aggregation is testable without
 *   sockets; defaults to the real HTTP calls.
 */
export async function buildHubOverview(
  projects: ProjectView[],
  fetchSnapshot: (port: number) => Promise<ChildSnapshot> = fetchChildSnapshot,
  now: () => Date = () => new Date(),
): Promise<HubOverview> {
  const cards = await Promise.all(
    projects.map(async (project) => {
      const port = project.status.port ?? project.port;
      if (port === null || port === undefined) return toProjectCard(project, null);
      try {
        return toProjectCard(project, await fetchSnapshot(port));
      } catch (err) {
        // A rejected fetcher is the same situation as an unreachable child.
        return toProjectCard(project, { status: null, git: null, error: (err as Error).message });
      }
    }),
  );
  return { projects: cards, generatedAt: now().toISOString() };
}
