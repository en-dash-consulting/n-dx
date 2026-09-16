/**
 * Polls GET /api/worktrees for the repository's worktrees — the data behind
 * the Sessions tray.
 *
 * Read-only and repository-wide: unlike almost every other viewer fetch this
 * one is deliberately *not* addressed to a workspace, because its subject is
 * the set of them. It does not switch the dashboard's workspace either — the
 * tray links to runs, it does not navigate between checkouts.
 *
 * Refreshed on `hench:run-changed` as well as on the poll tick, since a run
 * starting or finishing in another worktree is the change most worth seeing
 * promptly. That subscription also fires for task-execution progress, which
 * is throttled to a few hundred milliseconds, so refetches are floored at the
 * route's own cache TTL — a faster request can only return the cached answer.
 */

import { useState, useCallback, useEffect, useRef } from "preact/hooks";
import { usePolling } from "../views/use-polling.js";
import { useHenchRunsLiveRefresh } from "./use-hench-runs-live-refresh.js";

/** Mirrors WorktreeLatestRun in server/routes-worktrees.ts. */
export interface WorktreeLatestRun {
  id: string;
  status: string;
  taskTitle: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

/** Mirrors WorktreeRunsSummary in server/routes-worktrees.ts. */
export interface WorktreeRunsSummary {
  total: number;
  running: number;
  lastFinishedAt: string | null;
  latest: WorktreeLatestRun | null;
}

/** Mirrors WorktreeEntry in server/routes-worktrees.ts. */
export interface WorktreeEntry {
  path: string;
  branch: string | null;
  head: string | null;
  isAnchor: boolean;
  isServed: boolean;
  detached: boolean;
  bare: boolean;
  dirty: boolean | null;
  dirtyFiles: number | null;
  runs: WorktreeRunsSummary;
  server: { pidFile: boolean; pid: number | null; port: number | null };
}

/** Matches the git-status tray — both are repository facts, not hot data. */
const POLL_INTERVAL_MS = 15_000;

/** The route caches its whole answer for 5s; asking faster cannot learn anything. */
const MIN_REFETCH_INTERVAL_MS = 5_000;

export function useWorktrees(): { worktrees: WorktreeEntry[] | null; refetch: () => Promise<void> } {
  const [worktrees, setWorktrees] = useState<WorktreeEntry[] | null>(null);
  const lastFetchRef = useRef(0);

  const fetchWorktrees = useCallback(async () => {
    lastFetchRef.current = Date.now();
    try {
      const res = await fetch("/api/worktrees");
      if (!res.ok) return;
      const json = await res.json();
      // Outside a repository the route answers `[]` — an empty list, not an
      // error, and the tray renders nothing for it.
      if (Array.isArray(json)) setWorktrees(json as WorktreeEntry[]);
    } catch {
      // Non-fatal — the last known list stays until the next tick.
    }
  }, []);

  /** Live refresh, floored at the route's cache TTL. */
  const refreshFromSocket = useCallback(() => {
    if (Date.now() - lastFetchRef.current < MIN_REFETCH_INTERVAL_MS) return;
    void fetchWorktrees();
  }, [fetchWorktrees]);

  useEffect(() => { void fetchWorktrees(); }, [fetchWorktrees]);
  usePolling("worktrees", fetchWorktrees, POLL_INTERVAL_MS);
  useHenchRunsLiveRefresh(refreshFromSocket);

  return { worktrees, refetch: fetchWorktrees };
}
