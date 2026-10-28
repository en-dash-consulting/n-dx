/**
 * Verdict banner on a task's detail panel: why the task's latest run did not
 * complete, the first thing to do next, and which attempt it was.
 *
 * The verdict is hench's rule-based run classification (`hench runs
 * diagnose`), stored on the run file as `diagnosis` and passed through
 * unchanged by `GET /api/hench/runs`. Gated by the `hench.runVerdict` toggle.
 */

import { h } from "preact";

/** The run's `diagnosis`, as `GET /api/hench/runs` returns it. */
export interface RunVerdict {
  class: string;
  summary: string;
  evidence: string[];
  actions: Array<{ kind: string; label: string }>;
  attempt: { n: number; of: number };
}

/** The slice of a run summary the banner reads. */
export interface VerdictRun {
  status: string;
  startedAt: string;
  diagnosis?: RunVerdict;
}

export const RUN_VERDICT_FEATURE = "hench.runVerdict";

/** The latest run's verdict — none when that run completed, is running, or carries none. */
export function latestRunVerdict(runs: readonly VerdictRun[]): RunVerdict | null {
  const latest = runs.reduce<VerdictRun | null>(
    (best, r) => (!best || r.startedAt > best.startedAt ? r : best),
    null,
  );
  if (!latest || latest.status === "completed" || latest.status === "running") return null;
  return latest.diagnosis ?? null;
}

export function RunVerdictBanner({ runs, enabled }: { runs: readonly VerdictRun[]; enabled: boolean }) {
  if (!enabled) return null;
  const verdict = latestRunVerdict(runs);
  if (!verdict) return null;
  const first = verdict.actions[0];
  return h(
    "div",
    { class: "task-run-verdict", role: "status" },
    h("div", { class: "task-run-verdict-header" },
      h("span", { class: "task-run-verdict-class" }, verdict.class),
      h("span", { class: "task-run-verdict-attempt" }, `attempt ${verdict.attempt.n} of ${verdict.attempt.of}`),
    ),
    h("p", { class: "task-run-verdict-summary" }, verdict.summary),
    first ? h("p", { class: "task-run-verdict-action" }, `Next: ${first.label}`) : null,
  );
}
