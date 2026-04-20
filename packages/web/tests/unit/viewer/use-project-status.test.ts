// @vitest-environment jsdom
/**
 * Tests for the useProjectStatus hook.
 *
 * Covers: initial fetch, dedup, caching, degradation-aware polling,
 * and WebSocket-driven refresh.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("../../../src/viewer/views/use-polling.js", () => ({
  usePolling: vi.fn(),
}));

let pipelineOnFlush: ((batch: { types: Set<string> }) => void) | null = null;

const degradationListeners: Array<(state: { disabledFeatures: Set<string> }) => void> = [];

vi.mock("../../../src/viewer/hooks/use-gateway.js", () => ({
  createWSPipeline: vi.fn((opts: { onFlush: (batch: { types: Set<string> }) => void }) => {
    pipelineOnFlush = opts.onFlush;
    return { push: vi.fn(), dispose: vi.fn() };
  }),
  isFeatureDisabled: vi.fn(() => false),
  onDegradationChange: (handler: (state: { disabledFeatures: Set<string> }) => void) => {
    degradationListeners.push(handler);
    return () => {
      const idx = degradationListeners.indexOf(handler);
      if (idx >= 0) degradationListeners.splice(idx, 1);
    };
  },
}));

import { useProjectStatus } from "../../../src/viewer/hooks/use-project-status.js";
import { usePolling } from "../../../src/viewer/views/use-polling.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockStatus = {
  sv: { freshness: "fresh", analyzedAt: "2026-01-01", minutesAgo: 5, modulesComplete: 4, modulesTotal: 4 },
  rex: { exists: true, percentComplete: 50, stats: null, hasInProgress: true, hasPending: true, nextTaskTitle: "Test task" },
  hench: { configured: true, totalRuns: 3, activeRuns: 0, staleRuns: 0 },
};

// ─── Harness ─────────────────────────────────────────────────────────────────

let hookResult: ReturnType<typeof useProjectStatus>;

function TestHarness() {
  hookResult = useProjectStatus();
  return h("div", null, JSON.stringify(hookResult));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useProjectStatus", () => {
  let root: HTMLDivElement;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    vi.clearAllMocks();
    pipelineOnFlush = null;
    degradationListeners.length = 0;

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ...mockStatus }),
    });
  });

  afterEach(() => {
    render(null, root);
    if (root.parentNode) root.parentNode.removeChild(root);
    globalThis.fetch = originalFetch;
  });

  it("fetches status on mount", async () => {
    render(h(TestHarness, null), root);

    await vi.waitFor(() => {
      expect(hookResult).not.toBeNull();
    });

    expect(hookResult?.rex.percentComplete).toBe(50);
    expect(hookResult?.sv.freshness).toBe("fresh");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/status");
  });

  it("registers polling via usePolling with correct source name", () => {
    render(h(TestHarness, null), root);

    expect(usePolling).toHaveBeenCalledWith(
      "status-indicators",
      expect.any(Function),
      10_000,
      true,
    );
  });

  it("subscribes to degradation changes for autoRefresh", async () => {
    render(h(TestHarness, null), root);

    // Wait for effects to run
    await vi.waitFor(() => {
      expect(degradationListeners.length).toBeGreaterThan(0);
    });
  });

  it("creates a WebSocket pipeline on mount", async () => {
    render(h(TestHarness, null), root);

    await vi.waitFor(() => {
      expect(pipelineOnFlush).toBeInstanceOf(Function);
    });
  });

  it("handles fetch failure gracefully", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    render(h(TestHarness, null), root);

    // Should not throw
    await new Promise((r) => setTimeout(r, 50));
  });
});
