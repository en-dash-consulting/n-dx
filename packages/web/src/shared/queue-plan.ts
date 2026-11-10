/**
 * The queue planner's plan as `ndx work --plan-queue --format=json` prints it
 * (hench's `QueuePlan`), read by Live's Ready next, the Sidecar Guide packet
 * and the run-plan card. Web never imports hench, so the shape is mirrored.
 */

import { RUN_OPTION_SPECS } from "./run-options.js";
import type { RunOptions } from "./run-options.js";

export interface PlannedTask {
  id: string;
  title: string;
  reason: string;
}

export interface PlannedLane {
  /** The whole lane: one `work` step per task, joined by `&&`. */
  command: string;
  changeId: string;
  /** The lane must run in a worktree of its own (every lane after the first, and lane 1 while a run is live here). */
  ownWorktree?: boolean;
  tasks: PlannedTask[];
}

export interface QueuePlan {
  lanes: PlannedLane[];
  excluded: PlannedTask[];
  /** Live runs in every worktree of the repository. */
  activeRuns: number;
  runLimit: number;
  /** One line on the plan as a whole; says why when there are no lanes. */
  summary: string;
}

/** Hench's wording (`OWN_WORKTREE_NOTE` in plan-queue.ts) for a lane with `ownWorktree`; mirrored, as web never imports hench. */
export const OWN_WORKTREE_NOTE =
  "Run this lane in its own worktree: its command targets the current checkout, and two runs in one checkout collide.";

const STEP_SEPARATOR = " && ";

/**
 * A lane's commands, one per task in order. The planner joins the steps with
 * `&&`, so the steps are exactly what it printed, never rebuilt here.
 */
export function laneSteps(lane: PlannedLane): string[] {
  return lane.command.split(STEP_SEPARATOR);
}

/** A lane step's extra flags as work-card run options, and the flags no run option carries. */
export interface StepRunOptions {
  options: RunOptions;
  unmapped: string[];
}

/**
 * The flags a lane's step carries beyond the ones a work card adds itself
 * (`--task`, `--auto`, the directory), as the run options that say the same
 * (`--require-unblocked` is `requireUnblocked: true`). Only boolean switches
 * map; any other flag is `unmapped`, and a step with one cannot be started
 * from a card.
 */
export function stepRunOptions(step: string): StepRunOptions {
  const options: Record<string, unknown> = {};
  const unmapped: string[] = [];
  for (const word of step.split(/\s+/)) {
    if (!word.startsWith("--") || word.startsWith("--task=") || word === "--auto") continue;
    const spec = RUN_OPTION_SPECS.find((s) => s.type === "boolean" && word === `--${s.flag}`);
    if (spec) options[spec.key] = true;
    else unmapped.push(word);
  }
  return { options: options as RunOptions, unmapped };
}
