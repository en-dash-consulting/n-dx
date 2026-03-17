// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { WsHealthPanel } from "../../../src/viewer/components/ws-health-panel.js";

function renderToDiv(vnode: ReturnType<typeof h>) {
  const root = document.createElement("div");
  render(vnode, root);
  return root;
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Build a mock WsHealthStatus response. */
function makeHealthStatus(overrides: Record<string, unknown> = {}) {
  return {
    activeConnections: 1,
    peakConnections: 3,
    totalConnectionsAccepted: 10,
    totalConnectionsRemoved: 7,
    cleanupsByReason: {
      close: 5,
      error: 1,
      end: 0,
      ping_timeout: 1,
      prune: 0,
      shutdown: 0,
      write_fail: 0,
    },
    recentCleanups: 2,
    avgConnectionDurationMs: 45000,
    totalBroadcasts: 150,
    totalBroadcastWriteFailures: 0,
    cleanupSuccessRate: 0.95,
    avgCleanupLatencyMs: 5,
    health: "healthy",
    uptimeMs: 3600000,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function mockFetch(overrides: Record<string, unknown> = {}) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(makeHealthStatus(overrides)),
  });
}

/** Stub WebSocket. */
class FakeWebSocket {
  onmessage: ((e: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  close() {}
}

// ── Tests ────────────────────────────────────────────────────────────

describe("WsHealthPanel", () => {
  let originalFetch: typeof globalThis.fetch;
  let originalWS: typeof globalThis.WebSocket;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalWS = globalThis.WebSocket;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWS;
    vi.restoreAllMocks();
  });

  it("renders nothing before data is loaded", () => {
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    const root = renderToDiv(h(WsHealthPanel, {}));
    expect(root.querySelector(".ws-health-panel")).toBeNull();
  });

  it("renders health panel after fetch resolves", async () => {
    globalThis.fetch = mockFetch();
    const root = renderToDiv(h(WsHealthPanel, {}));

    await vi.waitFor(() => {
      expect(root.querySelector(".ws-health-panel")).toBeTruthy();
    });

    expect(root.querySelector(".ws-health-title")?.textContent).toBe("WebSocket Health");
  });

  it("displays health level badge", async () => {
    globalThis.fetch = mockFetch({ health: "healthy" });
    const root = renderToDiv(h(WsHealthPanel, {}));

    await vi.waitFor(() => {
      expect(root.querySelector(".ws-health-badge-healthy")).toBeTruthy();
    });

    expect(root.querySelector(".ws-health-badge-healthy")?.textContent).toBe("Healthy");
  });

  it("shows degraded health level", async () => {
    globalThis.fetch = mockFetch({ health: "degraded" });
    const root = renderToDiv(h(WsHealthPanel, {}));

    await vi.waitFor(() => {
      expect(root.querySelector(".ws-health-badge-degraded")).toBeTruthy();
    });

    expect(root.querySelector(".ws-health-badge-degraded")?.textContent).toBe("Degraded");
  });

  it("shows unhealthy health level", async () => {
    globalThis.fetch = mockFetch({ health: "unhealthy" });
    const root = renderToDiv(h(WsHealthPanel, {}));

    await vi.waitFor(() => {
      expect(root.querySelector(".ws-health-badge-unhealthy")).toBeTruthy();
    });

    expect(root.querySelector(".ws-health-badge-unhealthy")?.textContent).toBe("Unhealthy");
  });

  it("displays active connection count", async () => {
    globalThis.fetch = mockFetch({ activeConnections: 5 });
    const root = renderToDiv(h(WsHealthPanel, {}));

    await vi.waitFor(() => {
      expect(root.querySelector(".ws-health-count-value")).toBeTruthy();
    });

    expect(root.querySelector(".ws-health-count-value")?.textContent).toBe("5");
    expect(root.querySelector(".ws-health-count-label")?.textContent).toContain("active");
  });

  it("renders connection bar when peak > 0", async () => {
    globalThis.fetch = mockFetch({ activeConnections: 2, peakConnections: 8 });
    const root = renderToDiv(h(WsHealthPanel, {}));

    await vi.waitFor(() => {
      expect(root.querySelector(".ws-health-bar-container")).toBeTruthy();
    });

    const detail = root.querySelector(".ws-health-bar-detail");
    expect(detail?.textContent).toContain("2 active / 8 peak");
  });

  it("renders cleanup success rate bar", async () => {
    globalThis.fetch = mockFetch({ cleanupSuccessRate: 0.95, totalConnectionsRemoved: 20 });
    const root = renderToDiv(h(WsHealthPanel, {}));

    await vi.waitFor(() => {
      const bars = root.querySelectorAll(".ws-health-bar-container");
      expect(bars.length).toBeGreaterThanOrEqual(2);
    });

    // Find the cleanup success bar
    const labels = root.querySelectorAll(".ws-health-bar-label");
    let found = false;
    labels.forEach((label) => {
      if (label.textContent?.includes("Cleanup Success")) {
        found = true;
        const detail = label.querySelector(".ws-health-bar-detail");
        expect(detail?.textContent).toBe("95%");
      }
    });
    expect(found).toBe(true);
  });

  it("displays cleanup breakdown for non-zero reasons", async () => {
    globalThis.fetch = mockFetch({
      cleanupsByReason: {
        close: 10,
        error: 2,
        end: 0,
        ping_timeout: 0,
        prune: 0,
        shutdown: 0,
        write_fail: 0,
      },
    });
    const root = renderToDiv(h(WsHealthPanel, {}));

    await vi.waitFor(() => {
      expect(root.querySelector(".ws-health-cleanup-breakdown")).toBeTruthy();
    });

    const rows = root.querySelectorAll(".ws-health-cleanup-row");
    expect(rows.length).toBe(2); // Only close and error (non-zero)

    // Sorted by count: close (10) first, error (2) second
    const reasons = Array.from(rows).map((r) =>
      r.querySelector(".ws-health-cleanup-reason")?.textContent,
    );
    expect(reasons[0]).toBe("Clean close");
    expect(reasons[1]).toBe("Socket error");
  });

  it("marks non-event-driven cleanup reasons with warning class", async () => {
    globalThis.fetch = mockFetch({
      cleanupsByReason: {
        close: 5,
        error: 0,
        end: 0,
        ping_timeout: 3,
        prune: 1,
        shutdown: 0,
        write_fail: 0,
      },
    });
    const root = renderToDiv(h(WsHealthPanel, {}));

    await vi.waitFor(() => {
      expect(root.querySelector(".ws-health-cleanup-breakdown")).toBeTruthy();
    });

    const warnRows = root.querySelectorAll(".ws-health-cleanup-row-warn");
    // ping_timeout and prune are safety-net reasons (non-event-driven)
    expect(warnRows.length).toBe(2);
  });

  it("displays stats row with totals and uptime", async () => {
    globalThis.fetch = mockFetch({
      totalConnectionsAccepted: 42,
      totalBroadcasts: 200,
      avgConnectionDurationMs: 30000,
      uptimeMs: 7200000, // 2h
    });
    const root = renderToDiv(h(WsHealthPanel, {}));

    await vi.waitFor(() => {
      expect(root.querySelector(".ws-health-stats")).toBeTruthy();
    });

    const stats = root.querySelectorAll(".ws-health-stat");
    expect(stats.length).toBe(4);

    const values = Array.from(stats).map((s) =>
      s.querySelector(".ws-health-stat-value")?.textContent,
    );
    expect(values).toContain("42");
    expect(values).toContain("200");
    expect(values).toContain("30.0s");
    expect(values).toContain("2h 0m");
  });

  it("shows broadcast failure alert when failures exist", async () => {
    globalThis.fetch = mockFetch({
      totalBroadcasts: 100,
      totalBroadcastWriteFailures: 3,
    });
    const root = renderToDiv(h(WsHealthPanel, {}));

    await vi.waitFor(() => {
      expect(root.querySelector(".ws-health-failure-alert")).toBeTruthy();
    });

    const text = root.querySelector(".ws-health-failure-text")?.textContent;
    expect(text).toContain("3 broadcast write failures");
    expect(text).toContain("3.0%");
  });

  it("hides broadcast failure alert when no failures", async () => {
    globalThis.fetch = mockFetch({
      totalBroadcasts: 100,
      totalBroadcastWriteFailures: 0,
    });
    const root = renderToDiv(h(WsHealthPanel, {}));

    await vi.waitFor(() => {
      expect(root.querySelector(".ws-health-panel")).toBeTruthy();
    });

    expect(root.querySelector(".ws-health-failure-alert")).toBeNull();
  });

  it("has correct ARIA attributes", async () => {
    globalThis.fetch = mockFetch();
    const root = renderToDiv(h(WsHealthPanel, {}));

    await vi.waitFor(() => {
      expect(root.querySelector(".ws-health-panel")).toBeTruthy();
    });

    const panel = root.querySelector(".ws-health-panel");
    expect(panel?.getAttribute("role")).toBe("region");
    expect(panel?.getAttribute("aria-label")).toBe("WebSocket connection health");
  });

  it("applies health-specific CSS class", async () => {
    globalThis.fetch = mockFetch({ health: "degraded" });
    const root = renderToDiv(h(WsHealthPanel, {}));

    await vi.waitFor(() => {
      expect(root.querySelector(".ws-health-panel-degraded")).toBeTruthy();
    });
  });
});
