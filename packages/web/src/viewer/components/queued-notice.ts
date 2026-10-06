/**
 * The status line for a run the hub answered `202 queued` for.
 *
 * The 202 reply is a snapshot; this keeps it true by reading the hub queue
 * (`useHubQueue`): the position follows the queue, leaving the queue means the
 * run was admitted, and a `dropped` record means the run's server refused it at
 * its turn. Shared by every surface that can start a run, so they all say the
 * same thing: the Prepare task modal, the Start button's "Start now" and the
 * Ready to run list.
 */

import { h } from "preact";
import { useEffect } from "preact/hooks";
import { useHubQueue, queuePositionOf, droppedEntryOf } from "../hooks/index.js";
import { appUrl } from "../base-path.js";
import { queuedReason } from "./prepare-task-model.js";
import type { QueuedReply } from "./prepare-task-model.js";

export function QueuedNotice({ reply, taskId, onOpenLive, liveHref, onDropped, onDismiss }: {
  reply: QueuedReply;
  taskId: string;
  onOpenLive: (taskId: string) => void;
  liveHref?: (taskId: string) => string;
  /** The hub reports the queued run refused at its turn (the modal re-enables Execute). */
  onDropped?: () => void;
  /** Offers a Dismiss button, for hosts where the notice would otherwise never go away. */
  onDismiss?: () => void;
}) {
  const { queue } = useHubQueue();
  const live = queuePositionOf(queue, taskId);
  const dropped = live === 0 ? droppedEntryOf(queue, taskId, reply.workspace) : null;
  useEffect(() => { if (dropped) onDropped?.(); }, [dropped !== null, onDropped]);

  const dismiss = onDismiss
    ? [" ", h("button", { type: "button", class: "prep-btn", onClick: onDismiss }, "Dismiss")]
    : null;

  if (dropped) {
    // Its turn came and its server refused it: the run is not coming.
    const status = dropped.status === null ? "" : ` (HTTP ${dropped.status})`;
    return h("div", { class: "prep-queued", role: "alert" },
      h("span", null, `Could not start: ${dropped.error}${status}`), dismiss);
  }
  // Out of the queue once the hub has answered without it: admitted.
  const admitted = queue !== null && live === 0;
  const position = live || reply.position;
  return h("div", { class: "prep-queued", role: "status" },
    admitted
      ? h("span", null, "Admitted — the run is starting.")
      : h("span", null, `Queued — position ${position}: ${queuedReason(reply.reason)}.`),
    " ",
    h("a", {
      href: liveHref ? liveHref(taskId) : appUrl(`/live/task/${encodeURIComponent(taskId)}`),
      onClick: (e: MouseEvent) => {
        e.preventDefault();
        onOpenLive(taskId);
      },
    }, "Open in Live"),
    dismiss,
  );
}
