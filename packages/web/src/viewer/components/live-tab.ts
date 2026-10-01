/**
 * The Live tab: the fourth top-nav tab, outside the Analysis → Plan → Work
 * loop, with a status dot, a count, and a peek of what is running.
 *
 * Three states, read from `GET /api/live` (see `liveTabState`):
 *   - idle        — hollow dot, no count
 *   - running     — pulsing teal dot and the number of live runs and jobs
 *   - attention   — orange dot and an "N stuck" badge: a run has had no
 *                   heartbeat for the stuck-run threshold
 *
 * Hover or keyboard focus opens the peek — each live item with its branch,
 * elapsed time and current step (a progress bar for an analysis), linking to
 * its page — and Escape closes it. The dot and count are `aria-hidden`; the
 * button's accessible name carries the same facts in words.
 */

import { h } from "preact";
import type { ComponentChildren } from "preact";
import { useState, useCallback, useRef, useEffect } from "preact/hooks";
import type { NavigateTo, ViewId } from "../types.js";
import { detectBasePath } from "../external.js";
import { appUrl, getWorkspaceKey } from "../base-path.js";
import { viewPathname } from "../route-state.js";
import {
  analyzeFraction,
  isAnalysisJob,
  liveRunningCount,
  liveStuckCount,
  liveTabLabel,
  liveTabState,
  useLive,
  useTick,
  type LiveJobSummary,
  type LiveRunSummary,
  type LiveSummary,
  type LiveWorktreeRef,
} from "../hooks/index.js";
import { fmtDuration } from "../utils/format.js";

const PEEK_ID = "live-peek";

function elapsedFormatter(startedAt: string): string {
  return fmtDuration(startedAt, new Date().toISOString());
}

// ── Links ────────────────────────────────────────────────────────────

/** Whether `worktree` is the one this viewer addresses (null = the project anchor). */
export function isCurrentWorktree(worktree: LiveWorktreeRef | null): boolean {
  if (!worktree) return true;
  const current = getWorkspaceKey();
  return current === null ? worktree.isAnchor : worktree.key === current;
}

/**
 * Where a Live page is for the worktree running it: this viewer's own path for
 * the current worktree, else the same page under that worktree's `/w/<key>/`
 * slot — a full navigation, since a viewer is mounted on one workspace.
 */
export function liveHref(worktree: LiveWorktreeRef | null, view: ViewId, subId: string | null): string {
  const path = viewPathname(view, subId);
  if (isCurrentWorktree(worktree) || !worktree) return appUrl(path);
  const slot = worktree.isAnchor ? "" : `/w/${encodeURIComponent(worktree.key)}`;
  return `${detectBasePath(location.pathname)}${slot}${path}`;
}

export interface PeekTarget {
  view: ViewId;
  subId: string | null;
  worktree: LiveWorktreeRef | null;
}

export function runTarget(run: LiveRunSummary): PeekTarget {
  return run.taskId
    ? { view: "live-task", subId: run.taskId, worktree: run.worktree }
    : { view: "live", subId: null, worktree: run.worktree };
}

export function jobTarget(job: LiveJobSummary): PeekTarget {
  return isAnalysisJob(job)
    ? { view: "live-analyze", subId: null, worktree: job.worktree }
    : { view: "live", subId: null, worktree: job.worktree };
}

// ── Peek ─────────────────────────────────────────────────────────────

export interface PeekLinkProps {
  target: PeekTarget;
  navigateTo?: NavigateTo;
  onNavigated?: () => void;
  class: string;
  /** This link is the page being viewed: `aria-current="page"`. */
  current?: boolean;
  children?: ComponentChildren;
}

/**
 * A row that is a real link — middle-click and "copy link" work — and, for a
 * page in this worktree, navigates in place rather than reloading the app.
 */
export function PeekLink({ target, navigateTo, onNavigated, class: className, current, children }: PeekLinkProps) {
  const href = liveHref(target.worktree, target.view, target.subId);
  const onClick = (e: MouseEvent) => {
    if (!navigateTo || !isCurrentWorktree(target.worktree)) return;
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigateTo(target.view, target.view === "live-task" && target.subId ? { taskId: target.subId } : undefined);
    onNavigated?.();
  };
  return h("a", { class: className, href, onClick, "aria-current": current ? "page" : undefined }, children);
}

function Elapsed({ startedAt }: { startedAt: string }) {
  return h("span", { class: "live-peek-elapsed" }, useTick(startedAt, elapsedFormatter));
}

function RunRow({ run, navigateTo, onNavigated }: { run: LiveRunSummary; navigateTo?: NavigateTo; onNavigated: () => void }) {
  return h("li", null,
    h(PeekLink, { target: runTarget(run), navigateTo, onNavigated, class: "live-peek-row" },
      h("span", { class: "live-peek-title" }, run.taskTitle ?? run.runId,
        run.stale ? h("span", { class: "live-peek-stuck" }, "stuck") : null,
        run.pidAlive === false ? h("span", { class: "live-peek-stuck" }, "process not found") : null),
      h("span", { class: "live-peek-meta" },
        run.branch ? h("span", { class: "live-peek-branch" }, run.branch) : null,
        run.startedAt ? h(Elapsed, { startedAt: run.startedAt }) : null,
      ),
      run.lastProgress ? h("span", { class: "live-peek-step" }, run.lastProgress) : null,
    ),
  );
}

function JobRow({ job, navigateTo, onNavigated }: { job: LiveJobSummary; navigateTo?: NavigateTo; onNavigated: () => void }) {
  const fraction = isAnalysisJob(job) ? analyzeFraction(job.progress) : null;
  const phase = job.progress?.phase;
  const step = phase ? `${phase.name} (${phase.index}/${phase.total})` : job.detail;
  return h("li", null,
    h(PeekLink, { target: jobTarget(job), navigateTo, onNavigated, class: "live-peek-row" },
      h("span", { class: "live-peek-title" }, job.kind === "analyze" ? "Analysis" : job.kind),
      h("span", { class: "live-peek-meta" },
        job.worktree ? null : h("span", { class: "live-peek-branch" }, "project"),
        job.startedAt ? h(Elapsed, { startedAt: job.startedAt }) : null,
      ),
      step ? h("span", { class: "live-peek-step" }, step) : null,
      fraction === null ? null : h("span", {
        class: "live-peek-bar",
        role: "progressbar",
        "aria-label": "Analysis progress",
        "aria-valuemin": 0,
        "aria-valuemax": 100,
        "aria-valuenow": Math.round(fraction * 100),
      }, h("span", { class: "live-peek-bar-fill", style: { width: `${Math.round(fraction * 100)}%` } })),
    ),
  );
}

function Peek({ live, navigateTo, onNavigated }: { live: LiveSummary | null; navigateTo?: NavigateTo; onNavigated: () => void }) {
  const runs = live?.runs ?? [];
  const jobs = live?.jobs ?? [];
  return h("div", { id: PEEK_ID, class: "live-peek", role: "region", "aria-label": "Running now" },
    runs.length === 0 && jobs.length === 0
      ? h("p", { class: "live-peek-empty" }, "Nothing running.")
      : h("ul", { class: "live-peek-list" },
        runs.map((run) => h(RunRow, { key: run.runId, run, navigateTo, onNavigated })),
        jobs.map((job) => h(JobRow, { key: job.id, job, navigateTo, onNavigated })),
      ),
    h(PeekLink, { target: { view: "live", subId: null, worktree: null }, navigateTo, onNavigated, class: "live-peek-open" }, "Open Live"),
  );
}

// ── Tab ──────────────────────────────────────────────────────────────

export interface LiveTabProps {
  /** The current page — `aria-current` is "page" on `live` itself, "true" on a page under it. */
  view: ViewId;
  /** The current page is one of Live's (`isLiveView`). */
  active: boolean;
  onNavigate: (view: ViewId) => void;
  navigateTo?: NavigateTo;
  /** Static export: there is no server to ask, so the tab does not exist. */
  enabled?: boolean;
}

export function LiveTab({ view, active, onNavigate, navigateTo, enabled = true }: LiveTabProps) {
  const live = useLive(enabled);
  // Hover and focus each hold the peek open on their own: a pointer leaving
  // must not close a peek that focus opened, nor focus leaving one the pointer holds.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const open = hovered || focused;
  const rootRef = useRef<HTMLDivElement>(null);
  const restoringFocusRef = useRef(false);

  const state = liveTabState(live);
  const running = liveRunningCount(live);
  const stuck = liveStuckCount(live);

  const close = useCallback(() => { setHovered(false); setFocused(false); }, []);

  // Leaving by Tab closes the focus hold; focus moving between the button and
  // the peek's links must not.
  const onFocusOut = useCallback((e: FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (!next || !rootRef.current?.contains(next)) setFocused(false);
  }, []);

  const onFocusIn = useCallback(() => {
    if (!restoringFocusRef.current) setFocused(true);
  }, []);

  // Escape dismisses the peek wherever focus is (WCAG 2.1 SC 1.4.13): hover
  // can open it with focus elsewhere. The listener exists only while it is open.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close();
      // Focus inside the peek would otherwise be lost with it. Moving it to the
      // button fires focusin, which must not reopen what Escape just closed.
      const button = rootRef.current?.querySelector<HTMLButtonElement>(".topnav-tab-live");
      if (button && rootRef.current?.contains(document.activeElement)) {
        restoringFocusRef.current = true;
        button.focus();
        restoringFocusRef.current = false;
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  // The peek is anchored to the tab, so a route change that leaves the
  // pointer resting over it should not leave it open over the new page.
  useEffect(() => { close(); }, [view, close]);

  if (!enabled) return null;

  return h("div", {
    ref: rootRef,
    class: "topnav-live",
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
    onFocusIn,
    onFocusOut,
  },
    h("button", {
      type: "button",
      class: `topnav-tab topnav-tab-live live-state-${state}${active ? " active" : ""}`,
      "data-live-state": state,
      onClick: () => { close(); onNavigate("live"); },
      "aria-label": liveTabLabel(live),
      "aria-current": active ? (view === "live" ? "page" : "true") : undefined,
      "aria-expanded": open,
      "aria-controls": open ? PEEK_ID : undefined,
    },
      h("span", { class: "live-dot", "aria-hidden": "true" }),
      h("span", { class: "topnav-tab-label" }, "Live"),
      running > 0 ? h("span", { class: "live-count", "aria-hidden": "true" }, String(running)) : null,
      stuck > 0 ? h("span", { class: "live-stuck-badge", "aria-hidden": "true" }, `${stuck} stuck`) : null,
    ),
    open ? h(Peek, { live, navigateTo, onNavigated: close }) : null,
  );
}
