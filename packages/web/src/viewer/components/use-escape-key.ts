/**
 * Escape closes the dialog or sheet: while `active`, an Escape keydown
 * anywhere in the window calls `onEscape`. The listener is re-attached when
 * either argument changes, so pass a stable `onEscape` where re-attaching on
 * every render would be wasted work.
 */

import { useEffect } from "preact/hooks";

export function useEscapeKey(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onEscape(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onEscape]);
}
