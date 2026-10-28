/**
 * Loads a run's classifier inputs from disk and records the verdict.
 *
 * The file side of {@link classifyRun}: the run's events JSONL, its review
 * report and the task's earlier runs are read here, so the classifier itself
 * stays pure. Shared by `hench runs diagnose` and the run-end path.
 *
 * @module hench/agent/lifecycle/run-diagnosis
 */

import { readFile } from "node:fs/promises";
import type { PRDStore } from "../../prd/rex-gateway.js";
import type { RunDiagnosis, RunRecord } from "../../schema/index.js";
import { listRuns } from "../../store/runs.js";
import { runEventsPath, type RunEvent } from "../../store/run-events.js";
import { parseReviewReport, reviewReportPath, type ReviewReport } from "../analysis/adversarial-review.js";
import { classifyRun, countAttempts } from "../analysis/run-verdict.js";
import { rexDirName } from "./uncommitted-work-gate.js";

/** Parse a run's events JSONL. Missing file → `[]`; malformed lines are skipped. */
export async function readRunEvents(path: string): Promise<RunEvent[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return [];
  }
  const events: RunEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as RunEvent;
      if (parsed && typeof parsed.kind === "string") events.push(parsed);
    } catch {
      // A torn last line (the run was killed mid-write) is narration lost, not a verdict lost.
    }
  }
  return events;
}

/** The run's review report: the path its record names, else the conventional one. */
export async function readRunReview(henchDir: string, run: RunRecord): Promise<ReviewReport | null> {
  const path = run.review?.reportPath ?? reviewReportPath(henchDir, run.id);
  try {
    return parseReviewReport(await readFile(path, "utf-8"));
  } catch {
    return null;
  }
}

/** Classify `run` from what is on disk. `runs` defaults to every run under `henchDir`. */
export async function diagnoseRun(
  projectDir: string,
  henchDir: string,
  run: RunRecord,
  runs?: readonly RunRecord[],
): Promise<RunDiagnosis> {
  const [events, review, allRuns] = await Promise.all([
    readRunEvents(run.eventsPath ?? runEventsPath(henchDir, run.id)),
    readRunReview(henchDir, run),
    runs ?? listRuns(henchDir),
  ]);
  return classifyRun({ run, events, review, attempt: countAttempts(run, allRuns), rexDir: rexDirName(projectDir) });
}

/**
 * Write the verdict's summary as the task's failureReason, unless it already
 * has one: a reason a person or the agent wrote outranks a rule's.
 * Returns whether it wrote.
 */
export async function fillFailureReason(store: PRDStore, taskId: string, summary: string): Promise<boolean> {
  const item = await store.getItem(taskId);
  if (!item || item.failureReason) return false;
  await store.updateItem(taskId, { failureReason: summary }, { preserveModifiedBy: true });
  return true;
}

/**
 * Run-end: classify a run that ended in any status other than completed,
 * store the verdict on the record as `diagnosis`, and fill the task's
 * failureReason when it has none. The caller saves the record.
 */
export async function recordRunDiagnosis(opts: {
  projectDir: string;
  henchDir: string;
  run: RunRecord;
  store?: PRDStore;
}): Promise<RunDiagnosis | undefined> {
  const { projectDir, henchDir, run, store } = opts;
  if (run.status === "completed" || run.status === "running") {
    delete run.diagnosis;
    return undefined;
  }
  const diagnosis = await diagnoseRun(projectDir, henchDir, run);
  run.diagnosis = diagnosis;
  if (store && run.taskId) await fillFailureReason(store, run.taskId, diagnosis.summary);
  return diagnosis;
}
