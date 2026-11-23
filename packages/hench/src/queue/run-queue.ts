/**
 * The planned run queue: task ids, in the order the person wants the agent to
 * run them, saved at `<hench dir>/run-queue.json`. The dashboard's Queue panel
 * writes it (Work › Now and Plan › Preparation); `ndx work`'s autoselection
 * takes the first item that can run before rex's own pick, and takes it off.
 *
 *   { "version": 1, "items": [{ "taskId": "…", "addedAt": "2026-11-23T…Z" }] }
 *
 * Written whole to a temporary file and renamed into place, so a reader never
 * sees half a queue. A missing, empty or unreadable file is an empty queue:
 * the queue only ever steers selection, it never stops it.
 *
 * @module hench/queue/run-queue
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const RUN_QUEUE_FILE = "run-queue.json";

export interface RunQueueItem {
  taskId: string;
  addedAt: string;
}

export function runQueuePath(henchDir: string): string {
  return join(henchDir, RUN_QUEUE_FILE);
}

/** The queue's items, in order; empty when the file is absent or not a queue. */
export async function readRunQueue(henchDir: string): Promise<RunQueueItem[]> {
  let raw: string;
  try {
    raw = await readFile(runQueuePath(henchDir), "utf-8");
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as { items?: unknown };
    if (!Array.isArray(parsed.items)) return [];
    return parsed.items.flatMap((entry) => {
      const item = entry as Partial<RunQueueItem>;
      return typeof item.taskId === "string" && item.taskId.trim() !== ""
        ? [{ taskId: item.taskId, addedAt: typeof item.addedAt === "string" ? item.addedAt : "" }]
        : [];
    });
  } catch {
    return [];
  }
}

/** Replace the queue with `items`, atomically. */
export async function writeRunQueue(henchDir: string, items: readonly RunQueueItem[]): Promise<void> {
  await mkdir(henchDir, { recursive: true });
  const path = runQueuePath(henchDir);
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify({ version: 1, items }, null, 2)}\n`, "utf-8");
  await rename(temp, path);
}

/** Take `taskIds` off the queue, keeping the rest in order. A no-op when none is on it. */
export async function removeFromRunQueue(henchDir: string, taskIds: Iterable<string>): Promise<void> {
  const drop = new Set(taskIds);
  if (drop.size === 0) return;
  const items = await readRunQueue(henchDir);
  const kept = items.filter((item) => !drop.has(item.taskId));
  if (kept.length !== items.length) await writeRunQueue(henchDir, kept);
}

/** Why a queued item was passed over, for the run's log. */
export interface QueueSkip {
  taskId: string;
  reason: string;
  /** Taken off the queue (it will never run as it stands), or kept for a later run. */
  dropped: boolean;
}

/**
 * The first queued item `tryItem` accepts, trying them in order. `tryItem`
 * resolves the item to what would run (and claims it), or throws why it
 * cannot; `keep` says whether that failure is passing (claimed by another
 * worktree, skipped as stuck) rather than final. A final failure takes the
 * item off the queue. The accepted item is taken off too, unless `dryRun`.
 */
export async function takeFromRunQueue<T>(
  henchDir: string,
  tryItem: (taskId: string) => Promise<T>,
  options: { dryRun?: boolean; keep?: (taskId: string, err: unknown) => boolean; skip?: ReadonlySet<string> } = {},
): Promise<{ picked: { taskId: string; value: T } | null; skipped: QueueSkip[] }> {
  const items = await readRunQueue(henchDir);
  const skipped: QueueSkip[] = [];
  let picked: { taskId: string; value: T } | null = null;
  for (const { taskId } of items) {
    if (options.skip?.has(taskId)) {
      skipped.push({ taskId, reason: "skipped as stuck", dropped: false });
      continue;
    }
    try {
      picked = { taskId, value: await tryItem(taskId) };
      break;
    } catch (err) {
      const dropped = !(options.keep?.(taskId, err) ?? false);
      skipped.push({ taskId, reason: err instanceof Error ? err.message : String(err), dropped });
    }
  }
  if (!options.dryRun) {
    const done = [...skipped.filter((s) => s.dropped).map((s) => s.taskId), ...(picked ? [picked.taskId] : [])];
    await removeFromRunQueue(henchDir, done);
  }
  return { picked, skipped };
}
