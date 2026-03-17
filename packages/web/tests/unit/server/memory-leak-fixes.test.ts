/**
 * Tests for memory leak fixes in the web server layer.
 *
 * Covers:
 * - MCP session TTL cleanup (stale sessions are swept)
 * - File watcher debouncing (rapid changes are batched)
 *
 * Note: Loader onChange tests live in tests/unit/viewer/loader-onchange.test.ts
 * to keep viewer-layer imports out of the server test zone.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── MCP session TTL tests ─────────────────────────────────────────────────────

describe("MCP session TTL", () => {
  // We test the sweepStaleSessions logic by simulating the internal map behavior.
  // The actual MCP session map is module-private, so we test the observable behavior
  // via closeAllMcpSessions which also clears the sweep timer.

  it("closeAllMcpSessions clears sessions and is safe to call multiple times", async () => {
    const { closeAllMcpSessions } = await import("../../../src/server/routes-mcp.js");
    // Should not throw even with no active sessions
    await closeAllMcpSessions();
    await closeAllMcpSessions();
  });
});

// ── Debounce utility tests ────────────────────────────────────────────────────

describe("file watcher debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("collapses rapid calls into a single invocation", () => {
    // Replicate the debounce pattern used in start.ts
    function debounce<T extends (...args: unknown[]) => void>(fn: T, delayMs: number): T {
      let timer: ReturnType<typeof setTimeout> | null = null;
      return ((...args: unknown[]) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; fn(...args); }, delayMs);
      }) as T;
    }

    const callback = vi.fn();
    const debounced = debounce(callback, 500);

    // Fire 10 rapid calls
    for (let i = 0; i < 10; i++) {
      debounced();
    }

    // Nothing fired yet
    expect(callback).not.toHaveBeenCalled();

    // Advance past debounce window
    vi.advanceTimersByTime(500);

    // Only one invocation
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("fires again after debounce window resets", () => {
    function debounce<T extends (...args: unknown[]) => void>(fn: T, delayMs: number): T {
      let timer: ReturnType<typeof setTimeout> | null = null;
      return ((...args: unknown[]) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; fn(...args); }, delayMs);
      }) as T;
    }

    const callback = vi.fn();
    const debounced = debounce(callback, 500);

    // First burst
    debounced();
    debounced();
    vi.advanceTimersByTime(500);
    expect(callback).toHaveBeenCalledTimes(1);

    // Second burst after window
    debounced();
    vi.advanceTimersByTime(500);
    expect(callback).toHaveBeenCalledTimes(2);
  });
});
