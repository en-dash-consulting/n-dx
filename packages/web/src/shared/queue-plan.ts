/**
 * The queue planner's plan as `ndx work --plan-queue --format=json` prints it
 * (hench's `QueuePlan`), read by Live's Ready next, the Sidecar Guide packet
 * and the run-plan card. Web never imports hench, so the shape is mirrored.
 */

export interface PlannedTask {
  id: string;
  title: string;
  reason: string;
}

export interface PlannedLane {
  /** The whole lane: one `work` step per task, joined by `&&`. */
  command: string;
  changeId: string;
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

const STEP_SEPARATOR = " && ";

/**
 * A lane's commands, one per task in order. The planner joins the steps with
 * `&&`, so the steps are exactly what it printed, never rebuilt here.
 */
export function laneSteps(lane: PlannedLane): string[] {
  return lane.command.split(STEP_SEPARATOR);
}

/**
 * The flags a lane's step carries beyond the ones a work card adds itself
 * (`--task`, `--auto`, the directory), such as `--require-unblocked`. A card
 * that starts the step can carry only run options, so a step with an extra
 * flag cannot be started from a card.
 */
export function stepExtraFlags(step: string): string[] {
  return step.split(/\s+/).filter((word) => word.startsWith("--") && !word.startsWith("--task=") && word !== "--auto");
}
