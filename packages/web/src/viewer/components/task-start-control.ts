/**
 * What a surface shows for starting one task — the same answer everywhere.
 *
 * A pending or deferred task gets the split Start button; an in-progress task
 * with no live run gets it labelled Resume; a task with a live run gets a link
 * to its Live page (Stop lives there); a blocked task names what it waits on;
 * anything else shows nothing. The rule is `startOffer`; this reads the Live
 * feed for "is a run live" and renders the result.
 */

import { h } from "preact";
import type { NavigateTo } from "../types.js";
import { appUrl } from "../base-path.js";
import { useLive, countsAsLive } from "../hooks/index.js";
import { StartTaskButton } from "./start-task-button.js";
import { startOffer } from "./prepare-task-model.js";

export interface TaskStartControlProps {
  task: { id: string; status: string; blockedBy?: string[] };
  /** Resolves a blocker's id to its title; unknown ids show as the id. */
  titleOf?: (id: string) => string | null;
  /** Start label for a task that has not begun. Defaults to "Start Task". */
  label?: string;
  onStarted: () => void;
  workspace?: string;
  ariaLabel?: string;
  navigateTo?: NavigateTo;
  /**
   * The task's Live page in `workspace` when that is not the viewer's own
   * (see `StartTaskButtonProps.liveHref`). Also the target of the live link.
   */
  liveHref?: (taskId: string) => string;
  /**
   * Offer the run-mode picker on the start button (one task / N tasks / loop).
   *
   * Passed straight through to {@link StartTaskButton}; see its `runModes` for
   * why it is opt-in. Only the `start` offer can carry it — a live run already
   * has its own page, and a blocked task has nothing to start.
   */
  runModes?: boolean;
}

export function TaskStartControl({ task, titleOf, label, onStarted, workspace, ariaLabel, navigateTo, liveHref, runModes }: TaskStartControlProps) {
  const live = useLive();
  const hasLiveRun = !!live?.runs.some((run) => run.taskId === task.id && countsAsLive(run));
  const offer = startOffer(task, hasLiveRun, titleOf);

  switch (offer.kind) {
    case "start":
      return h(StartTaskButton, {
        taskId: task.id,
        onStarted,
        label: offer.resume ? "Resume" : label,
        workspace,
        ariaLabel,
        navigateTo,
        liveHref,
        // Not on a Resume: the picker says how many tasks to work through, and
        // resuming is about finishing the one already started.
        runModes: runModes && !offer.resume,
      });
    case "live":
      return h("a", {
        class: "task-live-link",
        href: liveHref ? liveHref(task.id) : appUrl(`/live/task/${encodeURIComponent(task.id)}`),
        onClick: navigateTo && !liveHref
          ? (e: MouseEvent) => { e.preventDefault(); navigateTo("live-task", { taskId: task.id }); }
          : undefined,
      }, "Running — open in Live");
    case "blocked":
      return h("div", { class: "task-blockers", role: "status" },
        offer.blockers.length === 0
          ? "Blocked — no blocker recorded."
          : h("span", null, "Waiting on: ", offer.blockers.map((b, i) =>
              h("span", { key: b.id, class: "task-blocker" }, i > 0 ? ", " : "", b.title ?? b.id))),
      );
    default:
      return null;
  }
}
