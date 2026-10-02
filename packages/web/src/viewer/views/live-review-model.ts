/**
 * Reading the running-task page's Review tab: where the run is in
 * Work → Validate → Review → Commit, how the review is going, and the
 * reviewer's findings as the page lists them. Pure — rendering is
 * `live-review.ts`.
 *
 * Severity, verdict, action and disposition arrive as plain text. The known
 * values get a label and an order; anything else is shown as written and sorts
 * last, so a finding is never dropped for being unfamiliar.
 *
 * @module web/viewer/views/live-review-model
 */

import type { LiveReviewFinding, LiveReviewReport, LiveTaskRun, RunEventLine } from "../hooks/index.js";

// ── Stage strip ──────────────────────────────────────────────────────

export type ReviewStageKey = "work" | "validate" | "review" | "commit";
export type ReviewStageState = "done" | "current" | "pending" | "stopped";

export interface ReviewStage {
  key: ReviewStageKey;
  label: string;
  state: ReviewStageState;
}

const STAGES: ReadonlyArray<{ key: ReviewStageKey; label: string }> = [
  { key: "work", label: "Work" },
  { key: "validate", label: "Validate" },
  { key: "review", label: "Review" },
  { key: "commit", label: "Commit" },
];

const VALIDATION_KINDS: readonly string[] = ["gate", "tests_run"];

function firstIndex(events: readonly RunEventLine[], kinds: readonly string[]): number {
  return events.findIndex((e) => kinds.includes(e.kind));
}

/** Index of the stage the run is in: the review runs after validation and before the commit. */
function currentStageIndex(events: readonly RunEventLine[]): number {
  if (firstIndex(events, ["review_report"]) >= 0) return 3;
  if (firstIndex(events, ["review_started"]) >= 0) return 2;
  if (firstIndex(events, VALIDATION_KINDS) >= 0) return 1;
  return 0;
}

/**
 * The four stages with the run's place among them. A finished run reads every
 * stage as done when it completed; otherwise the stage it stopped in is marked
 * stopped and the ones before it done.
 */
export function reviewStages(run: LiveTaskRun, events: readonly RunEventLine[]): ReviewStage[] {
  const at = currentStageIndex(events);
  const completed = run.status === "completed";
  const running = run.status === "running";
  return STAGES.map((stage, i) => {
    let state: ReviewStageState;
    if (completed || i < at) state = "done";
    else if (i === at) state = running ? "current" : "stopped";
    else state = "pending";
    return { ...stage, state };
  });
}

// ── Review state ─────────────────────────────────────────────────────

export type ReviewState = "waiting" | "running" | "done" | "failed" | "never-started";

export interface ReviewStatus {
  state: ReviewState;
  label: string;
  /** The reason the run recorded when the review did not produce a report, or why none ran. */
  reason: string | null;
}

/** Whether the review has started, is running, finished, or could not run. */
export function reviewStatus(run: LiveTaskRun, events: readonly RunEventLine[]): ReviewStatus {
  const failed = run.review?.failed ?? null;
  if (failed) {
    const detail = run.review?.detail;
    return { state: "failed", label: "Review did not complete", reason: detail ? `${failed}: ${detail}` : failed };
  }
  const reportEvent = events.find((e) => e.kind === "review_report");
  if (run.review || reportEvent) {
    // A report event that is not ok and carries no run record is a failure the record did not keep.
    if (!run.review && reportEvent?.ok === false) {
      return { state: "failed", label: "Review did not complete", reason: reportEvent.detail ?? reportEvent.summary };
    }
    return { state: "done", label: "Review finished", reason: null };
  }
  if (firstIndex(events, ["review_started"]) >= 0) return { state: "running", label: "Reviewing", reason: null };
  if (run.status === "running") return { state: "waiting", label: "Waiting for the review to start", reason: null };
  return {
    state: "never-started",
    label: "Review never started",
    reason: run.outcome ?? `The run ended (${run.status}) before the review started.`,
  };
}

/** The tab's marker next to its label: set only before the review has started. */
export function reviewTabMarker(run: LiveTaskRun, events: readonly RunEventLine[]): string | null {
  const { state } = reviewStatus(run, events);
  if (state === "waiting") return "waiting";
  if (state === "running") return "running";
  return null;
}

/** The reviewer's own lines from the progress events: started (model, resumed or fresh) and report. */
export function reviewerActivity(events: readonly RunEventLine[]): RunEventLine[] {
  return events.filter((e) => e.kind === "review_started" || e.kind === "review_report");
}

/**
 * What the run is doing now, once the reviewer has started: the latest step
 * after the reviewer's report (for example re-running tests after its fix).
 * Null before then and when the run is over.
 */
export function currentStep(run: LiveTaskRun, events: readonly RunEventLine[]): string | null {
  if (run.status !== "running") return null;
  let reportAt = -1;
  for (let i = events.length - 1; i >= 0 && reportAt < 0; i--) if (events[i].kind === "review_report") reportAt = i;
  if (reportAt < 0) return null;
  const later = events.slice(reportAt + 1);
  const last = later[later.length - 1];
  return last ? last.summary : null;
}

// ── Findings ─────────────────────────────────────────────────────────

const SEVERITY_ORDER: readonly string[] = ["critical", "high", "medium", "low"];
const VERDICT_LABEL: Readonly<Record<string, string>> = {
  "must-fix": "must fix",
  "should-fix": "should fix",
  "not-worth-fixing": "not worth fixing",
  "out-of-scope": "out of scope",
};
const ACTION_LABEL: Readonly<Record<string, string>> = {
  fixed: "fixed",
  captured: "captured to the PRD",
  dropped: "dropped",
  failed: "failed",
};
const ACTION_ORDER: readonly string[] = ["fixed", "captured", "dropped", "failed"];

/** The known label, or the text exactly as the report wrote it. */
function labelled(map: Readonly<Record<string, string>>, value: string | null): string | null {
  if (value === null) return null;
  return Object.prototype.hasOwnProperty.call(map, value) ? map[value]! : value;
}

export const verdictLabel = (value: string | null): string | null => labelled(VERDICT_LABEL, value);
export const actionLabel = (value: string | null): string | null => labelled(ACTION_LABEL, value);

/** The severity's class suffix: the known four, else "other" (the raw text still shows). */
export function severityClass(value: string | null): string {
  return value !== null && SEVERITY_ORDER.includes(value) ? value : "other";
}

function rank(order: readonly string[], value: string | null): number {
  const i = value === null ? -1 : order.indexOf(value);
  return i < 0 ? order.length : i;
}

/** A finding the reviewer decided not to act on: shown collapsed. */
export function isDropped(finding: LiveReviewFinding): boolean {
  return finding.action === "dropped";
}

export interface ReviewFindings {
  /** Fixed, captured and failed findings (and any action this build does not know), most severe first. */
  active: LiveReviewFinding[];
  /** Dropped findings, most severe first. */
  dropped: LiveReviewFinding[];
}

/** Findings split into the ones to read and the dropped ones, each most severe first. */
export function splitFindings(report: LiveReviewReport): ReviewFindings {
  const bySeverity = (a: LiveReviewFinding, b: LiveReviewFinding) =>
    rank(SEVERITY_ORDER, a.severity) - rank(SEVERITY_ORDER, b.severity);
  const active: LiveReviewFinding[] = [];
  const dropped: LiveReviewFinding[] = [];
  for (const finding of report.findings) (isDropped(finding) ? dropped : active).push(finding);
  return { active: active.sort(bySeverity), dropped: dropped.sort(bySeverity) };
}

export interface OutcomeCount {
  /** The action as recorded; "unrecorded" when a finding has none. */
  action: string;
  label: string;
  count: number;
}

/** Counts by what the reviewer did, the known actions first in a fixed order, then any others. */
export function outcomeCounts(report: LiveReviewReport): OutcomeCount[] {
  const counts = new Map<string, number>();
  for (const finding of report.findings) {
    const key = finding.action ?? "unrecorded";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => rank(ACTION_ORDER, a) - rank(ACTION_ORDER, b))
    .map(([action, count]) => ({ action, label: actionLabel(action) ?? action, count }));
}

// ── Side column ──────────────────────────────────────────────────────

/** Which setting chose the reviewer's model, in words. */
export function modelSourceLabel(source: string | null, vendor: string | null): string {
  switch (source) {
    case "flag": return "--review-model";
    case "vendor-config": return `llm.${vendor ?? "<vendor>"}.reviewModel`;
    case "shared-config": return "llm.reviewModel";
    case "vendor-default": return "the vendor default";
    case null: return "not recorded";
    default: return source;
  }
}

/** The title of a finding, falling back through what the report did record. */
export function findingTitle(finding: LiveReviewFinding): string {
  return finding.title ?? finding.scenario ?? finding.location ?? "Untitled finding";
}
