/**
 * Reading the Live analysis snapshot — pure functions, so every state the
 * acceptance criteria name (time against the last run, no estimate without a
 * previous run, a stopped or failed run naming its phase) is testable without
 * a DOM. `live-analyze.ts` only lays these answers out.
 *
 * @module web/viewer/views/live-analyze-model
 */

import type { AnalyzeProgressFile, LiveAnalyzeSnapshot } from "../hooks/index.js";
import { formatTokenCount } from "../utils/format.js";
import { formatUsd } from "./live-model.js";

// ── Phases ───────────────────────────────────────────────────────────

export interface PhaseSpec {
  /** The name `sv analyze` reports (and the manifest module). */
  name: string;
  label: string;
  does: string;
  /** A failure here does not fail the run. */
  optional: boolean;
  /** The `.sourcevision/` file this phase writes. */
  file: string;
}

/** The six phases of `sv analyze`, in order (`executePhases` in sourcevision's analyze command). */
export const ANALYZE_PHASES: readonly PhaseSpec[] = [
  { name: "inventory", label: "Inventory", does: "Walks the tree and lists every source file with its language and role.", optional: false, file: "inventory.json" },
  { name: "imports", label: "Imports", does: "Resolves import statements into a file-to-file graph.", optional: false, file: "imports.json" },
  { name: "classifications", label: "Classifications", does: "Gives each file an archetype from its path, exports and imports.", optional: false, file: "classifications.json" },
  { name: "zones", label: "Zones", does: "Groups files into architectural zones, then enriches them in passes.", optional: false, file: "zones.json" },
  { name: "components", label: "Components", does: "Catalogs UI components, their usage and the route structure.", optional: false, file: "components.json" },
  { name: "callgraph", label: "Call graph", does: "Maps which functions call which. Optional: a failure here does not fail the run.", optional: true, file: "callgraph.json" },
];

/** Mirrors `describePass` in sourcevision's enrich-config for passes 0–4. */
export const ENRICHMENT_PASSES: readonly { number: number; label: string }[] = [
  { number: 0, label: "Automated heuristic" },
  { number: 1, label: "Zone naming and initial observations" },
  { number: 2, label: "Cross-zone relationships" },
  { number: 3, label: "Anti-pattern detection" },
  { number: 4, label: "Suggestions and risk areas" },
];

export type PhaseState = "done" | "active" | "pending" | "failed" | "skipped";

export interface PhaseRow extends PhaseSpec {
  state: PhaseState;
  /** Wall-clock so far (active) or in total (ended); null before the phase starts. */
  durationMs: number | null;
  /** The same phase's time in the previous run of this mode; null without one. */
  previousMs: number | null;
  /** What the phase produced, once this run finished it. */
  result: string | null;
  /** Failed, but the run went on and completed (an optional phase). */
  tolerated: boolean;
}

/** Wall-clock ms as "4m 10s". */
export function formatMs(ms: number): string {
  const secs = Math.max(0, Math.round(ms / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function phaseRows(snapshot: LiveAnalyzeSnapshot, now: number): PhaseRow[] {
  const progress = snapshot.progress;
  return ANALYZE_PHASES.map((spec): PhaseRow => {
    const entry = progress?.phases.find((p) => p.name === spec.name);
    const previousMs = progress?.previous?.phases[spec.name] ?? null;
    const result = snapshot.results[spec.name] ?? null;
    if (!progress || !entry) {
      // No entry: not reached yet while the run goes, otherwise not run at all.
      const idle = progress?.running === true || progress === null;
      return { ...spec, state: idle ? "pending" : "skipped", durationMs: null, previousMs, result, tolerated: false };
    }
    if (entry.outcome === "ok") {
      return { ...spec, state: "done", durationMs: entry.durationMs ?? null, previousMs, result, tolerated: false };
    }
    if (entry.outcome === "failed" || !progress.running) {
      // An unended phase of a run that is no longer going is where it stopped.
      return {
        ...spec,
        state: "failed",
        durationMs: entry.durationMs ?? Math.max(0, Date.parse(progress.updatedAt) - Date.parse(entry.startedAt)),
        previousMs,
        result: null,
        tolerated: spec.optional && progress.status === "complete",
      };
    }
    return { ...spec, state: "active", durationMs: Math.max(0, now - Date.parse(entry.startedAt)), previousMs, result: null, tolerated: false };
  });
}

/** "1m 12s · last 1m 40s", or just the time when there is no previous run. */
export function phaseTimeLabel(row: PhaseRow): string | null {
  if (row.durationMs === null) return row.previousMs === null ? null : `last ${formatMs(row.previousMs)}`;
  return row.previousMs === null ? formatMs(row.durationMs) : `${formatMs(row.durationMs)} · last ${formatMs(row.previousMs)}`;
}

export type PassState = "done" | "active" | "pending";

export interface PassRow {
  number: number;
  label: string;
  state: PassState;
  /** Batch progress, on the active pass only. */
  batch: { label: string; done: number; total: number } | null;
}

/**
 * The enrichment passes inside the zones phase. None for a fast run (it makes
 * no LLM calls) or before zones starts. While zones runs, passes before the
 * current one are done; once it has ended, the passes zones.json records.
 */
export function passRows(snapshot: LiveAnalyzeSnapshot): PassRow[] {
  const progress = snapshot.progress;
  const zones = progress?.phases.find((p) => p.name === "zones");
  if (!progress || !zones || progress.mode === "fast") return [];
  const active = zones.outcome === undefined && progress.running;
  const current = active ? progress.pass?.number ?? null : null;
  const through = zones.outcome === "ok" ? snapshot.enrichmentPass : null;
  const rows = ENRICHMENT_PASSES.map((p): PassRow => {
    const state: PassState = active
      ? current === null ? "pending" : p.number < current ? "done" : p.number === current ? "active" : "pending"
      : through !== null && p.number <= through ? "done" : "pending";
    return { ...p, state, batch: state === "active" ? progress.batch : null };
  });
  // A pass outside 0–4 (the cascade's single judged pass, or a meta-evaluation) has no fixed label.
  if (current !== null && !ENRICHMENT_PASSES.some((p) => p.number === current) && progress.pass) {
    rows.push({ number: current, label: progress.pass.label, state: "active", batch: progress.batch });
  }
  return rows;
}

export function batchLabel(batch: { label: string; done: number; total: number }): string {
  return `${batch.label} ${batch.done} of ${batch.total}`;
}

// ── Run state and header ─────────────────────────────────────────────

export type AnalyzeRunState = "none" | "running" | "complete" | "failed" | "stopped" | "interrupted";

/** A stop signal ends the analyzer with "Stopped (SIGTERM)" as its error. */
export function runState(progress: AnalyzeProgressFile | null): AnalyzeRunState {
  if (!progress) return "none";
  if (progress.running) return "running";
  if (progress.status === "interrupted") return "interrupted";
  if (progress.status === "failed") return progress.error?.startsWith("Stopped (") ? "stopped" : "failed";
  return "complete";
}

/** Fast runs make no LLM calls; every other mode is the deep analysis. */
export function analyzeTitle(progress: AnalyzeProgressFile | null): string {
  if (!progress) return "Sourcevision analysis";
  return progress.mode === "fast" ? "Fast analysis" : "Deep analysis";
}

export interface Chip {
  key: string;
  label: string;
  warn?: boolean;
}

/**
 * The header chips other than the status/elapsed one: the estimate (only when
 * a previous run of the same mode exists), worktree, where it was started
 * from, the enrichment model (only when the mode uses one) and the cost.
 */
export function headerChips(snapshot: LiveAnalyzeSnapshot): Chip[] {
  const progress = snapshot.progress;
  const chips: Chip[] = [];
  if (progress?.running && progress.previous && progress.previous.durationMs > 0) {
    chips.push({ key: "estimate", label: `estimate ${formatMs(progress.previous.durationMs)} (last ${progress.mode === "fast" ? "fast" : "deep"} run)` });
  }
  chips.push({ key: "worktree", label: snapshot.worktree.branch ?? snapshot.worktree.name });
  if (snapshot.startedFrom) chips.push({ key: "from", label: snapshot.startedFrom === "dashboard" ? "started from the dashboard" : "started from a terminal" });
  if (progress && progress.mode !== "fast") {
    const { vendor, model } = snapshot.llm;
    const named = [vendor, model].filter(Boolean).join(" · ");
    if (named) chips.push({ key: "model", label: named });
    if (progress.llm.calls > 0) chips.push({ key: "cost", label: `${formatUsd(snapshot.costUsd)} so far` });
  }
  if (progress?.scope) chips.push({ key: "scope", label: `in ${progress.scope}` });
  return chips;
}

export type SegmentState = "done" | "active" | "failed" | "pending";

/** The overall bar's six segments. */
export function barSegments(rows: readonly PhaseRow[]): SegmentState[] {
  return rows.map((r): SegmentState => (r.state === "done" ? "done" : r.state === "active" ? "active" : r.state === "failed" && !r.tolerated ? "failed" : "pending"));
}

/** Where a failed or stopped run stopped, and what it said. Null for a run that is going or finished well. */
export function failureSummary(snapshot: LiveAnalyzeSnapshot, rows: readonly PhaseRow[]): { phase: string | null; error: string | null; stopped: boolean } | null {
  const state = runState(snapshot.progress);
  if (state !== "failed" && state !== "stopped" && state !== "interrupted") return null;
  const where = rows.find((r) => r.state === "failed" && !r.tolerated);
  const fromOutput = [...snapshot.output.lines].reverse().find((l) => /fail|error/i.test(l)) ?? null;
  const error = snapshot.progress?.error ?? fromOutput
    ?? (state === "interrupted" ? "The analyzing process ended without recording an outcome." : null);
  return { phase: where?.label ?? null, error, stopped: state === "stopped" };
}

// ── Side column ──────────────────────────────────────────────────────

export interface ClassRow {
  name: string;
  calls: number;
  tokens: string;
  durationMs: number;
  model: string;
}

/** Model calls by task class, the slowest first. */
export function classRows(progress: AnalyzeProgressFile | null): ClassRow[] {
  return Object.entries(progress?.llm.byTaskClass ?? {})
    .map(([name, u]) => ({ name, calls: u.calls, tokens: formatTokenCount(u.inputTokens + u.outputTokens), durationMs: u.durationMs, model: u.model }))
    .sort((a, b) => b.durationMs - a.durationMs || a.name.localeCompare(b.name));
}

/** Judgment-cache reuse as "12 of 40 (30%)", or null when no judgment was asked for. */
export function cacheReuse(progress: AnalyzeProgressFile | null): { hits: number; total: number; label: string } | null {
  const { hits = 0, misses = 0 } = progress?.judgmentCache ?? {};
  const total = hits + misses;
  if (total === 0) return null;
  return { hits, total, label: `${hits} of ${total} reused (${Math.round((hits / total) * 100)}%)` };
}

export type FileState = "written" | "previous" | "error" | "pending";

export interface FileRow {
  file: string;
  state: FileState;
}

/**
 * Which `.sourcevision/` files the manifest lists, by whether this run wrote
 * them: a module completed at or after the run started was written now, an
 * earlier completion is the previous run's still on disk.
 */
export function fileRows(snapshot: LiveAnalyzeSnapshot): FileRow[] {
  const startedMs = snapshot.progress ? Date.parse(snapshot.progress.startedAt) : NaN;
  return ANALYZE_PHASES.map((spec): FileRow => {
    const module = snapshot.modules.find((m) => m.name === spec.name);
    if (!module) return { file: spec.file, state: "pending" };
    if (module.status === "error") return { file: spec.file, state: "error" };
    if (module.status !== "complete") return { file: spec.file, state: "pending" };
    const completedMs = module.completedAt ? Date.parse(module.completedAt) : NaN;
    return { file: spec.file, state: Number.isFinite(startedMs) && completedMs >= startedMs ? "written" : "previous" };
  });
}

/** Notes shown while a run is going. */
export function runningNotes(snapshot: LiveAnalyzeSnapshot): string[] {
  const notes = [
    "The analysis pages show the previous run until this one finishes.",
    "Hold ndx ci and ndx refresh: they also write .sourcevision/.",
  ];
  if (snapshot.progress && snapshot.progress.mode !== "fast") {
    notes.push("Zones the judgments cannot settle are narrated in the background after the run; names and insights land in zones.json when that ends.");
  }
  return notes;
}

/** The manifest's background-narration state, said in a sentence; null when there is none. */
export function narrationLine(narration: LiveAnalyzeSnapshot["narration"]): string | null {
  if (!narration) return null;
  const zones = `${narration.zones} ${narration.zones === 1 ? "zone" : "zones"}`;
  if (narration.status === "pending") return `Narrating ${zones} in the background.`;
  if (narration.status === "done") return `Narrated ${zones} in the background.`;
  return `Background narration of ${zones} failed${narration.reason ? `: ${narration.reason}` : ""}.`;
}

/** "cascade · 4m 10s · 12 calls · $0.41" for a past run. */
export function historyLine(run: LiveAnalyzeSnapshot["recent"][number]): string {
  const parts = [run.mode, formatMs(run.durationMs)];
  if (run.calls > 0) parts.push(`${run.calls} ${run.calls === 1 ? "call" : "calls"}`);
  if (run.costUsd !== null) parts.push(formatUsd(run.costUsd));
  return parts.join(" · ");
}
