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
 * ## Run modes
 *
 * With `runModes`, the button carries a mode picker: one task, a fixed number
 * of tasks, or a loop that runs until the queue is empty. These are the
 * `--iterations` and `--loop` flags `hench run` has always had — the dashboard
 * simply had no way to reach them, so working through a queue meant leaving
 * the dashboard for a terminal.
 *
 * Deliberately opt-in rather than always on. The Workspaces board renders one
 * of these per worktree row, where the question is "start this worktree", not
 * "how much work should this click commit to"; a picker on every row would be
 * offering a decision nobody is making there.
 *
 * The mode is a property of the *click*, not of the component: it resets to
 * `single` after a successful start, so a loop is never launched by a stale
 * selection the operator set minutes ago and forgot.
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
  /**
   * Offer the run-mode picker beside the button (one task / N tasks / loop).
   *
   * For the "start the next actionable task" entry points. Off by default so
   * callers that mean one specific task keep a single unambiguous button.
   */
  runModes?: boolean;
}

/** How many tasks one click works through. Mirrors the server's `RunMode`. */
export type RunMode = "single" | "iterations" | "loop";

/**
 * Must match `MAX_DASHBOARD_ITERATIONS` in routes-hench.ts, which rejects
 * anything past it with a 400. Clamping here as well means the operator is
 * stopped by a number input that will not go higher, rather than by an error
 * after the click.
 */
export const MAX_ITERATIONS = 25;

/** Default task count when the operator picks "a set number" without typing one. */
const DEFAULT_ITERATIONS = 3;

export function StartTaskButton({ taskId, onStarted, label = "Start Task", workspace, ariaLabel, runModes = false }: StartTaskButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when the server reported a refusal `rex migrate-slugs` would fix. */
  const [canMigrate, setCanMigrate] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<RunMode>("single");
  const [iterations, setIterations] = useState(DEFAULT_ITERATIONS);

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
      const { ok, status, data } = await post(
        mode === "single"
          ? {}
          : mode === "iterations"
            ? { mode, iterations }
            : { mode },
      );
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
      // The picker is per-click, not a sticky preference: leaving it on "loop"
      // would turn the next unrelated click into another loop.
      setMode("single");
      onStarted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start task");
      setTimeout(() => setError(null), 4000);
    } finally {
      setLoading(false);
    }
  }, [post, onStarted, mode, iterations]);

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

  // What the button commits to, said on the button itself. A picker that only
  // changes hidden behaviour is how someone launches a queue-long run believing
  // they started one task.
  const modeLabel =
    mode === "loop" ? `${label} · until done` :
    mode === "iterations" ? `${label} · ${iterations} tasks` :
    label;

  const modeAriaLabel =
    mode === "loop" ? "Run tasks continuously until the queue is empty, starting with this one" :
    mode === "iterations" ? `Run ${iterations} tasks in a row, starting with this one` :
    (ariaLabel ?? "Run this task with the agent");

  return h("div", { class: "start-task-wrapper" },
    h("div", { class: "start-task-row" },
      h("button", {
        class: "start-task-btn",
        onClick: handleStart,
        disabled: loading || migrating,
        "aria-label": modeAriaLabel,
      }, loading ? "Starting…" : modeLabel),
      runModes
        ? h("label", { class: "start-task-mode" },
            h("span", { class: "sr-only" }, "How many tasks to run"),
            h("select", {
              class: "start-task-mode-select",
              value: mode,
              disabled: loading || migrating,
              onClick: (e: Event) => e.stopPropagation(),
              onChange: (e: Event) => {
                setMode((e.target as HTMLSelectElement).value as RunMode);
              },
            },
              h("option", { value: "single" }, "This task"),
              h("option", { value: "iterations" }, "A set number"),
              h("option", { value: "loop" }, "Until done"),
            ),
          )
        : null,
      runModes && mode === "iterations"
        ? h("label", { class: "start-task-mode" },
            h("span", { class: "sr-only" }, "How many tasks"),
            h("input", {
              class: "start-task-iterations",
              type: "number",
              min: 2,
              max: MAX_ITERATIONS,
              step: 1,
              value: iterations,
              disabled: loading || migrating,
              onClick: (e: Event) => e.stopPropagation(),
              onInput: (e: Event) => {
                const next = Number((e.target as HTMLInputElement).value);
                // The server refuses anything outside 2..MAX with a 400, so
                // the input is clamped rather than allowed to submit a value
                // that can only come back as an error.
                if (!Number.isFinite(next)) return;
                setIterations(Math.min(MAX_ITERATIONS, Math.max(2, Math.trunc(next))));
              },
            }),
          )
        : null,
    ),
    runModes && mode === "loop"
      ? h("div", { class: "start-task-mode-hint" },
          "Runs task after task until nothing is actionable. Stop it from the run's page.")
      : null,
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
