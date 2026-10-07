/**
 * Ready to run — the tasks `ndx work --auto` would pick next, at the top of Work.
 *
 * Fed by `GET /api/hench/ready?limit=10`, shown in the order returned. Each row
 * opens the Prepare task modal (the primary button and the title); the split
 * button's menu starts the task at once with no options, or copies the terminal
 * command. A start shows a toast: started (with a link to Live), queued (with its
 * position), or the server's refusal. The list refreshes on the run frames, since
 * a started run takes its task out of the list.
 */

import { h } from "preact";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { useHenchRunsLiveRefresh } from "../hooks/index.js";
import { appUrl } from "../base-path.js";
import { workCommandArgs } from "../external.js";
import { shellWord } from "./prepare-task-model.js";
import { QueuedNotice } from "./queued-notice.js";
import type { QueuedReply } from "./prepare-task-model.js";

const READY_LIMIT = 10;
const TOAST_MS = 8000;

/** One row of the `/api/hench/ready` reply (the server's `ReadyTask`). */
export interface ReadyTask {
  id: string;
  title: string;
  status: string;
  priority: string | null;
  parentChain: string[];
  criteriaCount: number;
  /** In progress with no live run. */
  resume: boolean;
  /**
   * The task carries its own run settings, so it will not run on the project
   * defaults. Absent from a server that predates them.
   */
  saved?: boolean;
}

interface ReadyReply {
  tasks: ReadyTask[];
  dir: string;
}

/** The terminal command Start now would run: `ndx work --task=<id> --auto <dir>`. */
export function readyCommandLine(taskId: string, dir: string): string {
  return ["ndx", ...workCommandArgs({ taskId, options: {}, dir })].map(shellWord).join(" ");
}

interface Toast { text: string; error: boolean; liveTaskId?: string }

export interface ReadyToRunProps {
  /** Open the Prepare task modal for a task. */
  onPrepare: (taskId: string) => void;
  /** Open a task's Live page. */
  onOpenLive: (taskId: string) => void;
  /** Open the PRD, for the empty state's link. */
  onOpenPrd: () => void;
}

const STATUS_ICON: Record<string, { icon: string; label: string }> = {
  pending: { icon: "○", label: "Pending" },
  in_progress: { icon: "◐", label: "In progress" },
};

export function ReadyToRun({ onPrepare, onOpenLive, onOpenPrd }: ReadyToRunProps) {
  const [tasks, setTasks] = useState<ReadyTask[] | null>(null);
  const [dir, setDir] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  /** Start now runs the hub queued, until dismissed. */
  const [queued, setQueued] = useState<Array<{ taskId: string; reply: QueuedReply }>>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/hench/ready?limit=${READY_LIMIT}`);
      if (!res.ok) {
        setError(res.status === 404 ? null : `Could not load the ready list (${res.status})`);
        setTasks([]);
        return;
      }
      const data = (await res.json()) as ReadyReply;
      setTasks(Array.isArray(data.tasks) ? data.tasks : []);
      setDir(typeof data.dir === "string" ? data.dir : "");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the ready list");
      setTasks((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useHenchRunsLiveRefresh(load);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // Escape closes an open menu.
  useEffect(() => {
    if (menuFor === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuFor(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuFor]);

  const say = (next: Toast) => {
    clearTimeout(toastTimer.current);
    setToast(next);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  };

  const startNow = async (task: ReadyTask) => {
    setMenuFor(null);
    setBusyId(task.id);
    try {
      const res = await fetch("/api/hench/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<QueuedReply> & { error?: string };
      if (res.ok && data.queued === true) {
        // Not a toast: it would expire in seconds, and a queued run's position
        // and fate keep changing. The notice follows the hub queue instead.
        const reply = data as QueuedReply;
        setQueued((prev) => [...prev.filter((q) => q.taskId !== task.id), { taskId: task.id, reply }]);
      } else if (res.ok) {
        say({ text: `Started “${task.title}”.`, error: false, liveTaskId: task.id });
      } else {
        say({ text: data.error || `Could not start the task (${res.status})`, error: true });
      }
    } catch (err) {
      say({ text: err instanceof Error ? err.message : "Could not start the task", error: true });
    } finally {
      setBusyId(null);
      void load();
    }
  };

  const copyCommand = async (task: ReadyTask) => {
    setMenuFor(null);
    try {
      await navigator.clipboard.writeText(readyCommandLine(task.id, dir));
      say({ text: "Command copied.", error: false });
    } catch {
      say({ text: "Could not copy — the clipboard refused.", error: true });
    }
  };

  const body = tasks === null
    ? h("p", { class: "ready-empty" }, "Loading…")
    : tasks.length === 0
      ? h("p", { class: "ready-empty" },
          error ?? "Nothing ready to run. ",
          error ? null : h("a", {
            href: appUrl("/prd"),
            onClick: (e: MouseEvent) => { e.preventDefault(); onOpenPrd(); },
          }, "Open the PRD"),
        )
      : h("ul", { class: "ready-list" }, tasks.map((task) => {
          const status = STATUS_ICON[task.status] ?? { icon: "○", label: task.status };
          const menuId = `ready-menu-${task.id}`;
          return h("li", { key: task.id, class: "ready-row", "data-task-id": task.id },
            h("span", { class: `prd-status-icon prd-status-${task.status}`, title: status.label, "aria-label": status.label }, status.icon),
            h("div", { class: "ready-main" },
              h("button", { type: "button", class: "ready-title", onClick: () => onPrepare(task.id) }, task.title),
              h("div", { class: "ready-meta" },
                task.parentChain.length ? h("span", { class: "ready-chain" }, task.parentChain.join(" › ")) : null,
                task.priority ? h("span", { class: `prd-priority-badge prd-priority-${task.priority}` }, task.priority) : null,
                h("span", null, `${task.criteriaCount} ${task.criteriaCount === 1 ? "criterion" : "criteria"}`),
                task.resume ? h("span", { class: "ready-resume" }, "in progress · no live run") : null,
              ),
            ),
            h("div", { class: "ready-split" },
              h("button", {
                type: "button",
                class: "prep-btn prep-btn-primary ready-primary",
                disabled: busyId === task.id,
                onClick: () => onPrepare(task.id),
              }, task.resume ? "Resume…" : "Prepare…"),
              h("button", {
                type: "button",
                class: "prep-btn prep-btn-primary ready-caret",
                "aria-haspopup": "menu",
                "aria-expanded": String(menuFor === task.id),
                "aria-controls": menuId,
                "aria-label": `More ways to run ${task.title}`,
                onClick: () => setMenuFor(menuFor === task.id ? null : task.id),
              }, "▾"),
              menuFor === task.id
                ? h("div", { class: "ready-menu", id: menuId, role: "menu" },
                    h("button", { type: "button", role: "menuitem", onClick: () => void startNow(task) }, "Start now"),
                    h("button", { type: "button", role: "menuitem", onClick: () => void copyCommand(task) }, "Copy terminal command"),
                  )
                : null,
            ),
          );
        }));

  return h("section", { class: "ready-to-run", "aria-labelledby": "ready-to-run-title" },
    h("h2", { id: "ready-to-run-title", class: "ready-title-head" }, "Ready to run"),
    body,
    queued.map((q) => h(QueuedNotice, {
      key: q.taskId,
      reply: q.reply,
      taskId: q.taskId,
      onOpenLive,
      onDismiss: () => setQueued((prev) => prev.filter((x) => x.taskId !== q.taskId)),
    })),
    toast
      ? h("div", { class: `ready-toast${toast.error ? " ready-toast-error" : ""}`, role: toast.error ? "alert" : "status" },
          toast.text,
          toast.liveTaskId
            ? h("span", null, " ", h("a", {
                href: appUrl(`/live/task/${encodeURIComponent(toast.liveTaskId)}`),
                onClick: (e: MouseEvent) => { e.preventDefault(); onOpenLive(toast.liveTaskId!); },
              }, "Open in Live"))
            : null,
        )
      : null,
  );
}
