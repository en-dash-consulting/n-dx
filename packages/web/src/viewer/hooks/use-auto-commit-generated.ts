/**
 * Commit a dirty tree automatically when every file in it was generated.
 *
 * Backs the `git.autoCommitGenerated` toggle. It fires only when the working
 * tree is homogeneous — all PRD files, or all SourceVision scan output — so a
 * tree holding any of the user's own work is left alone. The commit message is
 * a constant chosen by the server for the scope.
 *
 * This is policy, not presentation, so it lives beside the toggle read in
 * `main.ts` rather than inside `GitStatusChip`, which stays a component that
 * renders what it is given and issues no requests on mount.
 *
 * The server re-reads the toggle and re-derives the paths from its own `git
 * status` before acting, so a stale `enabled` here cannot cause a commit, and
 * a tree that stopped being homogeneous between the poll and the request is
 * refused rather than swept up.
 */
import { useEffect, useRef } from "preact/hooks";

import type { GitStatus } from "./use-git-status.js";

export function useAutoCommitGenerated(
  status: GitStatus | null,
  enabled: boolean,
  onCommitted: () => void,
): void {
  /**
   * The exact dirty tree a commit was last fired for. A failure does not clear
   * it, so a tree the server refuses is attempted once rather than on every
   * poll; the next real change to the tree produces a new key and a new try.
   */
  const firedFor = useRef<string | null>(null);

  const scope = status?.scope;
  const eligible =
    enabled && !!status?.dirty && (scope === "prd" || scope === "analysis");
  const dirtyKey = eligible
    ? `${scope}:${status!.files.map((f) => f.code + f.path).join("|")}`
    : null;

  useEffect(() => {
    if (!dirtyKey || firedFor.current === dirtyKey) return;
    firedFor.current = dirtyKey;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/git/commit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope, auto: true }),
        });
        if (!cancelled && res.ok) onCommitted();
      } catch {
        // Non-fatal: the panel stays exactly as it was, for the user to
        // commit by hand. The server is the authority on whether this was
        // allowed, and it has already declined.
      }
    })();

    return () => { cancelled = true; };
  }, [dirtyKey, scope, onCommitted]);
}
