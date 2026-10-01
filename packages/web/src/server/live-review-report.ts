/**
 * The adversarial review's report, read for the running-task page's Review tab.
 *
 * Hench writes `.hench/reviews/<runId>.json` once, when the reviewer finishes.
 * The web package has no hench dependency and no gateway to one, so the file is
 * read from disk and typed here, the way `RunSummary` is in `routes-hench.ts`.
 * The field names and value sets mirror `ReviewReport` / `ReviewFinding` in
 * hench's `agent/analysis/adversarial-review.ts`.
 *
 * Nothing in the file is trusted to be present or recognised: every field is
 * optional, and a severity, verdict, action or disposition this build does not
 * know passes through as the raw text it was written with — a finding is never
 * dropped for being unfamiliar.
 *
 * @module web/server/live-review-report
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isValidRunId } from "./run-tail.js";

/** `ReviewFinding` as the file may hold it: every field optional, enums as plain text. */
interface ReviewFindingFile {
  title?: unknown;
  location?: unknown;
  severity?: unknown;
  verdict?: unknown;
  scenario?: unknown;
  action?: unknown;
  itemId?: unknown;
  note?: unknown;
  disposition?: unknown;
  reason?: unknown;
}

/** `ReviewReport` as the file may hold it. */
interface ReviewReportFile {
  taskId?: unknown;
  findings?: unknown;
  fixesApplied?: unknown;
  summary?: unknown;
}

/** One finding as the page gets it: text or null, never a dropped field. */
export interface LiveReviewFinding {
  title: string | null;
  location: string | null;
  /** Known values: critical, high, medium, low. Anything else arrives as written. */
  severity: string | null;
  /** Known values: must-fix, should-fix, not-worth-fixing, out-of-scope. */
  verdict: string | null;
  scenario: string | null;
  /** Known values: fixed, captured, dropped, failed. */
  action: string | null;
  /** Rex item id, for a finding captured to the PRD. */
  itemId: string | null;
  note: string | null;
  /** Known values: fixed, dropped, offered, deferred. */
  disposition: string | null;
  reason: string | null;
}

export interface LiveReviewReport {
  taskId: string | null;
  findings: LiveReviewFinding[];
  fixesApplied: boolean | null;
  summary: string | null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

const EMPTY_FINDING: LiveReviewFinding = {
  title: null, location: null, severity: null, verdict: null, scenario: null,
  action: null, itemId: null, note: null, disposition: null, reason: null,
};

function findingOf(raw: unknown): LiveReviewFinding | null {
  // A bare string is a finding with nothing but a title; other shapes are not findings.
  if (typeof raw === "string") return raw ? { ...EMPTY_FINDING, title: raw } : null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const f = raw as ReviewFindingFile;
  return {
    title: text(f.title),
    location: text(f.location),
    severity: text(f.severity),
    verdict: text(f.verdict),
    scenario: text(f.scenario),
    action: text(f.action),
    itemId: text(f.itemId),
    note: text(f.note),
    disposition: text(f.disposition),
    reason: text(f.reason),
  };
}

/** Reduce parsed JSON to the page's shape. Null when it is not an object at all. */
export function normalizeReviewReport(parsed: unknown): LiveReviewReport | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const r = parsed as ReviewReportFile;
  const findings = Array.isArray(r.findings)
    ? r.findings.map(findingOf).filter((f): f is LiveReviewFinding => f !== null)
    : [];
  return {
    taskId: text(r.taskId),
    findings,
    fixesApplied: typeof r.fixesApplied === "boolean" ? r.fixesApplied : null,
    summary: text(r.summary),
  };
}

/**
 * The run's review report, or null while there is none (not written yet, a
 * review that failed, or a file that is not JSON).
 *
 * @param henchDir The served worktree's hench directory — the same one its
 *   run records are read from, so the report is the one beside the run.
 */
export function readLiveReviewReport(henchDir: string, runId: string): LiveReviewReport | null {
  if (!isValidRunId(runId)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(henchDir, "reviews", `${runId}.json`), "utf-8"));
  } catch {
    return null;
  }
  return normalizeReviewReport(parsed);
}
