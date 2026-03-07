/**
 * Application bootstrap — module-level side effects.
 *
 * Initializes theme, tab-visibility monitoring, polling infrastructure,
 * and tick-visibility gating.  Called once at application startup before
 * the first render.
 */

import { initTheme } from "./components/theme-toggle.js";
import { startTabVisibilityMonitor } from "./polling/tab-visibility.js";
import { startPollingManager } from "./polling/polling-manager.js";
import { startPollingRestart } from "./polling/polling-restart.js";
import { createTickVisibilityGate } from "./polling/tick-visibility-gate.js";

/** Run all one-time setup operations. */
export function bootstrap(): void {
  initTheme();

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

  // Bridge the graceful degradation system to centralized polling state:
  // when memory pressure disables autoRefresh, all non-essential polling
  // sources are suspended; when pressure subsides, they restart at
  // original intervals.
  startPollingRestart();
}
