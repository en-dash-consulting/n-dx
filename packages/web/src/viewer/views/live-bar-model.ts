/**
 * The running-now bar's reading of `GET /api/live`, kept pure so the cases the
 * acceptance criteria name — which entry is current, a finished item staying,
 * `[` / `]` cycling — are testable without a DOM. `live-bar.ts` lays it out.
 *
 * @module web/viewer/views/live-bar-model
 */

import type { ViewId } from "../types.js";
import { jobTarget, runTarget } from "../components/index.js";
import { attentionFlag, isAnalysisJob, needsAttention, type LiveSummary, type LiveWorktreeRef } from "../hooks/index.js";
import { jobLabel } from "./live-model.js";

/** One item in the bar: a run or a job, reduced to what the bar shows and links to. */
export interface BarEntry {
  key: string;
  /** The product tile: Task, Analyze, or Job (no page of its own — it links to the overview). */
  kind: "Task" | "Analyze" | "Job";
  view: ViewId;
  subId: string | null;
  worktree: LiveWorktreeRef | null;
  title: string;
  branch: string | null;
  /** Current step or phase. */
  step: string | null;
  stuck: boolean;
  /** What the flag beside a stuck entry says: "stuck", or the liveness verdict ("not running"). */
  flag: string | null;
  /** The item ended while its page was open; kept until the operator leaves it. */
  finished: boolean;
}

/** One entry per live item in the server's order: runs, then jobs. */
export function barEntries(live: LiveSummary): BarEntry[] {
  const runs = live.runs.map((run): BarEntry => {
    const { view, subId, worktree } = runTarget(run);
    return {
      key: `run:${run.runId}`, kind: "Task", view, subId, worktree,
      title: run.taskTitle ?? run.runId, branch: run.branch, step: run.lastProgress, stuck: needsAttention(run), flag: attentionFlag(run), finished: false,
    };
  });
  const jobs = live.jobs.map((job): BarEntry => {
    const { view, subId, worktree } = jobTarget(job);
    return {
      key: `job:${job.id}`, kind: isAnalysisJob(job) ? "Analyze" : "Job", view, subId, worktree,
      title: jobLabel(job), branch: null, step: job.progress?.phase?.name ?? job.detail, stuck: false, flag: null, finished: false,
    };
  });
  return [...runs, ...jobs];
}

/**
 * The entry the viewed page belongs to, or null on the overview and on a page
 * whose item is not (or no longer) listed. Only the viewer's own worktree can
 * be the page being viewed: another worktree's page is a different viewer.
 */
export function currentEntryKey(
  entries: readonly BarEntry[],
  view: ViewId,
  taskId: string | null,
  inViewedWorktree: (worktree: LiveWorktreeRef | null) => boolean,
): string | null {
  if (view !== "live-task" && view !== "live-analyze") return null;
  const match = entries.find((e) => e.view === view && inViewedWorktree(e.worktree)
    && (view === "live-analyze" || e.subId === taskId));
  return match?.key ?? null;
}

export interface FinishedKeep {
  /** The entry that finished, as it was last seen live. */
  entry: BarEntry;
  /** Where it sat, so the bar does not reshuffle under the pointer. */
  index: number;
}

/**
 * Keeps the open page's entry in the bar, marked finished, once the server
 * stops listing it. `pageKey` is the key the page had when last seen live
 * (null when it never was — nothing to keep); `kept` is the previous result.
 */
export function withFinished(
  entries: readonly BarEntry[],
  previous: readonly BarEntry[],
  pageKey: string | null,
  kept: FinishedKeep | null,
): { entries: BarEntry[]; kept: FinishedKeep | null } {
  if (pageKey === null || entries.some((e) => e.key === pageKey)) return { entries: [...entries], kept: null };
  const index = previous.findIndex((e) => e.key === pageKey);
  const keep: FinishedKeep | null = kept?.entry.key === pageKey
    ? kept
    : index >= 0 ? { entry: { ...previous[index], finished: true }, index } : null;
  if (!keep) return { entries: [...entries], kept: null };
  const out = [...entries];
  out.splice(Math.min(keep.index, out.length), 0, keep.entry);
  return { entries: out, kept: keep };
}

/**
 * Where `[` (-1) or `]` (+1) goes, cycling in bar order. From the overview
 * `]` opens the first item and `[` the last. A finished entry is skipped
 * unless it is the page being left.
 */
export function stepTarget(entries: readonly BarEntry[], currentKey: string | null, delta: 1 | -1): BarEntry | null {
  const reachable = entries.filter((e) => !e.finished || e.key === currentKey);
  if (reachable.length === 0) return null;
  const at = reachable.findIndex((e) => e.key === currentKey);
  if (at < 0) return delta === 1 ? reachable[0] : reachable[reachable.length - 1];
  const next = reachable[(at + delta + reachable.length) % reachable.length];
  return next.key === currentKey ? null : next;
}

/** A modal dialog (settings, search, guide, ...) makes the page behind it inert, bar shortcuts included. */
export function isModalOpen(root: Pick<ParentNode, "querySelector">): boolean {
  return root.querySelector('[aria-modal="true"]') !== null;
}

/** Keys typed into a field must reach the field, not the bar. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as Partial<HTMLElement> | null;
  if (!el || typeof el.tagName !== "string") return false;
  return el.isContentEditable === true || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}
