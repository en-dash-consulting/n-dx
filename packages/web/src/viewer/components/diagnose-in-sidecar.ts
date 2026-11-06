/**
 * "Diagnose in Sidecar": the control a failed run offers on the Runs tile. It
 * attaches the run's task to the Sidecar drawer with the Diagnose run lens and
 * opens the drawer. The lens reads the task's newest run, so the control is
 * drawn only on a task's newest run (see {@link newestRunIds}).
 *
 * main.ts provides {@link DiagnoseInSidecarContext} only while `web.sidecar` is
 * on, so nothing is drawn while it is off. {@link RunVerdictChip} is the
 * rule-based classifier's verdict and does not depend on the Sidecar.
 */

import { createContext, h } from "preact";
import { useContext } from "preact/hooks";
import { runVerdictClassLabel, type RunVerdict } from "./prd-tree/run-verdict-banner.js";

export interface DiagnoseInSidecar {
  /** Attach the task with the Diagnose run lens and open the drawer. */
  diagnose: (taskId: string) => void;
  /** The task attached for diagnosis now, if any. */
  attached: string | null;
}

/** Null while `web.sidecar` is off. */
export const DiagnoseInSidecarContext = createContext<DiagnoseInSidecar | null>(null);

/** Statuses of a run that has not ended in failure: still going, done, or stopped by the operator. */
const NOT_FAILED = new Set(["completed", "running", "in_progress", "cancelled"]);

/**
 * A run that ended without completing: `failed`, and also hench's `timeout`,
 * `budget_exceeded` and `error_transient`, which the classifier gives verdicts
 * of their own (budget-timeout, vendor-transient).
 */
export function isFailedRun(status: string): boolean {
  return !NOT_FAILED.has(status);
}

/** The id of each task's newest run (by start time), the run a Diagnose run packet reads. */
export function newestRunIds(runs: ReadonlyArray<{ id: string; taskId: string; startedAt: string }>): Set<string> {
  const newest = new Map<string, { id: string; startedAt: string }>();
  for (const run of runs) {
    const held = newest.get(run.taskId);
    if (!held || run.startedAt > held.startedAt) newest.set(run.taskId, run);
  }
  return new Set([...newest.values()].map((r) => r.id));
}

/** The classifier's verdict on a failed run, as a chip; nothing when the run carries none. */
export function RunVerdictChip({ diagnosis }: { diagnosis?: RunVerdict }) {
  if (!diagnosis) return null;
  return h("span", {
    class: "hench-run-chip hench-run-verdict-chip",
    "data-verdict-class": diagnosis.class,
    title: diagnosis.summary,
  }, runVerdictClassLabel(diagnosis.class));
}

export function DiagnoseInSidecarButton({ taskId }: { taskId: string }) {
  const sidecar = useContext(DiagnoseInSidecarContext);
  if (!sidecar) return null;
  const attached = sidecar.attached === taskId;
  return h("button", {
    type: "button",
    class: "hench-run-diagnose-sidecar",
    "aria-pressed": attached,
    // The card is itself a button; opening the drawer must not also select the run.
    onClick: (e: MouseEvent) => { e.stopPropagation(); sidecar.diagnose(taskId); },
    onKeyDown: (e: KeyboardEvent) => e.stopPropagation(),
  }, attached ? "Diagnosing in Sidecar" : "Diagnose in Sidecar");
}
