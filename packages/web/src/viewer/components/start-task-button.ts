/**
 * Start Task — a split button. The primary click opens the Prepare task modal
 * for the task; the menu's "Start now" is the one-click run with no options
 * (`POST /api/hench/execute {taskId}`), for a reader who wants what the project
 * config already says. The agent sets the task to in_progress itself; callers
 * refresh their own data via `onStarted`.
 *
 * Mounted by the Rex Dashboard's Up Next card, the Hench Runs empty state, the
 * Live idle card, each Workspaces card (which passes `workspace`, sent as
 * `X-Ndx-Workspace` by both the modal and Start now) and the PRD task panel.
 *
 * A hub that queues the run answers 202 `{queued, position, reason}`. That is
 * not a start: Start now shows the position and the reason, and does not call
 * `onStarted`.
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
import { useState, useCallback, useEffect } from "preact/hooks";
import type { NavigateTo } from "../types.js";
import { appUrl } from "../base-path.js";
import { PrepareTaskModal } from "./prepare-task-modal.js";
import { QueuedNotice } from "./queued-notice.js";
import type { QueuedReply } from "./prepare-task-model.js";
import { MAX_DASHBOARD_ITERATIONS, MIN_DASHBOARD_ITERATIONS } from "../external.js";
import type { RunMode } from "../external.js";

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
   * Opens the task's Live page after the modal starts a run. Without it the
   * button loads `/live/task/<id>` as a page navigation.
   */
  navigateTo?: NavigateTo;
  /**
   * The task's Live page in `workspace` when that is not the viewer's own.
   * Set, a start (and the queued link) does a full navigation to it, because
   * the SPA's Live view reads the viewer's workspace, not the run's. Unset,
   * Live opens in-app.
   */
  liveHref?: (taskId: string) => string;
  /**
   * Offer the run-mode picker beside the button (one task / N tasks / loop).
   *
   * For the "start the next actionable task" entry points. Off by default so
   * callers that mean one specific task keep a single unambiguous button.
   *
   * The picker governs "Start now", not the Prepare task modal: the modal
   * configures one run of one task in detail, while the mode says how many
   * tasks the click works through. Keeping them apart is why the modal's
   * printed command line stays the command the modal itself would start.
   */
  runModes?: boolean;
}

/** Default task count when the operator picks "a set number" without typing one. */
const DEFAULT_ITERATIONS = 3;

export function StartTaskButton({ taskId, onStarted, label = "Start Task", workspace, ariaLabel, navigateTo, liveHref, runModes = false }: StartTaskButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when the server reported a refusal `rex migrate-slugs` would fix. */
  const [canMigrate, setCanMigrate] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<RunMode>("single");
  const [iterations, setIterations] = useState(DEFAULT_ITERATIONS);
  /** The hub's 202 for a Start now it queued; the notice then follows the hub queue. */
  const [queued, setQueued] = useState<{ reply: QueuedReply; taskId: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  /**
   * What the open modal was opened for, captured at click. The host's `taskId`
   * moves under polling hosts (Up Next, Live idle), and a modal that followed
   * it would keep one task's edits while posting another task's id.
   */
  const [prepFor, setPrepFor] = useState<{ taskId: string; workspace?: string } | null>(null);
  const menuId = `start-menu-${taskId}`;

  // Escape closes an open menu.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

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

  const handleStartNow = useCallback(async (e: Event) => {
    e.stopPropagation();
    setMenuOpen(false);
    setLoading(true);
    setError(null);
    setNotice(null);
    setQueued(null);
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
      // would turn the next unrelated click into another loop. Reset before the
      // queued branch below returns — a queued run is still a spent click, and
      // the hub will start it with the mode it was queued with.
      setMode("single");
      // 202 from the hub's queue: accepted, not started. Say where it stands.
      if (data.queued === true) {
        setQueued({ reply: data as unknown as QueuedReply, taskId });
        return;
      }
      onStarted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start task");
      setTimeout(() => setError(null), 4000);
    } finally {
      setLoading(false);
    }
  }, [post, onStarted, taskId, mode, iterations]);

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

  const openLive = useCallback((id: string) => {
    setPrepFor(null);
    onStarted();
    if (liveHref) window.location.assign(liveHref(id));
    else if (navigateTo) navigateTo("live-task", { taskId: id });
    else window.location.assign(appUrl(`/live/task/${encodeURIComponent(id)}`));
  }, [navigateTo, liveHref, onStarted]);

  // What Start now commits to, said on the menu item itself. A picker that only
  // changes hidden behaviour is how someone launches a queue-long run believing
  // they started one task.
  const startNowLabel =
    mode === "loop" ? "Start now · until done" :
    mode === "iterations" ? `Start now · ${iterations} tasks` :
    "Start now";

  const startNowAriaLabel =
    mode === "loop" ? "Run tasks continuously until the queue is empty, starting with this one" :
    mode === "iterations" ? `Run ${iterations} tasks in a row, starting with this one` :
    undefined;

  const busy = loading || migrating;
  return h("div", { class: "start-task-wrapper" },
    h("div", { class: "ready-split" },
      h("button", {
        class: "start-task-btn start-task-primary",
        onClick: (e: Event) => { e.stopPropagation(); setMenuOpen(false); setPrepFor({ taskId, workspace }); },
        disabled: busy,
        "aria-label": ariaLabel ?? "Prepare a run of this task with the agent",
      }, loading ? "Starting…" : label),
      h("button", {
        class: "start-task-btn start-task-caret",
        onClick: (e: Event) => { e.stopPropagation(); setMenuOpen(!menuOpen); },
        disabled: busy,
        "aria-haspopup": "menu",
        "aria-expanded": String(menuOpen),
        "aria-controls": menuId,
        "aria-label": ariaLabel ? `More ways to run: ${ariaLabel}` : "More ways to run this task",
      }, "▾"),
      menuOpen
        ? h("div", { class: "ready-menu", id: menuId, role: "menu" },
            h("button", {
              type: "button",
              role: "menuitem",
              onClick: handleStartNow,
              ...(startNowAriaLabel ? { "aria-label": startNowAriaLabel } : {}),
            }, startNowLabel),
          )
        : null,
    ),
    // The picker rides with Start now, not with the Prepare task modal: the
    // modal configures one run of one task and prints the command line for it,
    // while the mode says how many tasks the click works through.
    runModes
      ? h("div", { class: "start-task-row" },
          h("label", { class: "start-task-mode" },
            h("span", { class: "sr-only" }, "How many tasks to run"),
            h("select", {
              class: "start-task-mode-select",
              value: mode,
              disabled: busy,
              onClick: (e: Event) => e.stopPropagation(),
              onChange: (e: Event) => {
                setMode((e.target as HTMLSelectElement).value as RunMode);
              },
            },
              h("option", { value: "single" }, "This task"),
              h("option", { value: "iterations" }, "A set number"),
              h("option", { value: "loop" }, "Until done"),
            ),
          ),
          mode === "iterations"
            ? h("label", { class: "start-task-mode" },
                h("span", { class: "sr-only" }, "How many tasks"),
                h("input", {
                  class: "start-task-iterations",
                  type: "number",
                  min: MIN_DASHBOARD_ITERATIONS,
                  max: MAX_DASHBOARD_ITERATIONS,
                  step: 1,
                  value: iterations,
                  disabled: busy,
                  onClick: (e: Event) => e.stopPropagation(),
                  onInput: (e: Event) => {
                    const next = Number((e.target as HTMLInputElement).value);
                    // The server refuses anything outside 2..MAX with a 400, so
                    // the input is clamped rather than allowed to submit a value
                    // that can only come back as an error.
                    if (!Number.isFinite(next)) return;
                    setIterations(Math.min(MAX_DASHBOARD_ITERATIONS, Math.max(MIN_DASHBOARD_ITERATIONS, Math.trunc(next))));
                  },
                }),
              )
            : null,
        )
      : null,
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
    queued
      ? h(QueuedNotice, {
          reply: queued.reply,
          taskId: queued.taskId,
          onOpenLive: openLive,
          liveHref,
          onDismiss: () => setQueued(null),
        })
      : null,
    prepFor
      ? h(PrepareTaskModal, {
          key: prepFor.taskId,
          taskId: prepFor.taskId,
          workspace: prepFor.workspace,
          onClose: () => setPrepFor(null),
          onOpenLive: openLive,
          liveHref,
        })
      : null,
  );
}
