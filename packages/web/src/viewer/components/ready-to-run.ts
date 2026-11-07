/**
 * Ready to run — the tasks `ndx work --auto` would pick next, at the top of Work.
 *
 * Fed by `GET /api/hench/ready`, shown in the order returned: the top rows, then
 * "Show all N", with a text search and priority, change and tag filters over
 * every task once the whole list is loaded (one `all=1` request). Each row
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

/** Rows shown before "Show all N". */
export const READY_TOP_ROWS = 10;
/** The first request's page size (the server's maximum). */
const READY_PAGE = 50;
const TOAST_MS = 8000;

/** One row of the `/api/hench/ready` reply (the server's `ReadyTask`). */
export interface ReadyTask {
  id: string;
  title: string;
  status: string;
  priority: string | null;
  parentChain: string[];
  /** The change the task belongs to. Absent from a server that predates it. */
  change?: { id: string; title: string } | null;
  tags?: string[];
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
  /** Every actionable task, not just this page. Absent from a server that predates paging. */
  total?: number;
  dir: string;
}

/** The narrowing the list's controls apply. An empty field matches every row. */
export interface ReadyFilters { query: string; priority: string; change: string; tag: string }

const NO_FILTERS: ReadyFilters = { query: "", priority: "", change: "", tag: "" };

const isFiltering = (f: ReadyFilters) => f.query.trim() !== "" || f.priority !== "" || f.change !== "" || f.tag !== "";

/** The change id a row groups under: its change, else its own title. */
const changeKey = (task: ReadyTask) => task.change?.id ?? "";

/** Rows matching every filter; the text search reads the title, change, ancestors and tags. */
export function filterReady(tasks: ReadyTask[], f: ReadyFilters): ReadyTask[] {
  const q = f.query.trim().toLowerCase();
  return tasks.filter((t) => {
    if (f.priority && (t.priority ?? "none") !== f.priority) return false;
    if (f.change && changeKey(t) !== f.change) return false;
    if (f.tag && !(t.tags ?? []).includes(f.tag)) return false;
    if (!q) return true;
    return [t.title, t.change?.title ?? "", ...t.parentChain, ...(t.tags ?? [])].some((s) => s.toLowerCase().includes(q));
  });
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

  const [total, setTotal] = useState(0);
  const [expanded, setExpanded] = useState(false);
  /** A control was used: the rest of the pages are needed for its options and its matches. */
  const [engaged, setEngaged] = useState(false);
  const [filters, setFilters] = useState<ReadyFilters>(NO_FILTERS);
  const filtering = isFiltering(filters);
  const needAll = expanded || engaged || filtering;
  const needAllRef = useRef(needAll);
  needAllRef.current = needAll;

  /**
   * The first page; the whole list in one request once the list is expanded or
   * a control is used (each request costs a full selection and runs scan, so
   * paging through it would repeat that per page).
   */
  const load = useCallback(async () => {
    try {
      const res = await fetch(needAllRef.current ? "/api/hench/ready?all=1" : `/api/hench/ready?limit=${READY_PAGE}&offset=0`);
      if (!res.ok) {
        setError(res.status === 404 ? null : `Could not load the ready list (${res.status})`);
        setTasks([]);
        setTotal(0);
        return;
      }
      const data = (await res.json()) as ReadyReply;
      const rows = Array.isArray(data.tasks) ? data.tasks : [];
      setDir(typeof data.dir === "string" ? data.dir : "");
      setTasks(rows);
      setTotal(typeof data.total === "number" ? data.total : rows.length);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the ready list");
      setTasks((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (needAll) void load(); }, [needAll, load]);
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

  const loaded = tasks ?? [];
  const matches = filtering ? filterReady(loaded, filters) : loaded;
  const shown = filtering || expanded ? matches : matches.slice(0, READY_TOP_ROWS);
  const setFilter = (patch: Partial<ReadyFilters>) => setFilters((prev) => ({ ...prev, ...patch }));

  const changes = new Map<string, string>();
  const tags = new Set<string>();
  for (const t of loaded) {
    if (t.change) changes.set(t.change.id, t.change.title);
    for (const tag of t.tags ?? []) tags.add(tag);
  }
  const select = (label: string, value: string, key: keyof ReadyFilters, options: Array<[string, string]>) =>
    h("select", {
      class: "ready-filter",
      "aria-label": label,
      value,
      onFocus: () => setEngaged(true),
      onChange: (e: Event) => setFilter({ [key]: (e.target as HTMLSelectElement).value }),
    }, h("option", { value: "" }, label), options.map(([v, text]) => h("option", { value: v, key: v }, text)));

  const controls = total > READY_TOP_ROWS || filtering
    ? h("div", { class: "ready-controls" },
        h("input", {
          type: "search",
          class: "ready-search",
          placeholder: "Search ready tasks",
          "aria-label": "Search ready tasks",
          value: filters.query,
          onInput: (e: Event) => setFilter({ query: (e.target as HTMLInputElement).value }),
        }),
        select("Any priority", filters.priority, "priority",
          ["critical", "high", "medium", "low", "none"].map((p) => [p, p] as [string, string])),
        select("Any change", filters.change, "change",
          [...changes].sort((a, b) => a[1].localeCompare(b[1])).map(([id, title]) => [id, title] as [string, string])),
        select("Any tag", filters.tag, "tag", [...tags].sort().map((t) => [t, t] as [string, string])),
        filtering
          ? h("button", { type: "button", class: "ready-clear", onClick: () => setFilters(NO_FILTERS) }, "Clear")
          : null,
        h("span", { class: "ready-count", role: "status" },
          filtering ? `${matches.length} of ${total} match` : `${shown.length} of ${total}`),
      )
    : null;

  const more = !filtering && total > READY_TOP_ROWS
    ? h("button", { type: "button", class: "ready-more", onClick: () => setExpanded(!expanded) },
        expanded ? `Show top ${READY_TOP_ROWS}` : `Show all ${total}`)
    : null;

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
      : shown.length === 0
        ? h("p", { class: "ready-empty" }, "No ready task matches.")
        : h("ul", { class: "ready-list" }, shown.map((task) => {
          const status = STATUS_ICON[task.status] ?? { icon: "○", label: task.status };
          const menuId = `ready-menu-${task.id}`;
          return h("li", { key: task.id, class: "ready-row", "data-task-id": task.id },
            h("span", { class: `prd-status-icon prd-status-${task.status}`, title: status.label, "aria-label": status.label }, status.icon),
            h("div", { class: "ready-main" },
              h("button", { type: "button", class: "ready-title", onClick: () => onPrepare(task.id) },
                task.title,
                // A task that will not run on the project defaults says so
                // before the modal is opened. The label carries the meaning:
                // the dot alone is decoration to a screen reader.
                task.saved
                  ? h("span", { class: "ready-saved-dot", role: "img", "aria-label": "Saved run settings", title: "Saved run settings" }, "●")
                  : null,
              ),
              h("div", { class: "ready-meta" },
                task.parentChain.length ? h("span", { class: "ready-chain" }, task.parentChain.join(" › ")) : null,
                // The chain ends at the change on v2; a task-less change is its own row.
                task.change && task.change.title !== task.title && task.parentChain[task.parentChain.length - 1] !== task.change.title
                  ? h("span", { class: "ready-change" }, task.change.title)
                  : null,
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
    controls,
    body,
    more,
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
