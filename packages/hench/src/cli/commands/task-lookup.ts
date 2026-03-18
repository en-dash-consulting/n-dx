import { join } from "node:path";
import { HENCH_DIR } from "./constants.js";

/**
 * Try to look up a task's current state in the rex PRD.
 * Returns the current title if found, or null if the task no longer exists.
 * Never throws — gracefully returns null on any error.
 */
export async function lookupTaskInRex(
  dir: string,
  taskId: string,
): Promise<{ exists: true; title: string; status: string } | { exists: false }> {
  try {
    const { resolveStore } = await import("@n-dx/rex");
    const { findItem } = await import("@n-dx/rex");
    const { loadConfig } = await import("../../store/config.js");

    const henchDir = join(dir, HENCH_DIR);
    const config = await loadConfig(henchDir);
    const rexDir = join(dir, config.rexDir);
    const store = await resolveStore(rexDir);
    const doc = await store.loadDocument();
    const entry = findItem(doc.items, taskId);

    if (entry) {
      return { exists: true, title: entry.item.title, status: entry.item.status };
    }
    return { exists: false };
  } catch {
    // Rex not available or any other error — treat as unknown
    return { exists: false };
  }
}

/**
 * Batch-check which task IDs still exist in the rex PRD.
 * Returns a Set of existing task IDs, or null if rex is unavailable.
 * Never throws — gracefully returns null on any error.
 */
export async function batchLookupTasksInRex(
  dir: string,
  taskIds: string[],
): Promise<Set<string> | null> {
  try {
    const { resolveStore } = await import("@n-dx/rex");
    const { findItem } = await import("@n-dx/rex");
    const { loadConfig } = await import("../../store/config.js");

    const henchDir = join(dir, HENCH_DIR);
    const config = await loadConfig(henchDir);
    const rexDir = join(dir, config.rexDir);
    const store = await resolveStore(rexDir);
    const doc = await store.loadDocument();

    const existing = new Set<string>();
    for (const id of taskIds) {
      if (findItem(doc.items, id)) {
        existing.add(id);
      }
    }
    return existing;
  } catch {
    // Rex not available or any other error — return null (unknown)
    return null;
  }
}

/**
 * Format the task line for display.
 * If the task no longer exists in rex, appends "[task deleted]".
 * If taskExists is null (rex unavailable), shows the cached title without annotation.
 */
export function formatTaskLine(
  taskTitle: string,
  taskId: string,
  taskExists: boolean | null,
): string {
  const base = `${taskTitle} (${taskId})`;
  if (taskExists === false) {
    return `${base} [task deleted]`;
  }
  return base;
}
