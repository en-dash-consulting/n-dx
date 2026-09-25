/**
 * Start Task button — launches an autonomous hench run for a single task
 * via POST /api/hench/execute. The agent sets the task to in_progress
 * itself; callers refresh their own data via `onStarted` and pick up the
 * new run through their existing polling (WebSocket broadcasts land too).
 *
 * Shared by the Rex Dashboard's "Up Next" card and the Hench Runs view's
 * empty state — both are "start the next actionable task" entry points
 * that should behave identically.
 *
 * It also carries the dashboard half of the PRD tree's slug-rule gate. A tree
 * this build would re-slug answers 412, and when the server says a migration
 * would fix it, this offers to run one — as a *second*, explicit request, which
 * is what consent looks like on a server that has no session and no auth. The
 * migration stops there by design: it does not start the task, because the
 * whole-tree rename has to get a commit of its own rather than be swept into a
 * "task completed" one. @see packages/web/src/server/routes-hench.ts
 */

import { h } from "preact";
import { useState, useCallback } from "preact/hooks";

export interface StartTaskButtonProps {
  taskId: string;
  onStarted: () => void;
  /** Button label while idle. Defaults to "Start Task". */
  label?: string;
  /**
   * Run in this workspace instead of the one the viewer is mounted under.
   *
   * Sent as `X-Ndx-Workspace`, which the server reads ahead of the `/w/<key>/`
   * URL slot, so the run's cwd is that worktree. Left unset the request is the
   * viewer's own workspace, which is what every other caller wants.
   */
  workspace?: string;
  /** Accessible name. Defaults to a generic one; set it when several buttons share a page. */
  ariaLabel?: string;
}

export function StartTaskButton({ taskId, onStarted, label = "Start Task", workspace, ariaLabel }: StartTaskButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when the server reported a refusal `rex migrate-slugs` would fix. */
  const [canMigrate, setCanMigrate] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const post = useCallback(async (payload: Record<string, unknown>) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (workspace) headers["X-Ndx-Workspace"] = workspace;
    const res = await fetch("/api/hench/execute", {
      method: "POST",
      headers,
      body: JSON.stringify({ taskId, ...payload }),
    });
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    return { ok: res.ok, status: res.status, data } as {
      ok: boolean;
      status: number;
      data: Record<string, unknown>;
    };
  }, [taskId, workspace]);

  const handleStart = useCallback(async (e: Event) => {
    e.stopPropagation();
    setLoading(true);
    setError(null);
    setNotice(null);
    setCanMigrate(false);
    try {
      const { ok, status, data } = await post({});
      if (!ok) {
        const message = (data.error as string) || `Failed (${status})`;
        // A refusal with a fix attached must stay on screen until it is acted
        // on. The 4s auto-clear below is for transient failures; wiping a
        // multi-line explanation of why the repository is wrong, along with the
        // button that fixes it, is how the offer would go unnoticed.
        if (data.migratable === true) {
          setError(message);
          setCanMigrate(true);
          return;
        }
        throw new Error(message);
      }
      onStarted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start task");
      setTimeout(() => setError(null), 4000);
    } finally {
      setLoading(false);
    }
  }, [post, onStarted]);

  const handleMigrate = useCallback(async (e: Event) => {
    e.stopPropagation();
    setMigrating(true);
    try {
      const { ok, status, data } = await post({ migrateSlugs: true });
      if (!ok) {
        setError((data.error as string) || `Migration failed (${status})`);
        // 409: the tree no longer needs migrating, so the offer is stale.
        if (status === 409) setCanMigrate(false);
        return;
      }
      // Deliberately does not call `onStarted` — nothing was started. The
      // operator reviews and commits the rename, then presses Start again.
      setCanMigrate(false);
      setError(null);
      setNotice((data.message as string) || "The PRD tree was migrated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Migration failed");
    } finally {
      setMigrating(false);
    }
  }, [post]);

  return h("div", { class: "start-task-wrapper" },
    h("button", {
      class: "start-task-btn",
      onClick: handleStart,
      disabled: loading || migrating,
      "aria-label": ariaLabel ?? "Run this task with the agent",
    }, loading ? "Starting…" : label),
    error
      ? h("div", { class: "start-task-error", role: "alert" }, error)
      : null,
    canMigrate
      ? h("button", {
          class: "start-task-migrate-btn",
          onClick: handleMigrate,
          disabled: migrating,
          "aria-label": "Migrate the PRD tree to this build's slug rule, without starting the task",
        }, migrating ? "Migrating…" : "Migrate the PRD tree")
      : null,
    notice
      ? h("div", { class: "start-task-notice", role: "status" }, notice)
      : null,
  );
}
