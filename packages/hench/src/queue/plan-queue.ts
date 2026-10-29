/**
 * Queue planner: which ready tasks can run side by side, and in what order.
 *
 * Rule-based and advisory. A pure function over the ready list (selection
 * order, claims already passed over), each task's tags, effective tier,
 * blockers and parent change, each change's `touches`, and the runs active
 * now. It reads no file, clock or process; `cli/commands/plan-queue.ts` does
 * the reading, and nothing here starts, claims or writes anything.
 *
 * A lane is one branch in one worktree running its tasks one after another.
 * Rules:
 * - a lane holds 1 to {@link LANE_TASK_CAP} tasks of one parent change, each
 *   with effective tier light or standard, in dependency order;
 * - lanes offered together come from changes with pairwise disjoint touches,
 *   and a change with no touches is never paired with another lane;
 * - tasks tagged one of {@link COLD_ONLY_TAGS} are excluded (run them alone);
 * - at most `runLimit - activeRuns` lanes are offered.
 *
 * Every task given appears exactly once in the output, in a lane or in
 * `excluded`, with a one-line reason.
 *
 * @module hench/queue/plan-queue
 */

/** Tags that keep a task out of every lane: it needs a cold, solo run. */
export const COLD_ONLY_TAGS = ["review-critical", "migration", "cross-package"] as const;

/** Tasks one lane holds at most. */
export const LANE_TASK_CAP = 3;

/** Tiers a lane accepts. */
const LANE_TIERS: ReadonlySet<string> = new Set(["light", "standard"]);

export interface QueueTask {
  id: string;
  title: string;
  /** The parent change; a task-less change is its own parent. */
  changeId: string;
  /** Own tags and the parent change's. */
  tags: readonly string[];
  /** Effective tier: saved run.tier, else the change's run.tier, else the hench default. */
  tier: string;
  /** Where {@link tier} came from, for the reason line. */
  tierSource: "task.run.tier" | "change.run.tier" | "default";
  /**
   * Open blockers. Empty for a ready task. A task that is not yet ready is
   * given only when every open blocker is another task given here under the
   * same change, so a lane can run it after them.
   */
  blockedBy: readonly string[];
}

export interface QueueChange {
  id: string;
  title: string;
  /** Product node ids the change touches. */
  touches: readonly string[];
}

export interface PlanQueueInput {
  /** Candidate tasks, ready ones in selection-comparator order. */
  tasks: readonly QueueTask[];
  changes: ReadonlyMap<string, QueueChange>;
  /** Hench runs active now. */
  activeRuns: number;
  /** `guard.maxConcurrentProcesses`. */
  runLimit: number;
  /** Builds the command that runs a lane's task ids in order. */
  command: (taskIds: readonly string[]) => string;
}

export interface PlannedTask {
  id: string;
  title: string;
  reason: string;
}

export interface PlannedLane {
  command: string;
  changeId: string;
  tasks: PlannedTask[];
}

export interface QueuePlan {
  lanes: PlannedLane[];
  excluded: PlannedTask[];
  activeRuns: number;
  runLimit: number;
  /** One line on the plan as a whole; says why when there are no lanes. */
  summary: string;
}

/** `tasks` with every blocker before what it blocks, otherwise in the given order. */
function dependencyOrder(tasks: readonly QueueTask[]): QueueTask[] {
  const ids = new Set(tasks.map((t) => t.id));
  const placed = new Set<string>();
  const out: QueueTask[] = [];
  const rest = [...tasks];
  while (rest.length > 0) {
    const i = rest.findIndex((t) => t.blockedBy.every((b) => placed.has(b) || !ids.has(b)));
    // A cycle cannot be ordered; keep the given order for what is left.
    const [next] = rest.splice(i === -1 ? 0 : i, 1);
    placed.add(next.id);
    out.push(next);
  }
  return out;
}

function sharedTouch(a: QueueChange, b: QueueChange): string | undefined {
  const theirs = new Set(b.touches);
  return a.touches.find((t) => theirs.has(t));
}

export function planQueue(input: PlanQueueInput): QueuePlan {
  const { tasks, changes, activeRuns, runLimit } = input;
  const excluded: PlannedTask[] = [];
  const exclude = (t: QueueTask, reason: string): void => {
    excluded.push({ id: t.id, title: t.title, reason });
  };
  const changeOf = (t: QueueTask): QueueChange =>
    changes.get(t.changeId) ?? { id: t.changeId, title: t.changeId, touches: [] };

  // ── Per-task rules ───────────────────────────────────────────────────────
  const eligible: QueueTask[] = [];
  for (const t of tasks) {
    const cold = COLD_ONLY_TAGS.find((tag) => t.tags.includes(tag));
    if (cold) {
      exclude(t, `tagged ${cold}: cold-only, run it on its own`);
    } else if (!LANE_TIERS.has(t.tier)) {
      exclude(t, `effective tier ${t.tier} (${t.tierSource}): lanes take light or standard only`);
    } else {
      eligible.push(t);
    }
  }

  // A not-yet-ready task whose blocker was excluded cannot follow it in a lane.
  let laneable = eligible;
  for (;;) {
    const ids = new Set(laneable.map((t) => t.id));
    const stranded = laneable.filter((t) => t.blockedBy.some((b) => !ids.has(b)));
    if (stranded.length === 0) break;
    for (const t of stranded) {
      const missing = t.blockedBy.find((b) => !ids.has(b)) as string;
      exclude(t, `waits on ${missing}, which is not in a lane`);
    }
    const gone = new Set(stranded.map((t) => t.id));
    laneable = laneable.filter((t) => !gone.has(t.id));
  }

  // ── Candidate lanes: one per change, in order of its best task ─────────
  const byChange = new Map<string, QueueTask[]>();
  for (const t of laneable) {
    const group = byChange.get(t.changeId) ?? [];
    group.push(t);
    byChange.set(t.changeId, group);
  }
  const candidates = [...byChange.entries()].map(([changeId, group]) => {
    const ordered = dependencyOrder(group);
    // The cap keeps a prefix of the dependency order, so a kept task's
    // blockers are kept too; an over-cap task waits for a later plan.
    for (const t of ordered.slice(LANE_TASK_CAP)) {
      exclude(t, `over the ${LANE_TASK_CAP}-task lane cap for change ${changeId}; plan again after the lane ends`);
    }
    return { change: changeOf(group[0]), tasks: ordered.slice(0, LANE_TASK_CAP) };
  });

  // ── Lanes offered together ────────────────────────────────────────────
  const free = Math.max(0, runLimit - activeRuns);
  const chosen: typeof candidates = [];
  for (const lane of candidates) {
    const why = ((): string | undefined => {
      if (chosen.length >= free) {
        return free === 0
          ? `no free run slot: ${activeRuns} active of ${runLimit}`
          : `no free run slot: ${free} free of ${runLimit}, taken by earlier lanes`;
      }
      if (chosen.length === 0) return undefined;
      const first = chosen[0].change;
      if (first.touches.length === 0) return `lane 1 (change ${first.id}) has no touches, so it runs alone`;
      if (lane.change.touches.length === 0) return `change ${lane.change.id} has no touches, so it is never paired with another lane`;
      for (const other of chosen) {
        const overlap = sharedTouch(lane.change, other.change);
        if (overlap) return `change ${lane.change.id} touches ${overlap}, as change ${other.change.id} in an earlier lane does`;
      }
      return undefined;
    })();
    if (why) for (const t of lane.tasks) exclude(t, why);
    else chosen.push(lane);
  }

  const lanes: PlannedLane[] = chosen.map((lane, i) => ({
    command: input.command(lane.tasks.map((t) => t.id)),
    changeId: lane.change.id,
    tasks: lane.tasks.map((t, j) => ({
      id: t.id,
      title: t.title,
      reason:
        `lane ${i + 1}, step ${j + 1} of ${lane.tasks.length}: change ${lane.change.id}, tier ${t.tier}` +
        (t.blockedBy.length > 0 ? `, after ${t.blockedBy.join(", ")}` : ""),
    })),
  }));

  const summary =
    tasks.length === 0
      ? "No ready tasks."
      : free === 0
        ? `No lanes: ${activeRuns} run${activeRuns === 1 ? "" : "s"} active of a limit of ${runLimit}, so no run slot is free.`
        : lanes.length === 0
          ? "No lanes: every ready task is excluded."
          : `${lanes.length} lane${lanes.length === 1 ? "" : "s"} for ${free} free run slot${free === 1 ? "" : "s"} (${activeRuns} active of ${runLimit}).`;

  return { lanes, excluded, activeRuns, runLimit, summary };
}
