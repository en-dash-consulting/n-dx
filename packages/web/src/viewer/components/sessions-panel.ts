/**
 * Sessions tray — the third bottom-right pill, beside ActiveOperationsTray and
 * GitStatusBanner, answering "what is happening in the repository's other
 * checkouts?".
 *
 * Hench writes its runs into the worktree `ndx work` ran in, and `.hench/runs`
 * is untracked, so a dashboard served from the main checkout used to show no
 * sign at all of a session running in `.claude/worktrees/*`. The pill collapses
 * that to one line — "3 worktrees · 1 running" — and expands into a row per
 * worktree: its name (the anchor starred), branch, dirty count, and either the
 * run in flight with its elapsed time or the last one with its status, linking
 * through to that run in the Runs view.
 *
 * Deliberately read-only. Nothing here switches the dashboard's workspace —
 * the run link stays in this checkout's viewer and the Runs view resolves the
 * run with `?scope=repo`. The 0.8.0 release grows this into the Workspaces
 * Overview, which is where cross-worktree *actions* belong.
 *
 * Renders nothing outside a git repository or in a single-worktree one, where
 * every row would describe the checkout the reader is already looking at.
 */

import { h } from "preact";
import { useState } from "preact/hooks";
import type { WorktreeEntry, WorktreeLatestRun } from "../hooks/index.js";
import { useTick } from "../hooks/index.js";
import { fmtDuration, formatSince } from "../utils/format.js";
import type { NavigateTo } from "../types.js";

export interface SessionsPanelProps {
  /** null until the first fetch resolves. */
  worktrees: WorktreeEntry[] | null;
  navigateTo?: NavigateTo;
}

// ── Pure helpers (unit-tested) ───────────────────────────────────────

/**
 * Last path segment, for display. Two worktrees can share a basename, so this
 * is a label only — rows are keyed by the full path.
 */
export function worktreeName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return cut === -1 ? trimmed : trimmed.slice(cut + 1);
}

/** The pill's text. The running count is omitted when nothing is running. */
export function sessionsPillLabel(worktrees: readonly WorktreeEntry[]): string {
  const running = worktrees.reduce((n, wt) => n + wt.runs.running, 0);
  const trees = `${worktrees.length} worktree${worktrees.length === 1 ? "" : "s"}`;
  return running > 0 ? `${trees} · ${running} running` : trees;
}

/** The tray is for *other* checkouts; one worktree means there are none. */
export function shouldShowSessions(worktrees: WorktreeEntry[] | null): worktrees is WorktreeEntry[] {
  return worktrees !== null && worktrees.length > 1;
}

/** The working-tree cell: a count when dirty, "clean", or "?" when git could not say. */
export function dirtyLabel(entry: WorktreeEntry): { text: string; tone: "dirty" | "clean" | "unknown" } {
  if (entry.dirty === null || entry.dirtyFiles === null) return { text: "status unknown", tone: "unknown" };
  if (entry.dirtyFiles === 0) return { text: "clean", tone: "clean" };
  return { text: `${entry.dirtyFiles} uncommitted`, tone: "dirty" };
}

/** The branch cell. Detached and bare checkouts have no branch to name. */
export function branchLabel(entry: WorktreeEntry): string {
  if (entry.branch) return entry.branch;
  if (entry.bare) return "bare";
  return entry.detached ? "detached HEAD" : "no branch";
}

/**
 * The run cell, minus the live elapsed time (which only a component can tick).
 *
 * `elapsedFrom` is set for a running run, and the caller renders a ticking
 * duration from it; otherwise `detail` is already complete.
 */
export function runLine(latest: WorktreeLatestRun | null): {
  title: string;
  detail: string;
  elapsedFrom: string | null;
  tone: "running" | "ok" | "bad" | "idle";
} {
  if (!latest) return { title: "No runs recorded here", detail: "", elapsedFrom: null, tone: "idle" };

  const title = latest.taskTitle || latest.id;
  if (latest.status === "running") {
    return { title, detail: "running", elapsedFrom: latest.startedAt, tone: "running" };
  }

  const since = formatSince(latest.finishedAt ?? latest.startedAt);
  const failed = latest.status === "failed" || latest.status === "error";
  return {
    title,
    detail: since ? `${latest.status} · ${since}` : latest.status,
    elapsedFrom: null,
    tone: failed ? "bad" : "ok",
  };
}

function elapsedFormatter(startedAt: string): string {
  return fmtDuration(startedAt, new Date().toISOString());
}

// ── Rendering ────────────────────────────────────────────────────────

/** The ticking half of a running run's detail line, split out so the hook is unconditional. */
function RunElapsed({ startedAt }: { startedAt: string }) {
  return h("span", { class: "sessions-run-elapsed" }, ` · ${useTick(startedAt, elapsedFormatter)}`);
}

function WorktreeRow({ entry, navigateTo }: { entry: WorktreeEntry; navigateTo?: NavigateTo }) {
  const dirty = dirtyLabel(entry);
  const run = runLine(entry.runs.latest);
  const runId = entry.runs.latest?.id ?? null;

  return h("li", { class: `sessions-row${entry.isServed ? " sessions-row-served" : ""}` },
    h("div", { class: "sessions-row-head" },
      entry.isAnchor
        ? h("span", { class: "sessions-anchor-star", title: "Main worktree", "aria-label": "main worktree" }, "★")
        : null,
      h("span", { class: "sessions-name" }, worktreeName(entry.path)),
      h("code", { class: "sessions-branch" }, branchLabel(entry)),
      h("span", { class: `sessions-dirty sessions-dirty-${dirty.tone}` }, dirty.text),
    ),
    h("div", { class: `sessions-run sessions-run-${run.tone}` },
      h("span", { class: "sessions-run-title", title: run.title }, run.title),
      run.detail
        ? h("span", { class: "sessions-run-detail" },
            run.detail,
            run.elapsedFrom ? h(RunElapsed, { startedAt: run.elapsedFrom }) : null,
          )
        : null,
    ),
    runId && navigateTo
      ? h("button", {
          class: "sessions-run-link",
          type: "button",
          onClick: () => navigateTo("hench-runs", { runId }),
        }, "View run")
      : null,
  );
}

export function SessionsPanel({ worktrees, navigateTo }: SessionsPanelProps) {
  const [expanded, setExpanded] = useState(false);

  if (!shouldShowSessions(worktrees)) return null;

  const label = sessionsPillLabel(worktrees);
  const running = worktrees.some((wt) => wt.runs.running > 0);

  return h("div", { class: "sessions-panel", role: "status" },
    h("button", {
      class: "sessions-toggle",
      type: "button",
      onClick: () => setExpanded((v) => !v),
      "aria-expanded": String(expanded),
      "aria-label": `${label} — ${expanded ? "hide" : "show"} worktree sessions`,
    },
      h("span", {
        class: `sessions-badge-icon${running ? " spinning" : ""}`,
        "aria-hidden": "true",
      }, running ? "●" : "⌥"),
      h("span", { class: "sessions-summary" }, label),
    ),
    expanded
      ? h("ul", { class: "sessions-list", "aria-label": "Worktree sessions" },
          worktrees.map((entry) => h(WorktreeRow, { key: entry.path, entry, navigateTo })),
        )
      : null,
  );
}
