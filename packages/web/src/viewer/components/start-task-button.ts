/**
 * Start Task — a split button. The primary click starts the run now, with the
 * task's saved run settings; the ▾ arrow opens the Prepare task modal, where
 * those settings are read, changed for one run, or saved on the task. The
 * agent sets the task to in_progress itself; callers refresh their own data
 * via `onStarted`.
 *
 * Mounted by the Rex Dashboard's Up Next card, the Hench Runs empty state, the
 * Live idle card, each Workspaces card (which passes `workspace`, sent as
 * `X-Ndx-Workspace` by every request the click makes and by the modal) and
 * the PRD task panel.
 *
 * ## The one click
 *
 * The common case is "run it with the settings already chosen", so that is the
 * primary click, and choosing settings is the arrow. The click:
 *
 * 1. Reads `GET /api/hench/prep/:taskId` — the same resolve the modal shows.
 * 2. A task with a saved `run` block goes straight to
 *    `POST /api/hench/execute {taskId}`. The request carries no options, so
 *    nothing outranks the block: `ndx work` applies it (CLI flag > task's
 *    `run` > `hench.*` > `llm.*`).
 * 3. A task with none first gets one: `defaultsRunBlockOf` — the project
 *    defaults the modal would show — written with `PUT /api/hench/prep/:taskId`
 *    and the version the read reported, exactly as the modal's Save does. Then
 *    the execute. The settings the run used are now on the task, where the
 *    modal shows them as "saved on task" and they can be changed.
 *
 * Nothing is saved when the read reports a refusal (a dirty tree, a PRD tree
 * this build would re-slug, …): the execute is posted as before, so the
 * server's own refusal is what the reader sees — including the 412 migration
 * offer below — and a task that never ran does not gain settings. Nor when the
 * server predates saving (the read carries no `savedVersion`): the run starts
 * as a plain execute.
 *
 * **When the save fails, nothing starts.** A run must not begin on settings
 * that were meant to be recorded on the task and were not, so the reason stays
 * on screen (it is not cleared after a few seconds like a transient refusal)
 * and the arrow is the way on. A 409 conflict means someone saved settings on
 * the task between the read and the write: the click does not start a run on
 * settings the reader has never seen, and says so — a second click finds the
 * saved block and runs with it. A failed read stops the same way, since without
 * it the click cannot tell whether the task carries settings.
 *
 * A hub that queues the run answers 202 `{queued, position, reason}`. That is
 * not a start: the button shows the position and the reason, and does not call
 * `onStarted`.
 *
 * ## Run modes
 *
 * With `runModes`, the button carries a mode picker: one task, a fixed number
 * of tasks, or a loop that runs until the queue is empty. These are the
 * `--iterations` and `--loop` flags `hench run` has always had — the dashboard
 * simply had no way to reach them, so working through a queue meant leaving
 * the dashboard for a terminal. The mode governs the primary click and is
 * named on it ("Start working · until done"). The run starts on this task, so
 * it is this task that gains the defaults when it has none; each task the run
 * moves on to resolves its own settings.
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
import { useState, useCallback, useEffect, useRef } from "preact/hooks";
import type { NavigateTo } from "../types.js";
import { appUrl } from "../base-path.js";
import { PrepareTaskModal } from "./prepare-task-modal.js";
import { QueuedNotice } from "./queued-notice.js";
import { defaultsRunBlockOf, hasSavedRun } from "./prepare-task-model.js";
import type { PrepResponse, QueuedReply } from "./prepare-task-model.js";
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
   * URL slot, so the run's cwd is that worktree and the settings are saved on
   * that worktree's PRD. Left unset the request is the viewer's own workspace,
   * which is what every other caller wants.
   */
  workspace?: string;
  /** Accessible name of the primary (start) button. Defaults to a generic one; set it when several buttons share a page. */
  ariaLabel?: string;
  /**
   * Opens the task's Live page after a start. Without it the modal's start
   * loads `/live/task/<id>` as a page navigation, and the primary click stays
   * where it is.
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
   * The picker governs the primary click, not the Prepare task modal: the
   * modal configures one run of one task in detail, while the mode says how
   * many tasks the click works through. Keeping them apart is why the modal's
   * printed command line stays the command the modal itself would start.
   */
  runModes?: boolean;
}

/** Default task count when the operator picks "a set number" without typing one. */
const DEFAULT_ITERATIONS = 3;

/** How long a transient refusal stays on screen. */
const TRANSIENT_ERROR_MS = 4000;

type Reply = { ok: boolean; status: number; data: Record<string, unknown> };

export function StartTaskButton({ taskId, onStarted, label = "Start Task", workspace, ariaLabel, navigateTo, liveHref, runModes = false }: StartTaskButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when the server reported a refusal `rex migrate-slugs` would fix. */
  const [canMigrate, setCanMigrate] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<RunMode>("single");
  const [iterations, setIterations] = useState(DEFAULT_ITERATIONS);
  /** The hub's 202 for a start it queued; the notice then follows the hub queue. */
  const [queued, setQueued] = useState<{ reply: QueuedReply; taskId: string } | null>(null);
  /**
   * What the open modal was opened for, captured at click. The host's `taskId`
   * moves under polling hosts (Up Next, Live idle), and a modal that followed
   * it would keep one task's edits while posting another task's id.
   */
  const [prepFor, setPrepFor] = useState<{ taskId: string; workspace?: string } | null>(null);
  /**
   * The pending auto-clear of a transient error. Cancelled on each click, so a
   * timer left by an earlier failure cannot wipe a later error that is meant
   * to stay (a failed save, a migratable refusal).
   */
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClear = useCallback(() => {
    if (clearTimer.current !== null) clearTimeout(clearTimer.current);
    clearTimer.current = null;
  }, []);
  useEffect(() => cancelClear, [cancelClear]);

  // GET with no body, POST with one, PUT when the caller says so (saving the
  // task's settings). The workspace header travels on all three: a click for
  // another worktree reads, saves and starts in that worktree.
  const request = useCallback(async (path: string, body?: unknown, method?: "PUT"): Promise<Reply> => {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (workspace) headers["X-Ndx-Workspace"] = workspace;
    const res = await fetch(path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    return { ok: res.ok, status: res.status, data: data as Record<string, unknown> };
  }, [workspace]);

  const execute = useCallback(
    (payload: Record<string, unknown>) => request("/api/hench/execute", { taskId, ...payload }),
    [request, taskId],
  );

  /**
   * Make sure the task carries the settings this run will use: nothing to do
   * when it has a saved block, else save the project defaults on it. Resolves
   * null to go on, or the reason the run must not start.
   */
  const ensureSavedSettings = useCallback(async (): Promise<string | null> => {
    const path = `/api/hench/prep/${encodeURIComponent(taskId)}`;
    try {
      const read = await request(path);
      if (!read.ok) {
        const reason = (read.data.error as string) || `HTTP ${read.status}`;
        return `Could not read this task's run settings, so nothing was started: ${reason}`;
      }
      const prep = read.data as unknown as PrepResponse;
      // A refused run gains no settings; the execute reports the refusal.
      if ((prep.refusals ?? []).length > 0) return null;
      // A server that cannot save reports no version; start as a plain execute.
      if (prep.savedVersion === undefined) return null;
      if (hasSavedRun(prep)) return null;
      const block = defaultsRunBlockOf(prep);
      if (!block) return null;
      const saved = await request(path, { run: block, version: prep.savedVersion }, "PUT");
      if (saved.ok) return null;
      if (saved.status === 409 && saved.data.conflict === true) {
        return "Run settings were saved on this task by someone else just now, so nothing was started. " +
          "Start again to run with them, or open them with the arrow.";
      }
      const reason = (saved.data.error as string) || `HTTP ${saved.status}`;
      return `Could not save the project defaults on this task, so nothing was started: ${reason}`;
    } catch (err) {
      const reason = err instanceof Error ? err.message : "the request failed";
      return `Could not prepare this task's run settings, so nothing was started: ${reason}`;
    }
  }, [request, taskId]);

  const handleStart = useCallback(async (e: Event) => {
    e.stopPropagation();
    cancelClear();
    setLoading(true);
    setError(null);
    setNotice(null);
    setQueued(null);
    setCanMigrate(false);
    try {
      const stop = await ensureSavedSettings();
      if (stop) {
        // Stays until the next click: it says why nothing started.
        setError(stop);
        return;
      }
      const { ok, status, data } = await execute(
        mode === "single"
          ? {}
          : mode === "iterations"
            ? { mode, iterations }
            : { mode },
      );
      if (!ok) {
        const message = (data.error as string) || `Failed (${status})`;
        // A refusal with a fix attached must stay on screen until it is acted
        // on. The auto-clear below is for transient failures; wiping a
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
      if (liveHref) window.location.assign(liveHref(taskId));
      else if (navigateTo) navigateTo("live-task", { taskId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start task");
      clearTimer.current = setTimeout(() => {
        clearTimer.current = null;
        setError(null);
      }, TRANSIENT_ERROR_MS);
    } finally {
      setLoading(false);
    }
  }, [cancelClear, ensureSavedSettings, execute, onStarted, taskId, mode, iterations, liveHref, navigateTo]);

  const handleMigrate = useCallback(async (e: Event) => {
    e.stopPropagation();
    cancelClear();
    setMigrating(true);
    try {
      const { ok, status, data } = await execute({ migrateSlugs: true });
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
  }, [cancelClear, execute]);

  const openLive = useCallback((id: string) => {
    setPrepFor(null);
    onStarted();
    if (liveHref) window.location.assign(liveHref(id));
    else if (navigateTo) navigateTo("live-task", { taskId: id });
    else window.location.assign(appUrl(`/live/task/${encodeURIComponent(id)}`));
  }, [navigateTo, liveHref, onStarted]);

  // What the click commits to, said on the button itself. A picker that only
  // changes hidden behaviour is how someone launches a queue-long run believing
  // they started one task.
  const modeSuffix =
    mode === "loop" ? " · until done" :
    mode === "iterations" ? ` · ${iterations} tasks` :
    "";
  const modeAria =
    mode === "loop" ? "runs tasks continuously until the queue is empty, starting with this one" :
    mode === "iterations" ? `runs ${iterations} tasks in a row, starting with this one` :
    null;
  const startAria = ariaLabel ?? "Start a run of this task now, with its saved run settings";

  const busy = loading || migrating;
  return h("div", { class: "start-task-wrapper" },
    h("div", { class: "ready-split" },
      h("button", {
        class: "start-task-btn start-task-primary",
        onClick: handleStart,
        disabled: busy,
        "aria-label": modeAria ? `${startAria}: ${modeAria}` : startAria,
      }, loading ? "Starting…" : `${label}${modeSuffix}`),
      h("button", {
        class: "start-task-btn start-task-caret",
        onClick: (e: Event) => { e.stopPropagation(); setPrepFor({ taskId, workspace }); },
        disabled: busy,
        "aria-haspopup": "dialog",
        "aria-label": ariaLabel ? `Run settings: ${ariaLabel}` : "Open the run settings for this task",
        title: "Run settings",
      }, "▾"),
    ),
    // The picker rides with the primary click, not with the Prepare task
    // modal: the modal configures one run of one task and prints the command
    // line for it, while the mode says how many tasks the click works through.
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
