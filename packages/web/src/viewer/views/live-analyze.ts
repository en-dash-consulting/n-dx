/**
 * The Live analysis page (`/live/analyze`, under `/w/<key>/` for another
 * worktree): the sourcevision analyze that is running in this worktree, or
 * the last one that ran.
 *
 * Header: where this is, the title by mode, chips (running and elapsed, the
 * estimate from the previous run of the same mode, worktree, where it was
 * started from, enrichment model, cost so far), Copy link and Stop analysis.
 * The main card has the six-segment bar, each phase with its time against the
 * previous run — Zones expanding into enrichment passes with the current
 * batch — and the output. The side column has model calls by task class,
 * judgment-cache reuse, the files written, notes and recent analyses.
 *
 * One analysis per worktree: another worktree's is its own page under its
 * `/w/<key>/` prefix, reached from the running-now bar. Reading the data is
 * `live-analyze-model.ts`.
 *
 * @module web/viewer/views/live-analyze
 */

import { h } from "preact";
import type { ComponentChildren } from "preact";
import { useState, useCallback, useEffect, useRef } from "preact/hooks";
import type { NavigateTo } from "../types.js";
import { useLiveAnalyze, useTick, useCliName, type LiveAnalyzeSnapshot } from "../hooks/index.js";
import { fmtDuration, formatSince } from "../utils/format.js";
import { formatUsd } from "./live-model.js";
import {
  analyzeTitle,
  barSegments,
  batchLabel,
  cacheReuse,
  classRows,
  failureSummary,
  fileRows,
  formatMs,
  headerChips,
  historyLine,
  narrationLine,
  costScopeLabel,
  passRows,
  phaseRows,
  phaseTimeLabel,
  runState,
  runningNotes,
  type PassRow,
  type PhaseRow,
} from "./live-analyze-model.js";

export interface LiveAnalyzeViewProps {
  navigateTo: NavigateTo;
}

async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? `${fallback} (HTTP ${res.status})`;
}

function Elapsed({ startedAt }: { startedAt: string }) {
  return h("span", null, useTick(startedAt, (s) => fmtDuration(s, new Date().toISOString())));
}

// ── Header ───────────────────────────────────────────────────────────

interface HeaderProps {
  snapshot: LiveAnalyzeSnapshot;
  navigateTo: NavigateTo;
  refresh: () => Promise<void>;
}

function Header({ snapshot, navigateTo, refresh }: HeaderProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const progress = snapshot.progress;
  const state = runState(progress);
  const running = state === "running";

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setNotice("Link copied");
    } catch {
      setNotice("Could not copy the link");
    }
  }, []);

  const stop = useCallback(async () => {
    const fromTerminal = snapshot.startedFrom === "terminal";
    if (!window.confirm(
      fromTerminal
        ? `Stop this analysis? It was started from a terminal; its process (pid ${progress?.pid ?? "unknown"}) is sent a stop signal.`
        : "Stop this analysis? The analyzer is interrupted after its current step.",
    )) return;
    setStopping(true);
    setNotice(null);
    try {
      // A dashboard run is stopped through the handle that spawned it; any other by the pid it recorded.
      const res = await fetch(fromTerminal ? "/api/live/analyze/stop" : "/api/commands/sv-analyze/stop", { method: "POST" });
      setNotice(res.ok ? "Stop requested" : await errorOf(res, "Could not stop the analysis"));
      await refresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Request failed");
    } finally {
      setStopping(false);
    }
  }, [snapshot.startedFrom, progress?.pid, refresh]);

  const chips = headerChips(snapshot);
  const statusText = running ? "running" : state === "none" ? "no analysis yet" : state;
  return h("header", { class: "live-task-header" },
    h("nav", { class: "live-task-route", "aria-label": "Location" },
      h("a", { href: "#", onClick: (e: MouseEvent) => { e.preventDefault(); navigateTo("live"); } }, "Live"),
      h("span", { "aria-hidden": "true" }, " / "),
      h("span", null, "Analysis"),
      progress ? h("span", { class: "live-task-position" }, ` · started ${formatSince(progress.startedAt) ?? progress.startedAt}`) : null,
      progress?.command ? h("code", { class: "live-analyze-command" }, progress.command) : null,
    ),
    h("div", { class: "live-header" },
      h("h2", { class: "live-task-title" }, analyzeTitle(progress)),
      h("div", { class: "live-actions" },
        h("button", { type: "button", class: "cmd-btn cmd-btn-secondary", onClick: copyLink }, "Copy link"),
        running ? h("button", {
          type: "button", class: "cmd-btn cmd-btn-secondary live-stop", disabled: stopping, onClick: () => { void stop(); },
        }, stopping ? "Stopping…" : "Stop analysis") : null,
        notice ? h("span", { class: "live-notice", role: "status" }, notice) : null,
      ),
    ),
    h("div", { class: "live-card-meta live-task-chips" },
      h("span", { class: `live-chip live-task-status live-task-status-${running ? "running" : state === "complete" ? "completed" : state === "none" ? "idle" : "failed"}` },
        statusText,
        progress ? [" · ", running ? h(Elapsed, { key: "e", startedAt: progress.startedAt }) : progress.endedAt ? fmtDuration(progress.startedAt, progress.endedAt) : null] : null),
      chips.map((chip) => h("span", { key: chip.key, class: `live-chip${chip.warn ? " live-chip-warn" : ""}` }, chip.label)),
    ),
  );
}

// ── Phases ───────────────────────────────────────────────────────────

function OverallBar({ rows }: { rows: readonly PhaseRow[] }) {
  const segments = barSegments(rows);
  const done = segments.filter((s) => s === "done").length;
  return h("div", {
    class: "live-analyze-bar",
    role: "progressbar",
    "aria-label": "Analysis phases",
    "aria-valuemin": 0,
    "aria-valuemax": rows.length,
    "aria-valuenow": done,
    "aria-valuetext": `${done} of ${rows.length} phases done`,
  }, rows.map((row, i) => h("div", { key: row.name, class: "live-analyze-seg" },
    h("span", { class: `live-phase live-phase-${segments[i]}` }),
    h("span", { class: "live-analyze-seg-label" }, row.label),
  )));
}

const STATE_MARK: Record<PhaseRow["state"], string> = { done: "✓", active: "●", pending: "○", failed: "✕", skipped: "–" };
const STATE_WORD: Record<PhaseRow["state"], string> = { done: "done", active: "running", pending: "waiting", failed: "failed", skipped: "not run" };

function Passes({ rows, cache }: { rows: PassRow[]; cache: string | null }) {
  return h("ol", { class: "live-analyze-passes", "aria-label": "Enrichment passes" }, rows.map((pass) =>
    h("li", { key: pass.number, class: `live-analyze-pass live-analyze-pass-${pass.state}`, "aria-current": pass.state === "active" ? "step" : undefined },
      h("span", { class: "live-criterion-mark", "aria-hidden": "true" }, pass.state === "done" ? "✓" : pass.state === "active" ? "●" : "○"),
      h("span", { class: "live-step-text" },
        h("span", { class: "live-card-title" }, `Pass ${pass.number} · ${pass.label}`),
        pass.batch ? h("span", { class: "live-step-detail" }, batchLabel(pass.batch)) : null,
        pass.state === "active" && cache ? h("span", { class: "live-step-detail" }, `Judgments: ${cache}`) : null,
      ),
    )));
}

function PhaseList({ rows, passes, cache }: { rows: PhaseRow[]; passes: PassRow[]; cache: string | null }) {
  return h("ol", { class: "live-analyze-phases", "aria-label": "Phases" }, rows.map((row, i) =>
    h("li", {
      key: row.name,
      class: `live-analyze-phase live-analyze-phase-${row.state}`,
      "aria-current": row.state === "active" ? "step" : undefined,
    },
      h("span", { class: `live-analyze-mark live-analyze-mark-${row.state}`, "aria-hidden": "true" }, STATE_MARK[row.state]),
      h("div", { class: "live-analyze-phase-body" },
        h("div", { class: "live-analyze-phase-head" },
          h("span", { class: "live-card-title" }, `${i + 1}. ${row.label}`),
          row.optional ? h("span", { class: "live-chip" }, "optional") : null,
          h("span", { class: "sr-only" }, ` (${STATE_WORD[row.state]})`),
          h("span", { class: "live-analyze-time" }, phaseTimeLabel(row) ?? ""),
        ),
        h("span", { class: "live-step-detail" },
          row.state === "failed" && row.tolerated ? "Failed, but this phase is optional: the run went on without it." : row.result ?? row.does),
        row.name === "zones" && passes.length > 0 ? h(Passes, { rows: passes, cache }) : null,
      ),
    )));
}

// ── Output ───────────────────────────────────────────────────────────

function OutputTail({ snapshot }: { snapshot: LiveAnalyzeSnapshot }) {
  const preRef = useRef<HTMLPreElement>(null);
  const [following, setFollowing] = useState(true);
  const programmatic = useRef(false);
  const lines = snapshot.output.lines;

  useEffect(() => {
    const el = preRef.current;
    if (!el || !following) return;
    programmatic.current = true;
    el.scrollTop = el.scrollHeight;
  }, [lines.length, lines.at(-1), following]);

  const onScroll = useCallback(() => {
    const el = preRef.current;
    if (!el) return;
    if (programmatic.current) { programmatic.current = false; return; }
    setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < 8);
  }, []);

  if (!snapshot.output.available) {
    return h("p", { class: "live-muted" },
      snapshot.startedFrom === "terminal"
        ? "This analysis was started from a terminal; its output is in that terminal. Progress above is read from the file the analyzer writes."
        : "No output recorded: the dashboard has not run an analysis here.");
  }
  return h("div", { class: "live-steps-wrap" },
    lines.length === 0
      ? h("p", { class: "live-muted", role: "status" }, "Waiting for the first line of output…")
      : h("pre", { class: "live-log-lines live-analyze-output", ref: preRef, onScroll, "aria-label": "Output", tabIndex: 0 }, lines.join("\n")),
    following ? null : h("button", { type: "button", class: "cmd-btn cmd-btn-secondary live-follow", onClick: () => setFollowing(true) }, "Follow"),
  );
}

// ── Side column ──────────────────────────────────────────────────────

function Section({ id, title, children }: { id: string; title: string; children?: ComponentChildren }) {
  return h("section", { class: "live-side-section", "aria-labelledby": id },
    h("h3", { id, class: "live-side-title" }, title),
    children,
  );
}

function CallsSection({ snapshot }: { snapshot: LiveAnalyzeSnapshot }) {
  const progress = snapshot.progress;
  const classes = classRows(progress);
  const cache = cacheReuse(progress);
  return h(Section, { id: "la-calls-h", title: "Model calls" },
    progress?.mode === "fast"
      ? h("p", { class: "live-muted" }, "A fast analysis makes no model calls.")
      : classes.length === 0
        ? h("p", { class: "live-muted" }, "No model calls yet.")
        : h("table", { class: "live-analyze-table" },
          h("thead", null, h("tr", null,
            h("th", { scope: "col" }, "Task class"), h("th", { scope: "col" }, "Calls"), h("th", { scope: "col" }, "Tokens"), h("th", { scope: "col" }, "Time"))),
          h("tbody", null, classes.map((c) => h("tr", { key: c.name, title: c.model },
            h("th", { scope: "row" }, c.name), h("td", null, c.calls), h("td", null, c.tokens), h("td", null, formatMs(c.durationMs)))))),
    cache ? h("p", { class: "live-step-detail" }, `Judgment cache: ${cache.label}`) : null,
    progress && progress.llm.calls > 0 ? h("p", { class: "live-step-detail" }, `${formatUsd(snapshot.costUsd)} ${costScopeLabel(progress)} (input and output tokens)`) : null,
  );
}

const FILE_WORD = { written: "written this run", previous: "previous run's", error: "error", pending: "not written" } as const;

function FilesSection({ snapshot }: { snapshot: LiveAnalyzeSnapshot }) {
  return h(Section, { id: "la-files-h", title: "Files in .sourcevision/" },
    h("ul", { class: "live-recent" }, fileRows(snapshot).map((f) =>
      h("li", { key: f.file, class: "live-analyze-file" },
        h("span", { class: "live-mono" }, f.file),
        h("span", { class: `live-analyze-file-state live-analyze-file-${f.state}` }, FILE_WORD[f.state])))),
  );
}

function NotesSection({ snapshot }: { snapshot: LiveAnalyzeSnapshot }) {
  const cliName = useCliName();
  const narration = narrationLine(snapshot.narration);
  const running = runState(snapshot.progress) === "running";
  const notes = [...(running ? runningNotes(snapshot, cliName) : []), ...(narration ? [narration] : [])];
  if (notes.length === 0) return null;
  return h(Section, { id: "la-notes-h", title: "Notes" },
    h("ul", { class: "live-analyze-notes" }, notes.map((note, i) => h("li", { key: i }, note))));
}

function RecentSection({ snapshot }: { snapshot: LiveAnalyzeSnapshot }) {
  return h(Section, { id: "la-recent-h", title: "Recent analyses" },
    snapshot.recent.length === 0
      ? h("p", { class: "live-muted" }, "No analyses recorded yet.")
      : h("ul", { class: "live-recent" }, snapshot.recent.map((run) =>
        h("li", { key: run.at },
          h("span", { class: "live-card-title" }, formatSince(run.at) ?? run.at),
          h("span", { class: "live-card-chain" }, historyLine(run))))),
  );
}

// ── View ─────────────────────────────────────────────────────────────

export function LiveAnalyzeView({ navigateTo }: LiveAnalyzeViewProps) {
  const cliName = useCliName();
  const { snapshot, error, refresh } = useLiveAnalyze();
  const [now, setNow] = useState(() => Date.now());
  const running = snapshot?.progress?.running === true;

  // Phase times of the running phase count up between snapshots.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  if (snapshot === null) {
    return h("div", { class: "live-container live-task" }, h("p", { class: "live-muted", role: "status" }, error ?? "Loading…"));
  }

  const progress = snapshot.progress;
  const state = runState(progress);
  const rows = phaseRows(snapshot, now);
  const failure = failureSummary(snapshot, rows);
  const cache = cacheReuse(progress);
  const verdict = state === "complete" ? "This analysis finished."
    : state === "stopped" ? "This analysis was stopped."
      : state === "failed" ? "This analysis failed."
        : state === "interrupted" ? "This analysis ended without finishing." : null;

  return h("div", { class: "live-container live-task" },
    h(Header, { key: "header", snapshot, navigateTo, refresh }),
    verdict
      ? h("p", { key: "done", class: "live-task-finished", role: "status" },
        verdict, " ",
        failure ? h("span", null,
          failure.phase ? `It stopped in the ${failure.phase} phase. ` : "",
          failure.error ? h("code", { class: "live-analyze-error" }, failure.error) : null, " ") : null,
        h("a", { href: "#", onClick: (e: MouseEvent) => { e.preventDefault(); navigateTo("analyze"); } }, "Open the Analysis stage"))
      : null,
    progress === null
      ? h("p", { key: "none", class: "live-muted" }, `No analysis has run in this worktree yet. Run ${cliName} analyze, or start one from the Analysis stage.`)
      : h("div", { key: "body", class: "live-body" },
        h("section", { class: "live-main live-task-card live-analyze-card", "aria-label": "Analysis" },
          h(OverallBar, { rows }),
          h(PhaseList, { rows, passes: passRows(snapshot), cache: cache?.label ?? null }),
          h("div", { class: "live-log-tail" },
            h("div", { class: "live-log-tail-head" }, h("span", { class: "live-side-title" }, "Output")),
            h(OutputTail, { snapshot }),
          ),
        ),
        h("aside", { class: "live-side", "aria-label": "Model use and files" },
          h(CallsSection, { snapshot }),
          h(FilesSection, { snapshot }),
          h(NotesSection, { snapshot }),
          h(RecentSection, { snapshot }),
        ),
      ),
  );
}
