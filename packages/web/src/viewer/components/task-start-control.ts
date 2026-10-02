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
}

export function TaskStartControl({ task, titleOf, label, onStarted, workspace, ariaLabel, navigateTo }: TaskStartControlProps) {
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
      });
    case "live":
      return h("a", {
        class: "task-live-link",
        href: appUrl(`/live/task/${encodeURIComponent(task.id)}`),
        onClick: navigateTo
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
