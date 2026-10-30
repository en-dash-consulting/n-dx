/**
 * `hench runs` — questions about recorded runs.
 *
 * One subcommand today, `diagnose`: why a run did not complete and the ranked
 * next action, from the rule-based classifier (`agent/analysis/run-verdict.ts`).
 * Read-only: the verdict is recomputed from what is on disk and printed; the
 * run-end path is what stores it on the record.
 *
 * @module hench/cli/commands/runs
 */

import { loadRun } from "../../store/runs.js";
import { resolveHenchPaths } from "../../store/paths.js";
import { diagnoseRun } from "../../agent/lifecycle/run-diagnosis.js";
import type { RunDiagnosis, RunRecord } from "../../schema/index.js";
import { CLIError } from "../errors.js";
import { result } from "../output.js";

/** Subcommands `hench runs` understands. */
export const RUNS_SUBCOMMANDS = ["diagnose"] as const;

const DIAGNOSE_USAGE = "Usage: hench runs diagnose <run-id> [--format=json] [dir]";

/** The JSON `hench runs diagnose --format=json` prints. */
export interface RunDiagnoseOutput extends RunDiagnosis {
  runId: string;
  taskId: string;
}

export function formatDiagnosis(out: RunDiagnoseOutput): string[] {
  return [
    `Run ${out.runId} (task ${out.taskId})`,
    `Verdict: ${out.class} — attempt ${out.attempt.n} of ${out.attempt.of}`,
    `  ${out.summary}`,
    ...(out.evidence.length > 0 ? ["Evidence:", ...out.evidence.map((e) => `  • ${e}`)] : []),
    "Next:",
    ...out.actions.map((a, i) => `  ${i + 1}. ${a.label}`),
  ];
}

export async function cmdRuns(
  dir: string,
  positional: string[],
  flags: Record<string, string>,
): Promise<void> {
  const [subcommand, runId] = positional;
  if (!subcommand) throw new CLIError("Missing subcommand.", DIAGNOSE_USAGE);
  if (!(RUNS_SUBCOMMANDS as readonly string[]).includes(subcommand)) {
    throw new CLIError(`Unknown runs subcommand: ${subcommand}`, `Known subcommands: ${RUNS_SUBCOMMANDS.join(", ")}`);
  }
  if (!runId) throw new CLIError("Missing run ID.", `${DIAGNOSE_USAGE}\nRun 'hench status' to list recent runs.`);

  const henchDir = resolveHenchPaths(dir).henchDir;
  let run: RunRecord;
  try {
    run = await loadRun(henchDir, runId);
  } catch {
    throw new CLIError(`Run not found: ${runId}`, "Run 'hench status' to list recent runs.");
  }
  if (run.status === "completed" || run.status === "running") {
    throw new CLIError(`Run ${runId} is ${run.status}; only a run that did not complete has a verdict.`);
  }

  const out: RunDiagnoseOutput = { runId: run.id, taskId: run.taskId, ...(await diagnoseRun(dir, henchDir, run)) };
  if (flags.format === "json") {
    result(JSON.stringify(out, null, 2));
    return;
  }
  for (const line of formatDiagnosis(out)) result(line);
}
