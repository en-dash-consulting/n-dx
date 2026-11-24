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

import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
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

/** The lock both writers hold around a read-modify-write of the queue: `run-queue.json.lock`. */
export function runQueueLockPath(henchDir: string): string {
  return `${runQueuePath(henchDir)}.lock`;
}

/** How long a writer waits for the lock before giving up. */
export const RUN_QUEUE_LOCK_WAIT_MS = 5_000;
/** A lock older than this was left by a writer that died: it is broken. A real hold lasts milliseconds. */
export const RUN_QUEUE_LOCK_STALE_MS = 30_000;
const LOCK_POLL_MS = 20;

/**
 * Run `fn` holding the queue's lock. The lock is a file created exclusively
 * (`wx`) beside the queue, which the dashboard's queue route takes the same
 * way (web `server/routes-hench-queue.ts`): the two processes share no code,
 * only this file contract. Without it, `ndx work` reading `[a,b]`, the
 * dashboard saving `[a,b,c]`, and `ndx work` writing `[b]` would drop `c`.
 * Throws when the lock is still held after {@link RUN_QUEUE_LOCK_WAIT_MS}.
 */
export async function withRunQueueLock<T>(
  henchDir: string,
  fn: () => Promise<T>,
  { waitMs = RUN_QUEUE_LOCK_WAIT_MS }: { waitMs?: number } = {},
): Promise<T> {
  await mkdir(henchDir, { recursive: true });
  const lock = runQueueLockPath(henchDir);
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      await writeFile(lock, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { encoding: "utf-8", flag: "wx" });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      try {
        if (Date.now() - (await stat(lock)).mtimeMs > RUN_QUEUE_LOCK_STALE_MS) {
          await rm(lock, { force: true });
          continue;
        }
      } catch {
        continue; // released between the create and the stat: try again at once
      }
      if (Date.now() > deadline) throw new Error(`The run queue is locked by another writer (${lock}).`);
      await new Promise((r) => setTimeout(r, LOCK_POLL_MS));
    }
  }
  try {
    return await fn();
  } finally {
    await rm(lock, { force: true });
  }
}

/**
 * Take `taskIds` off the queue, keeping the rest in order. A no-op when none
 * is on it. The read and the write happen under the queue's lock, so a save
 * the dashboard makes meanwhile is read here, not overwritten.
 */
export async function removeFromRunQueue(
  henchDir: string,
  taskIds: Iterable<string>,
  lock: { waitMs?: number } = {},
): Promise<void> {
  const drop = new Set(taskIds);
  if (drop.size === 0) return;
  await withRunQueueLock(henchDir, async () => {
    const items = await readRunQueue(henchDir);
    const kept = items.filter((item) => !drop.has(item.taskId));
    if (kept.length !== items.length) await writeRunQueue(henchDir, kept);
  }, lock);
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
 * cannot; `final` says whether that failure means the item will never run as
 * it stands (finished, gone). Only a final failure takes the item off the
 * queue: any other (blocked, claimed elsewhere, an error reading the PRD) is
 * passing, and the item waits, so the queue is never lost to a bad moment.
 * Items in `skip` (stuck) are passed over and kept. The accepted item is taken
 * off too, unless `dryRun`.
 */
export async function takeFromRunQueue<T>(
  henchDir: string,
  tryItem: (taskId: string) => Promise<T>,
  options: { dryRun?: boolean; final?: (taskId: string, err: unknown) => boolean; skip?: ReadonlySet<string>; lockWaitMs?: number } = {},
): Promise<{ picked: { taskId: string; value: T } | null; skipped: QueueSkip[]; removalError?: string }> {
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
      const dropped = options.final?.(taskId, err) ?? false;
      skipped.push({ taskId, reason: err instanceof Error ? err.message : String(err), dropped });
    }
  }
  let removalError: string | undefined;
  if (!options.dryRun) {
    const done = [...skipped.filter((s) => s.dropped).map((s) => s.taskId), ...(picked ? [picked.taskId] : [])];
    try {
      await removeFromRunQueue(henchDir, done, options.lockWaitMs === undefined ? {} : { waitMs: options.lockWaitMs });
    } catch (err) {
      // The queue only steers selection: a lock held too long must not fail the run.
      // What was not taken off is dropped later, once it reads as finished.
      removalError = err instanceof Error ? err.message : String(err);
    }
  }
  return { picked, skipped, ...(removalError ? { removalError } : {}) };
}
