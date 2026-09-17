/**
 * Polls the hub's admission queue — what is running on this machine, what is
 * waiting, and whether the hub has stopped admitting for want of memory.
 *
 * A run started from the dashboard no longer goes straight to the project
 * server: the hub admits it or queues it (`hub/admission.ts`). A queued run
 * answers `202` and then nothing happens for a while, so without this the
 * page has no way to say why — and "nothing happened" reads as a broken
 * button.
 *
 * ## Why polling
 *
 * The hub has no WebSocket server of its own; it pipes upgrades to the
 * project's server as raw bytes and never parses a frame. Pushing queue
 * changes would mean either terminating sockets in the hub or adding a relay
 * endpoint to every child — real designs, both, and neither worth building
 * for a wait measured in minutes. A tick every few seconds is not
 * distinguishable from a push here.
 *
 * ## Where the request goes
 *
 * `/api/hub/queue`, which `installBasePathFetch` rewrites to
 * `/p/<id>/api/hub/queue` when the viewer is served under a project prefix.
 * The hub answers that itself rather than proxying it, and scopes `entries`
 * to the project that asked. Without a hub — the single-project server, or a
 * static export — nothing answers and the hook stays null, which is how
 * every consumer renders nothing.
 *
 * @module web/viewer/hooks/use-hub-queue
 */

import { useState, useCallback, useEffect } from "preact/hooks";
import { usePolling } from "../views/use-polling.js";

/** Mirrors QueueEntry in server-side hub/admission.ts. */
export interface HubQueueEntry {
  projectId: string;
  /** Worktree the queued run will execute in; null for the anchor. */
  workspace: string | null;
  taskId: string;
  enqueuedAt: string;
}

/** Mirrors QueueSnapshot in hub/admission.ts, as `GET /api/hub/queue` returns it. */
export interface HubQueueSnapshot {
  /** This project's queued runs, oldest first. */
  entries: HubQueueEntry[];
  /** Queued across every project on the machine, when `entries` is this project's. */
  queuedTotal?: number;
  /** Dashboard-started runs in flight across every project. */
  running: number;
  freeMemoryBytes: number;
  limits: { maxSessions: number; memoryFloorBytes: number };
  /** Nothing is being admitted because free memory is below the floor. */
  memoryPaused: boolean;
}

/** Queue positions change at run cadence, which is minutes, not seconds. */
export const HUB_QUEUE_POLL_INTERVAL_MS = 5_000;

/** This workspace's queued runs. `null` is the anchor, and matches entries with no workspace. */
export function entriesForWorkspace(
  snapshot: HubQueueSnapshot | null,
  workspace: string | null,
): HubQueueEntry[] {
  if (!snapshot) return [];
  return snapshot.entries.filter((entry) => entry.workspace === workspace);
}

/**
 * 1-based position of a task in the queue, or 0 when it is not queued.
 *
 * Over the whole queue rather than the workspace's slice: the wait is for the
 * machine, so "3rd" has to mean third overall or it tells the reader nothing
 * about how long they are waiting.
 */
export function queuePositionOf(snapshot: HubQueueSnapshot | null, taskId: string): number {
  if (!snapshot) return 0;
  return snapshot.entries.findIndex((entry) => entry.taskId === taskId) + 1;
}

export function useHubQueue(): {
  /** null until the first answer, and on a server with no hub. */
  queue: HubQueueSnapshot | null;
  refetch: () => Promise<void>;
} {
  const [queue, setQueue] = useState<HubQueueSnapshot | null>(null);

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch("/api/hub/queue");
      // 404 is the ordinary answer from a single-project server: there is no
      // hub, so there is no queue, and the consumer renders nothing.
      if (!res.ok) {
        setQueue(null);
        return;
      }
      const json = (await res.json()) as Partial<HubQueueSnapshot>;
      if (Array.isArray(json.entries) && typeof json.running === "number" && json.limits) {
        setQueue(json as HubQueueSnapshot);
      }
    } catch {
      // Non-fatal — the last known state stays until the next tick.
    }
  }, []);

  useEffect(() => { void fetchQueue(); }, [fetchQueue]);
  usePolling("hub-queue", fetchQueue, HUB_QUEUE_POLL_INTERVAL_MS);

  return { queue, refetch: fetchQueue };
}
