/**
 * Polls GET /api/git/status for the working-tree dirty state that gates
 * hench's autonomous runs (performPreRunCommitGateIfNeeded, packages/hench)
 * — surfaced here since the dashboard previously had no visibility into it
 * at all, and a run refusing to start against a dirty tree looked like an
 * opaque failure.
 */

import { useState, useCallback, useEffect } from "preact/hooks";
import { usePolling } from "../views/use-polling.js";

export type GitFileStatus =
  | "modified" | "added" | "deleted" | "renamed" | "untracked" | "unmerged" | "other";

/** Which tool owns a dirty file. Mirrors server/routes-git.ts. */
export type GitFileOrigin = "prd" | "analysis" | "other";

export interface GitStatusFile {
  path: string;
  code: string;
  status: GitFileStatus;
  origin: GitFileOrigin;
}

export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  dirty: boolean;
  files: GitStatusFile[];
  /** The one origin every dirty file shares, or null when clean or mixed. */
  scope: GitFileOrigin | null;
}

const POLL_INTERVAL_MS = 15_000;

/** Fired on `window` when the dashboard switched the checkout's branch, so the status is re-read now rather than on the next poll. */
export const BRANCH_SWITCHED_EVENT = "ndx:branch-switched";

export function announceBranchSwitched(): void {
  window.dispatchEvent(new CustomEvent(BRANCH_SWITCHED_EVENT));
}

export function useGitStatus(): { status: GitStatus | null; refetch: () => Promise<void> } {
  const [status, setStatus] = useState<GitStatus | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/git/status");
      if (!res.ok) return;
      setStatus(await res.json() as GitStatus);
    } catch {
      // Non-fatal — keeps the last known status until the next tick.
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);
  useEffect(() => {
    const onSwitched = () => { void fetchStatus(); };
    window.addEventListener(BRANCH_SWITCHED_EVENT, onSwitched);
    return () => window.removeEventListener(BRANCH_SWITCHED_EVENT, onSwitched);
  }, [fetchStatus]);
  usePolling("git-status", fetchStatus, POLL_INTERVAL_MS);

  return { status, refetch: fetchStatus };
}
