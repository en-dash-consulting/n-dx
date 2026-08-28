/**
 * Console/page-error collector for browser-driven UI tests.
 *
 * Attaches once per page and accumulates browser console errors and
 * uncaught exceptions so a test can assert "this view rendered without
 * throwing" — the class of bug (import errors, undefined property access,
 * failed fetches surfaced as unhandled rejections) that a pure visual
 * screenshot check won't catch.
 */

import type { Page } from "@playwright/test";

export interface ConsoleErrorTracker {
  errors: string[];
  reset(): void;
}

/**
 * Patterns that are noisy but not indicative of a real UI bug — e.g. a
 * WebSocket reconnect attempt while the fixture server is being torn down
 * mid-test, or a favicon 404 on a bare dev fixture.
 */
const IGNORED_PATTERNS = [
  /favicon\.ico/i,
  /WebSocket connection to .* failed/i,
];

export function trackConsoleErrors(page: Page): ConsoleErrorTracker {
  const tracker: ConsoleErrorTracker = {
    errors: [],
    reset() {
      tracker.errors = [];
    },
  };

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (IGNORED_PATTERNS.some((re) => re.test(text))) return;
    tracker.errors.push(text);
  });

  page.on("pageerror", (err) => {
    tracker.errors.push(`Uncaught: ${err.message}`);
  });

  return tracker;
}
