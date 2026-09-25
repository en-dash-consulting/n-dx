// @vitest-environment jsdom
/**
 * Tests for the usePollingSuspension hook.
 *
 * Verifies that the hook correctly reflects global polling state
 * and re-renders when suspension state changes.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { useState } from "preact/hooks";
import {
  registerPollingSource,
  suspendAllSources,
  resumeAllSources,
  resetPollingState,
  type PollingSourceCallbacks,
} from "../../../src/viewer/polling/engine/polling-state.js";
import { usePollingSuspension } from "../../../src/viewer/polling/engine/use-polling-suspension.js";

// Helper to create a minimal polling source
function makeDummySource(): PollingSourceCallbacks {
  let status: "active" | "suspended" | "disposed" = "active";
  return {
    suspend: () => { status = "suspended"; },
    resume: () => { status = "active"; },
    dispose: () => { status = "disposed"; },
    getStatus: () => status,
  };
}

// Test harness that renders the hook and exposes its output
let hookResult: ReturnType<typeof usePollingSuspension> | null = null;

function TestHarness() {
  const result = usePollingSuspension();
  hookResult = result;
  return h("div", { "data-testid": "harness" },
    h("span", { "data-suspended": String(result.isSuspended) }),
    h("span", { "data-count": String(result.suspendedCount) }),
    h("span", { "data-source-count": String(result.sourceCount) }),
    h("span", { "data-generation": String(result.generation) }),
  );
}

describe("usePollingSuspension", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    resetPollingState();
    hookResult = null;
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    // Unmount inside act() so Preact's after-paint effect queue is flushed
    // synchronously here, rather than leaking a real requestAnimationFrame +
    // setTimeout fallback pair that can fire after jsdom is torn down.
    act(() => { render(null, root); });
    if (root.parentNode) root.parentNode.removeChild(root);
    resetPollingState();
  });

  it("returns isSuspended=false when polling is running", () => {
    registerPollingSource("test-a", makeDummySource());
    act(() => { render(h(TestHarness, null), root); });
    expect(hookResult!.isSuspended).toBe(false);
    expect(hookResult!.suspendedCount).toBe(0);
  });

  it("returns isSuspended=true after suspendAllSources", () => {
    registerPollingSource("test-a", makeDummySource());
    act(() => { render(h(TestHarness, null), root); });

    suspendAllSources();

    // Re-render to pick up state change
    act(() => { render(h(TestHarness, null), root); });
    expect(hookResult!.isSuspended).toBe(true);
    expect(hookResult!.suspendedCount).toBe(1);
  });

  it("returns isSuspended=false after resumeAllSources", () => {
    registerPollingSource("test-a", makeDummySource());
    act(() => { render(h(TestHarness, null), root); });

    suspendAllSources();
    act(() => { render(h(TestHarness, null), root); });
    expect(hookResult!.isSuspended).toBe(true);

    resumeAllSources();
    act(() => { render(h(TestHarness, null), root); });
    expect(hookResult!.isSuspended).toBe(false);
    expect(hookResult!.suspendedCount).toBe(0);
  });

  it("tracks sourceCount correctly", () => {
    registerPollingSource("test-a", makeDummySource());
    registerPollingSource("test-b", makeDummySource());
    act(() => { render(h(TestHarness, null), root); });
    expect(hookResult!.sourceCount).toBe(2);
  });

  it("increments generation on suspend/resume", () => {
    registerPollingSource("test-a", makeDummySource());
    act(() => { render(h(TestHarness, null), root); });
    const gen0 = hookResult!.generation;

    suspendAllSources();
    act(() => { render(h(TestHarness, null), root); });
    expect(hookResult!.generation).toBe(gen0 + 1);

    resumeAllSources();
    act(() => { render(h(TestHarness, null), root); });
    expect(hookResult!.generation).toBe(gen0 + 2);
  });

  it("does not count essential sources as suspended", () => {
    registerPollingSource("essential-src", makeDummySource(), { essential: true });
    registerPollingSource("non-essential-src", makeDummySource());
    act(() => { render(h(TestHarness, null), root); });

    suspendAllSources();
    act(() => { render(h(TestHarness, null), root); });

    expect(hookResult!.isSuspended).toBe(true);
    // Only the non-essential source should be suspended
    expect(hookResult!.suspendedCount).toBe(1);
  });
});
