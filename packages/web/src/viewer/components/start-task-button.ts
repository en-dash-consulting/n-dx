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
}

export function StartTaskButton({ taskId, onStarted, label = "Start Task" }: StartTaskButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStart = useCallback(async (e: Event) => {
    e.stopPropagation();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/hench/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
  }, [taskId, onStarted]);

  return h("div", { class: "start-task-wrapper" },
    h("button", {
      class: "start-task-btn",
      onClick: handleStart,
      disabled: loading,
      "aria-label": "Run this task with the agent",
    }, loading ? "Starting…" : label),
    error
      ? h("div", { class: "start-task-error", role: "alert" }, error)
      : null,
  );
}
