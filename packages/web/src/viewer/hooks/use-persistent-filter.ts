/**
 * Persistent status filter state for the PRD tree.
 *
 * Stores the active status filter selection in a module-level variable
 * so it survives component mount/unmount cycles (e.g. when the user
 * navigates from the PRD tree to the Rex Dashboard and back).
 *
 * The hook returns the current state and a setter, mirroring useState.
 */

import { useState, useCallback, useRef } from "preact/hooks";
import type { ItemStatus } from "../components/prd-tree/types.js";
import { defaultStatusFilter } from "../views/status-filter.js";

// ── Module-level persistent state ────────────────────────────────────
//
// This variable outlives any single component instance. When the PRD
// view unmounts (e.g. navigating to the dashboard) and remounts, the
// hook reads from here instead of resetting to the default.

let persistedStatuses: Set<ItemStatus> | null = null;

/** Get the persisted filter state, or the default if none has been set. */
function getPersistedStatuses(): Set<ItemStatus> {
  return persistedStatuses ?? defaultStatusFilter();
}

// ── Hook ──────────────────────────────────────────────────────────────

export interface PersistentFilterState {
  /** Currently active (visible) statuses. */
  activeStatuses: Set<ItemStatus>;
  /** Update the active statuses (also persists across remounts). */
  setActiveStatuses: (statuses: Set<ItemStatus>) => void;
  /**
   * True when a selection was already persisted before this mount (i.e. the
   * user has interacted, or a smart default was applied earlier this page
   * session). Lets callers apply a data-derived default only on a fresh load.
   */
  hadPersistedSelection: boolean;
}

/**
 * Hook that provides filter state which persists across view switches.
 *
 * On first mount (or after a full page reload), the default "Active Work"
 * filter is used. Subsequent mounts within the same page session restore
 * the last selection.
 */
export function usePersistentFilter(): PersistentFilterState {
  // Capture, once, whether a selection was already persisted when this
  // component first mounted. A fresh page load resets the module variable to
  // null, so this is false on load and true after any prior selection.
  const hadPersistedSelection = useRef(persistedStatuses !== null).current;

  const [activeStatuses, setActiveStatusesLocal] = useState<Set<ItemStatus>>(
    getPersistedStatuses,
  );

  const setActiveStatuses = useCallback((statuses: Set<ItemStatus>) => {
    persistedStatuses = statuses;
    setActiveStatusesLocal(statuses);
  }, []);

  return { activeStatuses, setActiveStatuses, hadPersistedSelection };
}
