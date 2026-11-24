/**
 * Work's Now mode: what is being worked on, by whom, and what runs next.
 *
 * Running now lists the task runs going in every worktree (`GET /api/live`,
 * the same feed as Live): the task, who it is assigned to, the agent running
 * it, the worktree, and how far it is against a typical run.
 * Beside it is the planned Run queue (`run-queue.ts`). `UpNext` below is the
 * Ready to run panel Work › Tune opens on (`ReadyToRun`): the typical run stated
 * once above it, each row with its assignee and, when its tier has a figure of
 * its own, that estimate — split into the tasks assigned to you and the
 * unassigned ones by product area. The PRD's numbers are Work's Statistics tile (`work-stats.ts`).
 *
 * @module viewer/views/work-now
 */

import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import { asLiveSnapshot, countsAsLive, useLive, useProductRead, useStatusLayout, type LiveRunFull } from "../hooks/index.js";
import {
  ElapsedTime,
  PeekLink,
  runTarget,
  elapsedUntilNow,
  ReadyToRun,
  TypicalRun,
  estimateBasis,
  estimateFor,
  formatDuration,
  formatTokenCount as formatTokens,
  personLabel,
  usePeople,
  useRunEstimates,
  type ReadyTask,
  type RunEstimates,
} from "../components/index.js";
import type { NavigateTo } from "../types.js";
import type { ProductMap } from "./product-model.js";
import { addToRunQueue, useRunQueue } from "./run-queue.js";

/** The agent running a run, as one phrase: "claude · sonnet-4". */
export function agentLabel(run: Pick<LiveRunFull, "vendor" | "model">): string {
  return [run.vendor, run.model].filter(Boolean).join(" · ") || "Agent";
}

/**
 * How far a run is against a typical one: elapsed time over the median, capped
 * at 1, or null with no estimate or no start time.
 */
export function runFraction(startedAt: string | null, typicalMs: number | null, now: number): number | null {
  if (!startedAt || !typicalMs || typicalMs <= 0) return null;
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return null;
  return Math.min(1, Math.max(0, (now - started) / typicalMs));
}

/** "about 6 min left", or "longer than usual" once past the median. */
export function remainingLine(startedAt: string | null, typicalMs: number, now: number): string | null {
  if (!startedAt) return null;
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return null;
  const left = typicalMs - (now - started);
  return left > 0 ? `about ${formatDuration(left)} left` : "longer than usual";
}

/** A clock that ticks every `ms` while mounted. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** One running task. Exported for its tests. */
export function RunningRow({ run, estimates, now, navigateTo }: {
  run: LiveRunFull;
  estimates: RunEstimates | null;
  now: number;
  navigateTo: NavigateTo;
}) {
  const typical = estimateFor(estimates, null);
  const fraction = runFraction(run.startedAt, typical?.durationMs ?? null, now);
  const remaining = typical ? remainingLine(run.startedAt, typical.durationMs, now) : null;
  const title = run.rowText ?? run.taskTitle ?? "Untitled task";
  return h("li", { class: "wn-run", "data-run": run.runId },
    h("div", { class: "wn-run-main" },
      // Live's own link: in place for this worktree's run, else the run's page in
      // the worktree that owns it (its `/w/<key>/` slot), where its log and Stop are.
      run.taskId
        ? h(PeekLink, { target: runTarget(run), navigateTo, class: "wn-run-title" }, title)
        : h("span", { class: "wn-run-title" }, title),
      h("div", { class: "wn-run-meta" },
        h("span", { class: run.assignee ? "wn-who" : "wn-who wn-who-none", title: run.assignee ?? "Nobody is assigned" },
          run.assignee ? `For ${personLabel(run.assignee)}` : "Unassigned"),
        h("span", { class: "wn-agent" }, agentLabel(run)),
        h("span", { class: "wn-worktree", title: run.worktree.path }, run.worktree.name),
        run.loop ? h("span", { class: "wn-loop" }, `${run.loop.mode} · ${run.loop.iteration}${run.loop.max ? ` of ${run.loop.max}` : ""}`) : null,
      ),
    ),
    h("div", { class: "wn-run-cost" },
      run.startedAt ? h(ElapsedTime, { startedAt: run.startedAt, formatter: elapsedUntilNow, class: "wn-elapsed" }) : h("span", { class: "wn-elapsed" }, "Starting"),
      h("span", { class: "wn-tokens" },
        typical ? `${formatTokens(run.tokens.total)} of ~${formatTokens(typical.tokens)} tokens` : `${formatTokens(run.tokens.total)} tokens`),
      fraction !== null && typical && estimates
        ? h("div", { class: "wn-progress", title: estimateBasis(typical, estimates, null) },
            h("div", {
              class: fraction >= 1 ? "wn-bar wn-bar-over" : "wn-bar",
              role: "progressbar",
              "aria-label": "Time against a typical run",
              "aria-valuemin": 0,
              "aria-valuemax": 100,
              "aria-valuenow": Math.round(fraction * 100),
            }, h("span", { class: "wn-bar-fill", style: { width: `${Math.round(fraction * 100)}%` } })),
            remaining ? h("span", { class: "wn-remaining" }, remaining) : null,
          )
        : null,
    ),
  );
}

/** The Running now panel: every live task run, with who, the agent, and progress against a typical run. */
export function RunningNow({ navigateTo }: { navigateTo: NavigateTo }) {
  const live = asLiveSnapshot(useLive());
  const estimates = useRunEstimates();
  const now = useNow(15_000);
  if (!live) return h("p", { class: "wn-empty", role: "status" }, "Loading…");
  const runs = live.runs.filter(countsAsLive);
  const starting = live.queue.starting;
  if (runs.length === 0 && starting.length === 0) {
    return h("p", { class: "wn-empty" }, "Nothing is running. Queue a task beside this, or start one from Ready to run on Tune.");
  }
  return h("ul", { class: "wn-runs", "aria-label": "Running now" },
    runs.map((run) => h(RunningRow, { key: run.runId, run, estimates, now, navigateTo })),
    starting.map((s) => h("li", { key: `starting-${s.taskId}`, class: "wn-run wn-run-starting" },
      h("div", { class: "wn-run-main" },
        h("span", { class: "wn-run-title" }, s.taskTitle),
        h("div", { class: "wn-run-meta" }, h("span", { class: "wn-worktree" }, s.worktree.name)),
      ),
      h("div", { class: "wn-run-cost" }, h("span", { class: "wn-elapsed" }, "Starting")),
    )),
  );
}

/**
 * The area each open change counts toward, by change id: the first area of the
 * product map whose `openChangeIds` lists it.
 */
export function areaByChange(map: ProductMap): Map<string, string> {
  const byChange = new Map<string, string>();
  for (const area of map.areas) {
    for (const id of area.openChangeIds) if (!byChange.has(id)) byChange.set(id, area.title);
  }
  return byChange;
}

/** A v1 task's section: the top of its chain (its epic), or nothing for a top-level task. */
export function v1Section(task: ReadyTask): string | null {
  return task.parentChain[0] ?? null;
}

type ReadyListProps = { navigateTo: NavigateTo; estimates: RunEstimates | null; me: string | null };

function ReadyList({ navigateTo, estimates, me, areaOf }: ReadyListProps & { areaOf: (task: ReadyTask) => string | null }) {
  // Each card can be lined up in the planned run queue (Work › Now's Queue panel).
  const queued = new Set((useRunQueue().items ?? []).map((i) => i.taskId));
  return h(ReadyToRun, {
    heading: false,
    estimates,
    split: { me, areaOf },
    queue: { has: (id) => queued.has(id), add: (id) => void addToRunQueue(id) },
    // Ready to run is on Tune: Prepare opens over Tune and closes back to it.
    onPrepare: (taskId: string) => navigateTo("tune", { taskId }),
    onOpenLive: (taskId: string) => navigateTo("live-task", { taskId }),
    onOpenPrd: () => navigateTo("prd"),
  });
}

/** On v2: group by the product area of each task's change, read from the product map. */
function ReadyByArea(props: ReadyListProps) {
  const product = useProductRead("/api/rex/product", (body) => body.map as ProductMap);
  const areas = product.state === "ready" ? areaByChange(product.data) : null;
  return h(ReadyList, { ...props, areaOf: (task) => (task.change && areas?.get(task.change.id)) || null });
}

/**
 * The Up next panel: the queue `ndx work` picks from, with assignees and
 * estimates — the tasks assigned to you, then the unassigned ones by product
 * area (by top-level section on a v1 tree, which has no product map).
 */
export function UpNext({ navigateTo }: { navigateTo: NavigateTo }) {
  const estimates = useRunEstimates();
  const people = usePeople();
  // The shared status cache, not a poll of its own.
  const v2 = useStatusLayout() === "v2";
  const me = people?.me ?? null;
  return h("div", { class: "wn-up-next" },
    h(TypicalRun, { estimates, class: "wn-typical" }),
    v2
      ? h(ReadyByArea, { navigateTo, estimates, me })
      : h(ReadyList, { navigateTo, estimates, me, areaOf: v1Section }),
  );
}
