/**
 * Live's Ready next section: the queue planner's lanes, shown in place of the
 * Up next list while `hench.readyNext` is on.
 *
 * The plan is `GET /api/hench/plan-queue`, which spawns
 * `ndx work --plan-queue --format=json`; this file only lays it out. Each lane
 * shows the command that runs it and the reason for each of its tasks; the
 * ready tasks left out are listed with theirs. Advisory: nothing here starts
 * a run.
 *
 * @module web/viewer/views/live-ready-next
 */

import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { NavigateTo } from "../types.js";

/** The registry key in routes-features.ts. */
export const READY_NEXT_FEATURE = "hench.readyNext";

interface PlanTask {
  id: string;
  title: string;
  reason: string;
}

/** What `ndx work --plan-queue --format=json` prints. Mirrors hench's `QueuePlan`. */
export interface QueuePlan {
  lanes: Array<{ command: string; changeId: string; tasks: PlanTask[] }>;
  excluded: PlanTask[];
  activeRuns: number;
  runLimit: number;
  summary: string;
}

/** A planned task: its title opens the task, as an Up next item does. */
function TaskLine({ task, navigateTo }: { task: PlanTask; navigateTo: NavigateTo }) {
  return h("li", { class: "live-ready-task" },
    h("a", {
      class: "live-queue-item",
      href: "#",
      onClick: (e: MouseEvent) => { e.preventDefault(); navigateTo("prd", { taskId: task.id }); },
    }, h("span", { class: "live-card-title" }, task.title)),
    h("span", { class: "live-card-chain" }, task.reason));
}

/**
 * Ready next. `refreshKey` re-reads the plan when it changes; Live passes the
 * ids of the queue and the running runs, so the plan follows the work rather
 * than spawning a planner on every poll.
 */
export function ReadyNext({ refreshKey, navigateTo }: { refreshKey: string; navigateTo: NavigateTo }) {
  const [plan, setPlan] = useState<QueuePlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/hench/plan-queue")
      .then(async (res) => {
        const body = await res.json() as QueuePlan & { error?: string };
        if (cancelled) return;
        if (res.ok) { setPlan(body); setError(null); } else setError(body.error ?? `Could not plan the queue (${res.status})`);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not plan the queue");
      });
    return () => { cancelled = true; };
  }, [refreshKey]);

  // Rendered inside Live's queue section, which is labelled by this heading.
  return h("div", { class: "live-ready" },
    h("h3", { id: "live-ready-h", class: "live-side-title" }, "Ready next"),
    error
      ? h("p", { class: "live-error", role: "alert" }, error)
      : plan === null
        ? h("p", { class: "live-muted", role: "status" }, "Planning…")
        : [
          h("p", { key: "s", class: "live-muted" }, plan.summary),
          plan.lanes.length > 0
            ? h("ol", { key: "l", class: "live-ready-lanes" }, plan.lanes.map((lane, i) =>
              h("li", { key: lane.changeId, class: "live-ready-lane" },
                h("span", { class: "live-side-title" }, `Lane ${i + 1}`),
                h("code", { class: "live-ready-command" }, lane.command),
                h("ul", null, lane.tasks.map((t) => h(TaskLine, { key: t.id, task: t, navigateTo }))))))
            : null,
          plan.excluded.length > 0
            ? h("details", { key: "x", class: "live-ready-excluded" },
              h("summary", null, `Not in a lane (${plan.excluded.length})`),
              h("ul", null, plan.excluded.map((t) => h(TaskLine, { key: t.id, task: t, navigateTo }))))
            : null,
        ],
  );
}
