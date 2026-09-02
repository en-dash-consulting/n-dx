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

export interface GitStatusFile {
  path: string;
  code: string;
  status: GitFileStatus;
}

export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  dirty: boolean;
  files: GitStatusFile[];
}

const POLL_INTERVAL_MS = 15_000;

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
  usePolling("git-status", fetchStatus, POLL_INTERVAL_MS);

  return { status, refetch: fetchStatus };
}
