/**
 * Ready to run — the tasks `ndx work --auto` would pick next: Work's Up next.
 *
 * Each row says who it is assigned to and, given `estimates`, what a run of it
 * typically takes (`run-estimate.ts`), so the queue answers who and how much
 * before anything starts. Given `split`, the list is two sections: the tasks
 * assigned to the current user, then the unassigned ones grouped by product
 * area (`splitReady`), each in the agent's pick order.
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
import { itemTypeLabel, workCommandArgs } from "../external.js";
import { shellWord } from "./prepare-task-model.js";
import { QueuedNotice } from "./queued-notice.js";
import { ImpactTags, displayTitle, titleTooltip, useItemImpacts } from "./impact-tags.js";
import type { QueuedReply } from "./prepare-task-model.js";
import { isMine, personLabel } from "./assignee-model.js";
import { EstimateChip, type RunEstimates } from "./run-estimate.js";

/** Rows shown before "Show all N": the next few picks, not the whole queue. */
export const READY_TOP_ROWS = 3;
/** The first request's page size (the server's maximum). */
const READY_PAGE = 50;
const TOAST_MS = 8000;

/** One row of the `/api/hench/ready` reply (the server's `ReadyTask`). */
export interface ReadyTask {
  id: string;
  title: string;
  /** Short name, shown in place of the title when present. */
  shortTitle?: string;
  /** Plain-language summary, shown in place of the title when present. */
  summary?: string;
  /** The start of the description, already cut short by the server. */
  description?: string;
  status: string;
  priority: string | null;
  /** change, task or subtask on v2; epic, feature, task or subtask on v1. Absent from an older server. */
  itemType?: string;
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
  /** Who it is assigned to (its own assignee, else its nearest assigned ancestor's). Absent from an older server. */
  assignee?: string | null;
  /** The task's saved run tier; null runs on the project default. Absent from an older server. */
  tier?: string | null;
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

/** Rows matching every filter; search reads the summary, title, change, ancestors and tags. */
export function filterReady(tasks: ReadyTask[], f: ReadyFilters): ReadyTask[] {
  const q = f.query.trim().toLowerCase();
  return tasks.filter((t) => {
    if (f.priority && (t.priority ?? "none") !== f.priority) return false;
    if (f.change && changeKey(t) !== f.change) return false;
    if (f.tag && !(t.tags ?? []).includes(f.tag)) return false;
    if (!q) return true;
    return [t.shortTitle ?? "", t.summary ?? "", t.title, t.change?.title ?? "", ...t.parentChain, ...(t.tags ?? [])].some((s) => s.toLowerCase().includes(q));
  });
}

/** Whether a row names its change: not when the chain already ends at it, or the row is the change. */
const showChange = (task: ReadyTask) =>
  !!task.change && task.change.title !== task.title && task.parentChain[task.parentChain.length - 1] !== task.change.title;

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
  /** What a run typically takes; each row shows its tier's figure. Absent shows none. */
  estimates?: RunEstimates | null;
  /** Draw the list's own "Ready to run" heading. False inside a tile that names it. Default true. */
  heading?: boolean;
  /**
   * Split the queue: the tasks assigned to the current user, then the
   * unassigned ones grouped by product area. Tasks assigned to someone else
   * are counted, not listed. The whole queue is read, since a group's rows can
   * sit anywhere in it.
   */
  split?: ReadySplit;
}

export interface ReadySplit {
  /** The current user as `ndx work --mine` resolves them; null when unknown. */
  me: string | null;
  /** The product area (v2) or top-level section (v1) a task's work belongs to; null for none. */
  areaOf: (task: ReadyTask) => string | null;
}

/** The heading of the unassigned tasks no area claims. */
export const NO_AREA_LABEL = "No product area";

export interface ReadyGroups {
  mine: ReadyTask[];
  /** In queue order of each area's first task; tasks with no area last. */
  unassigned: Array<{ area: string | null; tasks: ReadyTask[] }>;
  /** Assigned to someone other than the current user. */
  others: number;
}

/** The split Ready to run shows, every group in the agent's pick order. */
export function splitReady(tasks: readonly ReadyTask[], me: string | null, areaOf: (task: ReadyTask) => string | null): ReadyGroups {
  const mine: ReadyTask[] = [];
  const byArea = new Map<string | null, ReadyTask[]>();
  let others = 0;
  for (const task of tasks) {
    const assignee = task.assignee?.trim() ?? "";
    if (!assignee) {
      const area = areaOf(task);
      byArea.set(area, [...(byArea.get(area) ?? []), task]);
    } else if (isMine(assignee, me)) mine.push(task);
    else others++;
  }
  const unassigned = [...byArea.entries()]
    .sort(([a], [b]) => Number(a === null) - Number(b === null))
    .map(([area, rows]) => ({ area, tasks: rows }));
  return { mine, unassigned, others };
}

const STATUS_ICON: Record<string, { icon: string; label: string }> = {
  pending: { icon: "○", label: "Pending" },
  in_progress: { icon: "◐", label: "In progress" },
};

export function ReadyToRun({ onPrepare, onOpenLive, onOpenPrd, estimates = null, heading = true, split }: ReadyToRunProps) {
  const [tasks, setTasks] = useState<ReadyTask[] | null>(null);
  const [dir, setDir] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [expanded, setExpanded] = useState(false);
  /** Start now runs the hub queued, until dismissed. */
  const [queued, setQueued] = useState<Array<{ taskId: string; reply: QueuedReply }>>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [total, setTotal] = useState(0);
  /** Once a control is used, keep the whole queue for later filters and refreshes. */
  const [engaged, setEngaged] = useState(false);
  const [allAttempt, setAllAttempt] = useState(0);
  /** Whether the retained snapshot includes every row, even after a failed refresh. */
  const complete = useRef(false);
  const loading = useRef(0);
  const [filters, setFilters] = useState<ReadyFilters>(NO_FILTERS);
  const filtering = isFiltering(filters);
  const needAll = expanded || engaged || filtering || !!split;
  const needAllRef = useRef(needAll);
  needAllRef.current = needAll;

  /**
   * The first page; the whole list in one request once the list is expanded or
   * a control is used (each request costs a full selection and runs scan, so
   * paging through it would repeat that per page).
   */
  const load = useCallback(async () => {
    const all = needAllRef.current;
    loading.current++;
    try {
      const res = await fetch(all ? "/api/hench/ready?all=1" : `/api/hench/ready?limit=${READY_PAGE}&offset=0`);
      if (!res.ok) {
        complete.current = false;
        setError(res.status === 404 ? null : `Could not load the ready list (${res.status})`);
        setTasks([]);
        setTotal(0);
        return;
      }
      const data = (await res.json()) as ReadyReply;
      const rows = Array.isArray(data.tasks) ? data.tasks : [];
      complete.current = rows.length >= (typeof data.total === "number" ? data.total : rows.length);
      setDir(typeof data.dir === "string" ? data.dir : "");
      setTasks(rows);
      setTotal(typeof data.total === "number" ? data.total : rows.length);
      setError(null);
      // A control may have reused a complete snapshot while this page was in
      // flight. If the queue has since grown, upgrade it once the page lands.
      if (!all && needAllRef.current && !complete.current && loading.current === 1) {
        setAllAttempt((prev) => prev + 1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the ready list");
      setTasks((prev) => prev ?? []);
    } finally {
      loading.current--;
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (needAll && !complete.current) void load(); }, [needAll, allAttempt, load]);
  useHenchRunsLiveRefresh(load);
  // After the ready list's own load, so the list is the first request out.
  const impacts = useItemImpacts();
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
  const engage = () => {
    // Engagement stays latched for refreshes; an incomplete snapshot still needs
    // another attempt when a control is used after a transient load failure.
    if (needAllRef.current && !complete.current && loading.current === 0) setAllAttempt((prev) => prev + 1);
    setEngaged(true);
  };
  const setFilter = (patch: Partial<ReadyFilters>) => {
    engage();
    setFilters((prev) => ({ ...prev, ...patch }));
  };

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
      onFocus: engage,
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

  // Each task is a card in the Up next format (the card Work used to show
  // below this list for the same first task): badges and the run button on
  // top, the title, where it sits, the start of its description, then its
  // tags. The queue's first card is the pick and leads; the rest follow it.
  const pickId = loaded[0]?.id;
  const row = (task: ReadyTask) => {
          const status = STATUS_ICON[task.status] ?? { icon: "○", label: task.status };
          const menuId = `ready-menu-${task.id}`;
          const emphasis = task.priority === "critical" ? " rex-dash-next-critical" : task.priority === "high" ? " rex-dash-next-high" : "";
          const tags = task.tags ?? [];
          return h("li", { key: task.id, class: `ready-row rex-dash-next-card${emphasis}${task.id === pickId && !filtering ? " ready-row--lead" : ""}`, "data-task-id": task.id },
            h("div", { class: "rex-dash-next-top" },
              h("div", { class: "rex-dash-next-badges ready-meta" },
                h("span", { class: `prd-status-icon prd-status-${task.status}`, title: status.label, "aria-label": status.label }, status.icon),
                task.itemType ? h("span", { class: `prd-level-badge prd-level-${task.itemType}` }, itemTypeLabel(task.itemType)) : null,
                task.priority ? h("span", { class: `prd-priority-badge prd-priority-${task.priority}` }, task.priority) : null,
                task.assignee !== undefined
                  ? h("span", { class: task.assignee ? "ready-assignee" : "ready-assignee ready-assignee-none", title: task.assignee ?? "Nobody is assigned" },
                      task.assignee ? personLabel(task.assignee) : "Unassigned")
                  : null,
                h("span", { class: "ready-criteria" }, `${task.criteriaCount} ${task.criteriaCount === 1 ? "criterion" : "criteria"}`),
                h(EstimateChip, { estimates, tier: task.tier, ownTier: true, class: "ready-estimate" }),
                task.resume ? h("span", { class: "ready-resume" }, "in progress · no live run") : null,
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
            ),
            // The short title or plain-language summary leads; the full title is the tooltip and the modal's heading.
            h("button", {
              type: "button",
              class: "ready-title rex-dash-next-link",
              title: titleTooltip(task),
              onClick: () => onPrepare(task.id),
            },
              displayTitle(task),
              // A task that will not run on the project defaults says so
              // before the modal is opened. The label carries the meaning:
              // the dot alone is decoration to a screen reader.
              task.saved
                ? h("span", { class: "ready-saved-dot", role: "img", "aria-label": "Saved run settings", title: "Saved run settings" }, "●")
                : null,
            ),
            task.parentChain.length || showChange(task)
              ? h("div", { class: "ready-chain" },
                  task.parentChain.join(" › "),
                  // The chain ends at the change on v2; a task-less change is its own row.
                  showChange(task) ? h("span", { class: "ready-change" }, task.change!.title) : null,
                )
              : null,
            task.description ? h("p", { class: "rex-dash-next-desc ready-desc" }, task.description) : null,
            tags.length > 0 || impacts[task.id]
              ? h("div", { class: "rex-dash-next-tags" },
                  h(ImpactTags, { impact: impacts[task.id] }),
                  tags.map((tag) => h("span", { key: tag, class: "prd-tag" }, tag)),
                )
              : null,
          );
  };

  const cap = (rows: ReadyTask[]) => (filtering || expanded ? rows : rows.slice(0, READY_TOP_ROWS));
  const groups = split ? splitReady(matches, split.me, split.areaOf) : null;
  /** Some group holds more than it shows, so "Show all" has something to show. */
  const truncated = groups
    ? groups.mine.length > READY_TOP_ROWS || groups.unassigned.some((g) => g.tasks.length > READY_TOP_ROWS)
    : total > READY_TOP_ROWS;

  const splitBody = (g: ReadyGroups) => h("div", { class: "ready-groups", id: "ready-to-run-list" },
    h("section", { class: "ready-group", "aria-labelledby": "ready-group-mine" },
      h("h3", { class: "ready-group-title", id: "ready-group-mine" },
        "Assigned to you", h("span", { class: "ready-group-count" }, String(g.mine.length))),
      g.mine.length > 0
        ? h("ul", { class: "ready-list" }, cap(g.mine).map(row))
        : h("p", { class: "ready-empty" }, split!.me ? "Nothing ready is assigned to you." : "n-dx could not tell who you are; set your git user to see your tasks."),
    ),
    h("section", { class: "ready-group", "aria-labelledby": "ready-group-unassigned" },
      h("h3", { class: "ready-group-title", id: "ready-group-unassigned" },
        "Unassigned", h("span", { class: "ready-group-count" }, String(g.unassigned.reduce((n, a) => n + a.tasks.length, 0)))),
      g.unassigned.length > 0
        ? g.unassigned.map((a) => h("div", { key: a.area ?? "", class: "ready-area" },
            h("h4", { class: "ready-area-title" }, a.area ?? NO_AREA_LABEL, h("span", { class: "ready-group-count" }, String(a.tasks.length))),
            h("ul", { class: "ready-list" }, cap(a.tasks).map(row)),
          ))
        : h("p", { class: "ready-empty" }, "Every ready task has someone assigned."),
    ),
    g.others > 0
      ? h("p", { class: "ready-others" }, `${g.others} more ready ${g.others === 1 ? "task is" : "tasks are"} assigned to someone else.`)
      : null,
  );

  const more = !filtering && truncated
    ? h("button", {
        type: "button",
        class: "ready-more",
        "aria-expanded": String(expanded),
        "aria-controls": "ready-to-run-list",
        onClick: () => { if (!expanded) engage(); setExpanded(!expanded); },
      },
        expanded ? `Show top ${READY_TOP_ROWS}${groups ? " of each" : ""}` : `Show all ${total}`)
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
      : (groups ? matches.length === 0 : shown.length === 0)
        ? h("p", { class: "ready-empty" }, "No ready task matches.")
        : groups
          ? splitBody(groups)
          : h("ul", { class: "ready-list", id: "ready-to-run-list" }, shown.map(row));

  // The Up next panel (styled as .rex-dash-next, without that class: the
  // scroll reveal fades .rex-dash-next in, and this list must never wait on it).
  return h("section", heading ? { class: "ready-to-run", "aria-labelledby": "ready-to-run-title" } : { class: "ready-to-run", "aria-label": "Up next" },
    heading
      ? h("div", { class: "rex-dash-section-header" },
          h("h2", { id: "ready-to-run-title", class: "ready-title-head" }, "Ready to run"),
          total > 0
            ? h("span", { class: "rex-dash-section-meta" }, `${total} ready · in the order the agent picks them`)
            : null,
        )
      : null,
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
