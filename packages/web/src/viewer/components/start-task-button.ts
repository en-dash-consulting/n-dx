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
import { queuedReason } from "./prepare-task-model.js";

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
}

export function StartTaskButton({ taskId, onStarted, label = "Start Task", workspace, ariaLabel, navigateTo }: StartTaskButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when the server reported a refusal `rex migrate-slugs` would fix. */
  const [canMigrate, setCanMigrate] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
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
      // 202 from the hub's queue: accepted, not started. Say where it stands.
      if (data.queued === true) {
        setNotice(`Queued — position ${data.position}: ${queuedReason(String(data.reason))}.`);
        return;
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

  const openLive = useCallback((id: string) => {
    setPrepFor(null);
    onStarted();
    if (navigateTo) navigateTo("live-task", { taskId: id });
    else window.location.assign(appUrl(`/live/task/${encodeURIComponent(id)}`));
  }, [navigateTo, onStarted]);

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
            h("button", { type: "button", role: "menuitem", onClick: handleStartNow }, "Start now"),
          )
        : null,
    ),
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
    prepFor
      ? h(PrepareTaskModal, {
          key: prepFor.taskId,
          taskId: prepFor.taskId,
          workspace: prepFor.workspace,
          onClose: () => setPrepFor(null),
          onOpenLive: openLive,
        })
      : null,
  );
}
