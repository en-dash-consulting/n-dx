/**
 * Start Task button — launches an autonomous hench run for a single task
 * via POST /api/hench/execute. The agent sets the task to in_progress
 * itself; callers refresh their own data via `onStarted` and pick up the
 * new run through their existing polling (WebSocket broadcasts land too).
 *
 * Shared by the Rex Dashboard's "Up Next" card and the Hench Runs view's
 * empty state — both are "start the next actionable task" entry points
 * that should behave identically.
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

  const handleStart = useCallback(async (e: Event) => {
    e.stopPropagation();
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (workspace) headers["X-Ndx-Workspace"] = workspace;
      const res = await fetch("/api/hench/execute", {
        method: "POST",
        headers,
        body: JSON.stringify({ taskId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(data.error || `Failed (${res.status})`);
      }
      onStarted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start task");
      setTimeout(() => setError(null), 4000);
    } finally {
      setLoading(false);
    }
  }, [taskId, onStarted, workspace]);

  return h("div", { class: "start-task-wrapper" },
    h("button", {
      class: "start-task-btn",
      onClick: handleStart,
      disabled: loading,
      "aria-label": ariaLabel ?? "Run this task with the agent",
    }, loading ? "Starting…" : label),
    error
      ? h("div", { class: "start-task-error", role: "alert" }, error)
      : null,
  );
}
