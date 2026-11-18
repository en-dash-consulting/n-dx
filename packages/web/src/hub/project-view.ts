/**
 * The hub's view of a registered project, and what registering and
 * unregistering one take and return.
 *
 * Types only, so session-host.ts, tracker-sync.ts, overview.ts and the routes
 * can read them without importing hub.ts, which imports each of those:
 * reading them from hub.ts closed an import cycle through every one. hub.ts
 * re-exports them.
 *
 * @module hub/project-view
 */

import type { ChildStatus } from "./children.js";
import type { ProjectRecord } from "./registry.js";

/** What `POST /api/hub/projects` accepts. */
export interface RegisterProjectInput {
  id: string;
  repoRoot: string;
  /** A worktree of the repository to record under the project; `repoRoot` is always recorded. */
  worktree?: string;
  name?: string;
}

/** A registry record joined with its supervisor's live status. */
export interface ProjectView extends ProjectRecord {
  /** Informational only: always the hub's own binary, never persisted. */
  ndxBin: string;
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
