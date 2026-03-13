/**
 * Application bootstrap — module-level side effects.
 *
 * Initializes theme, tab-visibility monitoring, polling infrastructure,
 * and tick-visibility gating.  Called once at application startup before
 * the first render.
 *
 * In deployed (static export) mode, the fetch adapter is installed first
 * so all subsequent network requests are transparently rewritten to hit
 * pre-rendered JSON files instead of a live server.
 */

import { initTheme } from "./components/index.js";
import {
  startTabVisibilityMonitor,
  startPollingManager,
  startPollingRestart,
  createTickVisibilityGate,
} from "./polling/index.js";
import { isDeployedMode, installFetchAdapter } from "./deployed-mode.js";

/** Run all one-time setup operations. */
export function bootstrap(): void {
  if (isDeployedMode()) {
    installFetchAdapter();
    document.body.classList.add("ndx-deployed");
  }

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
