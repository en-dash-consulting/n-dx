/**
 * One-second tick for live-updating duration badges.
 *
 * Returns the current wall-clock (epoch millis), refreshed every second
 * while `active` is true. When no work is running the hook parks and
 * does not schedule any timers — idle trees pay zero cost.
 *
 * ## Why a dedicated hook?
 *
 * Re-rendering the whole tree every second would destroy the virtual
 * scroll budget. The consumer pairs this hook with `shouldComponentUpdate`
 * on `NodeRow`: only rows with `status === "in_progress"` receive the
 * tick prop, so idle rows skip re-render entirely. That keeps the
 * per-frame work proportional to the number of visible running tasks,
 * which is typically 0–1.
 *
 * ## Determinism in tests
 *
 * Tests should wrap state updates in `act()` and control time with
 * `vi.useFakeTimers()`; the hook uses `setInterval` (not
 * `requestAnimationFrame`) so it plays nicely with fake timers.
 *
 * @see packages/web/src/viewer/components/prd-tree/prd-tree.ts — consumer
 */

import { useEffect, useState } from "preact/hooks";

const ONE_SECOND_MS = 1000;

export function useLiveTick(active: boolean): number {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    // Immediately sync to the current wall clock so the first render
    // after `active` flips doesn't show stale data from the prior
    // (inactive) state.
    setNowMs(Date.now());
    const handle = setInterval(() => {
      setNowMs(Date.now());
    }, ONE_SECOND_MS);
    return () => clearInterval(handle);
  }, [active]);

  return nowMs;
}
