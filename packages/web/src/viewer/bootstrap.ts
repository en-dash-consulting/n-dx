/**
 * Application bootstrap — module-level side effects.
 *
 * Initializes tick-related viewer infrastructure. Called once at
 * application startup before the first render.
 */

import {
  startTabVisibilityMonitor,
  startPollingManager,
  createTickVisibilityGate,
} from "./polling/index.js";

/** Run all one-time setup operations. */
export function bootstrap(): void {
  // Start tab visibility and polling manager so they're available before
  // the first render.  The polling manager subscribes to visibility changes
  // and automatically suspends / resumes all registered pollers when the
  // tab is backgrounded / foregrounded.
  startTabVisibilityMonitor();
  startPollingManager();

  // Bridge tab visibility changes to the tick timer's suspend/resume
  // lifecycle: when the tab goes hidden, the 1-second elapsed time
  // interval is cleared to conserve CPU and battery; when the tab
  // returns, an immediate catch-up tick fires so elapsed time displays
  // jump to the correct current value.
  createTickVisibilityGate();
}
