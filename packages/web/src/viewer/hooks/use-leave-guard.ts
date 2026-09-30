/**
 * Leave guard for the shared settings frame's unsaved-changes prompt.
 *
 * The frame (`components/settings-frame.ts`) mounts deep inside the settings
 * overlay's content, while navigation — `navigateTo`, `handleSidebarNav`, and
 * the popstate handler — lives in `useRouteState` at the app root. A plain
 * module-level store, not React context, lets both sides talk to the same
 * guard without threading a provider through a render tree that otherwise
 * has no reason to know about settings.
 *
 * Only one frame is ever mounted at a time (the active settings page inside
 * the overlay), so a single module-level "active guard" is enough: no id or
 * registry is needed to tell one registrant from another.
 */

import { useCallback, useEffect, useRef, useState } from "preact/hooks";

interface ActiveGuard {
  /** Restores the page's last-saved values. Bound to the latest prop via a ref. */
  onDiscard: () => void;
}

export interface LeaveGuardHandle {
  /** True while the "keep editing / discard changes" prompt is open. */
  promptOpen: boolean;
  /** "Keep editing" — cancel the pending navigation; nothing changes. */
  keepEditing: () => void;
  /** "Discard changes" — restore saved values, then run the navigation. */
  discardChanges: () => void;
}

let activeGuard: ActiveGuard | null = null;
let pendingAction: (() => void) | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** True while a mounted settings frame is dirty and guarding navigation. */
export function isLeaveGuarded(): boolean {
  return activeGuard !== null;
}

/**
 * Run `action` now when nothing is guarding navigation. Otherwise hold it
 * and open the leave prompt on the guarding frame.
 *
 * Returns whether `action` ran immediately — callers that also need to
 * touch `history` (the popstate handler) use this to know whether their own
 * change already landed or is still pending the user's choice.
 */
export function guardedLeave(action: () => void): boolean {
  if (!activeGuard) {
    action();
    return true;
  }
  pendingAction = action;
  emit();
  return false;
}

/**
 * Registers the calling settings frame as the active leave guard while
 * `dirty` is true, and surfaces the "keep editing / discard changes" prompt
 * state raised by a blocked navigation attempt.
 *
 * `onDiscard` is read through a ref, not a dependency, so passing a fresh
 * inline function every render does not re-arm the `beforeunload` listener.
 */
export function useLeaveGuard(dirty: boolean, onDiscard?: () => void): LeaveGuardHandle {
  const onDiscardRef = useRef(onDiscard);
  onDiscardRef.current = onDiscard;

  useEffect(() => {
    activeGuard = dirty ? { onDiscard: () => onDiscardRef.current?.() } : null;
    if (!dirty) return undefined;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [dirty]);

  // Unmounting clears any guard (and prompt) this instance owned, so a
  // frame that goes away mid-prompt — e.g. a forced re-render elsewhere —
  // never leaves a stale guard behind for the next one.
  useEffect(() => () => {
    activeGuard = null;
    pendingAction = null;
  }, []);

  const [, bump] = useState(0);
  useEffect(() => {
    const listener = () => bump((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const keepEditing = useCallback(() => {
    pendingAction = null;
    emit();
  }, []);

  const discardChanges = useCallback(() => {
    const action = pendingAction;
    pendingAction = null;
    const discard = activeGuard?.onDiscard;
    activeGuard = null;
    discard?.();
    action?.();
    emit();
  }, []);

  return { promptOpen: pendingAction !== null, keepEditing, discardChanges };
}
