/**
 * Keeps the two places that edit the agent's settings in step: Settings
 * (Robot Wrangler, Workflow) and Work › Tune's Agent settings tile.
 *
 * A surface that saves announces it; every other mounted surface re-reads.
 * The settings overlay opens over Work, so without this the tile beneath it
 * would show what it read before the overlay saved. A same-tab DOM event is
 * enough: both surfaces live in one page, and each still reads the server on
 * mount, which covers another tab.
 *
 * @module viewer/views/settings-sync
 */

import { useEffect, useRef } from "preact/hooks";

/** Which settings a save touched. */
export type SettingsArea = "llm" | "hench" | "agent-prompt";

const EVENT = "ndx:settings-saved";

interface SavedDetail {
  area: SettingsArea;
  /** The surface that saved, so it does not re-read its own write. */
  source: string;
}

/** Say that `source` saved `area`. */
export function announceSettingsSaved(area: SettingsArea, source: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<SavedDetail>(EVENT, { detail: { area, source } }));
}

/** Call `onSaved` when another surface saves one of `areas`. */
export function useSettingsSaved(areas: readonly SettingsArea[], source: string, onSaved: () => void): void {
  const latest = useRef(onSaved);
  latest.current = onSaved;
  const key = areas.join(",");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const wanted = new Set(key.split(","));
    const listener = (e: Event) => {
      const detail = (e as CustomEvent<SavedDetail>).detail;
      if (detail && detail.source !== source && wanted.has(detail.area)) latest.current();
    };
    window.addEventListener(EVENT, listener);
    return () => window.removeEventListener(EVENT, listener);
  }, [key, source]);
}
