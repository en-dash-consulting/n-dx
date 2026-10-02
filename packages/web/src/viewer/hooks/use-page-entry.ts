/**
 * The page under the settings overlay, with the selections that address it.
 *
 * Settings routes open as an overlay over the page you were on, which stays
 * mounted underneath. Opening settings clears the route's selections, so the
 * page's own file/zone/run/task ids are remembered here: the page keeps
 * rendering with them, and closing settings returns to the same address
 * (`/live/task/X`, not a task page with no task).
 */

import { useEffect, useState } from "preact/hooks";
import type { ViewId } from "../types.js";

/** A page and the selections that address it. */
export interface PageEntry {
  view: ViewId;
  file: string | null;
  zone: string | null;
  runId: string | null;
  taskId: string | null;
}

/**
 * @param current  the route as it stands, settings views included
 * @param isSettings  whether `current.view` is a settings view
 * @param fallback  the page to show when settings is the first thing loaded
 * @returns `page` — what to render now; `lastEntry` — where closing settings goes
 */
export function usePageEntry(
  current: PageEntry,
  isSettings: boolean,
  fallback: ViewId,
): { page: PageEntry; lastEntry: PageEntry } {
  const [lastEntry, setLastEntry] = useState<PageEntry>(
    () => (isSettings ? { view: fallback, file: null, zone: null, runId: null, taskId: null } : current),
  );
  useEffect(() => {
    if (!isSettings) setLastEntry(current);
  }, [isSettings, current.view, current.file, current.zone, current.runId, current.taskId]);
  return { page: isSettings ? lastEntry : current, lastEntry };
}
