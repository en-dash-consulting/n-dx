/**
 * The one line a runnable row reads on a v2 tree: "<task title> · in <change
 * title>", or "<change title> · runs as one task" for a change with no tasks.
 * Live's running and Up next rows, the Sidecar work card and the run-plan
 * card's track rows all build their text here.
 *
 * A v1 tree has no change in a task's chain, so its rows keep the bare title.
 */

import type { QueuePlan } from "../shared/index.js";

/** An ancestor as the Live feed names it, root first. */
export interface RunnableChainLink {
  title: string;
  itemType: string;
}

export interface RunnableRow {
  title: string;
  /** The task's ancestors, root first; the nearest `change` is the one named. */
  chain?: readonly RunnableChainLink[];
  /** The row is a change with no tasks, run as one task. */
  runsAsOneTask?: boolean;
  /** The change's title when the caller already has it (the run plan names it). */
  changeTitle?: string | null;
}

/** The title of the change a row's task belongs to, or null (a v1 tree, or a task the PRD does not know). */
export function changeTitleOf(row: Pick<RunnableRow, "chain" | "changeTitle">): string | null {
  if (row.changeTitle) return row.changeTitle;
  const change = [...(row.chain ?? [])].reverse().find((link) => link.itemType === "change");
  return change?.title ?? null;
}

export function runnableRowText(row: RunnableRow): string {
  if (row.runsAsOneTask) return `${row.title} · runs as one task`;
  const change = changeTitleOf(row);
  return change && change !== row.title ? `${row.title} · in ${change}` : row.title;
}

/**
 * The plan with each lane task's `rowText` filled in: it names its change, or
 * says "runs as one task" when the task is the change itself. The server does
 * this once, so every surface that draws the plan reads the same words. A
 * planner that predates `changeTitle` leaves the bare title.
 */
export function withPlannedRowText(plan: QueuePlan): QueuePlan {
  return {
    ...plan,
    lanes: plan.lanes.map((lane) => ({
      ...lane,
      tasks: lane.tasks.map((task) => ({
        ...task,
        rowText: runnableRowText({ title: task.title, changeTitle: lane.changeTitle, runsAsOneTask: task.id === lane.changeId }),
      })),
    })),
  };
}
