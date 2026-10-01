/**
 * The running-now bar, under the top nav on every Live page: "All live" with
 * its count, then one entry per live item, so concurrent runs can be opened
 * and switched between without going back to the overview.
 *
 * Reads the same `GET /api/live` feed as the Live tab. `[` and `]` step
 * through the entries unless focus is in a text field. An item that finishes
 * while its page is open stays, marked finished, until the operator leaves.
 * Entries for another worktree are real links through its `/w/<key>/` prefix.
 *
 * @module web/viewer/views/live-bar
 */

import { h } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { NavigateTo, ViewId } from "../types.js";
import { PeekLink, isCurrentWorktree, liveHref } from "../components/index.js";
import { liveRunningCount, liveStuckCount, useLive } from "../hooks/index.js";
import {
  barEntries,
  currentEntryKey,
  isModalOpen,
  isTypingTarget,
  stepTarget,
  withFinished,
  type BarEntry,
  type FinishedKeep,
} from "./live-bar-model.js";

export interface LiveBarProps {
  /** The Live page being viewed. */
  view: ViewId;
  /** The task whose page is open (`live-task` only). */
  taskId: string | null;
  navigateTo: NavigateTo;
}

/** Opens an entry: in place for this worktree, a full navigation for another. */
function open(entry: BarEntry, navigateTo: NavigateTo): void {
  if (isCurrentWorktree(entry.worktree)) {
    navigateTo(entry.view, entry.view === "live-task" && entry.subId ? { taskId: entry.subId } : undefined);
  } else {
    location.assign(liveHref(entry.worktree, entry.view, entry.subId));
  }
}

function EntryLink({ entry, current, navigateTo }: { entry: BarEntry; current: boolean; navigateTo: NavigateTo }) {
  const dot = entry.finished ? "finished" : entry.stuck ? "stuck" : "live";
  return h(PeekLink, {
    target: { view: entry.view, subId: entry.subId, worktree: entry.worktree },
    navigateTo,
    class: `live-bar-item${current ? " live-bar-current" : ""}${entry.finished ? " live-bar-finished" : ""}`,
    current,
  },
    h("span", { class: "live-tile-kind", "aria-hidden": "true" }, entry.kind),
    h("span", { class: `live-bar-dot live-bar-dot-${dot}`, "aria-hidden": "true" }),
    h("span", { class: "live-bar-title" }, entry.title),
    h("span", { class: "live-bar-meta" },
      entry.finished ? "finished" : [entry.branch, entry.step].filter(Boolean).join(" · ")),
    entry.stuck ? h("span", { class: "live-bar-flag" }, entry.flag ?? "stuck") : null,
  );
}

export function LiveBar({ view, taskId, navigateTo }: LiveBarProps) {
  const live = useLive();
  const lastRef = useRef<BarEntry[]>([]);
  const pageRef = useRef<{ id: string; key: string | null }>({ id: "", key: null });
  const keptRef = useRef<FinishedKeep | null>(null);

  // A failed read leaves `live` null; that is "unknown", not "everything finished".
  const listed = live ? barEntries(live) : lastRef.current;

  const pageId = `${view}:${taskId ?? ""}`;
  const fresh = currentEntryKey(listed, view, taskId, isCurrentWorktree);
  if (pageRef.current.id !== pageId) {
    pageRef.current = { id: pageId, key: fresh };
    keptRef.current = null;
  } else if (fresh) {
    pageRef.current.key = fresh;
  }
  const pageKey = pageRef.current.key;

  const shown = withFinished(listed, lastRef.current, pageKey, keptRef.current);
  keptRef.current = shown.kept;
  lastRef.current = listed;
  const entries = shown.entries;

  const stateRef = useRef({ entries, pageKey, navigateTo });
  stateRef.current = { entries, pageKey, navigateTo };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.key !== "[" && e.key !== "]") || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (isTypingTarget(e.target) || isModalOpen(document)) return;
      const { entries: current, pageKey: key, navigateTo: go } = stateRef.current;
      const target = stepTarget(current, key, e.key === "]" ? 1 : -1);
      if (!target) return;
      e.preventDefault();
      open(target, go);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const running = liveRunningCount(live);
  const stuck = liveStuckCount(live);
  return h("nav", { class: "live-bar", "aria-label": "Running now" },
    h(PeekLink, {
      target: { view: "live", subId: null, worktree: null },
      navigateTo,
      class: `live-bar-item live-bar-all${view === "live" ? " live-bar-current" : ""}`,
      current: view === "live",
    },
      h("span", { class: "live-bar-title" }, "All live"),
      h("span", { class: "live-count" }, String(running)),
      stuck > 0 ? h("span", { class: "live-stuck-badge" }, `${stuck} stuck`) : null,
    ),
    entries.map((entry) => h(EntryLink, { key: entry.key, entry, current: entry.key === pageKey, navigateTo })),
  );
}
