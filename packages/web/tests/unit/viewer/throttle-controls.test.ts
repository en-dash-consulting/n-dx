// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { ThrottleControlsPanel } from "../../../src/viewer/components/throttle-controls.js";

function renderToDiv(vnode: ReturnType<typeof h>) {
  const root = document.createElement("div");
  render(vnode, root);
  return root;
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Mock fetch to return a throttle status response. */
function mockFetch(overrides: Record<string, unknown> = {}) {
  const status = {
    paused: false,
    pausedAt: null,
    concurrencyOverride: null,
    effectiveMaxConcurrent: 3,
    configMaxConcurrent: 3,
    lastEmergencyStopAt: null,
    lastEmergencyStopCount: 0,
    activeExecutions: 0,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(status),
  });
}

/** Stub WebSocket so the component doesn't connect. */
class FakeWebSocket {
  onmessage: ((e: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  close() {}
}

// ── Tests ────────────────────────────────────────────────────────────

describe("ThrottleControlsPanel", () => {
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
    // fetch that never resolves
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    const root = renderToDiv(h(ThrottleControlsPanel, {}));
    expect(root.querySelector(".throttle-controls")).toBeNull();
  });

  it("renders throttle controls after fetch resolves", async () => {
    globalThis.fetch = mockFetch();
    const root = renderToDiv(h(ThrottleControlsPanel, {}));

    // Wait for fetch + state update
    await vi.waitFor(() => {
      expect(root.querySelector(".throttle-controls")).toBeTruthy();
    });

    // Should have a title
    const title = root.querySelector(".throttle-title");
    expect(title?.textContent).toBe("Throttle Controls");
  });

  it("shows paused badge when paused", async () => {
    globalThis.fetch = mockFetch({ paused: true, pausedAt: new Date().toISOString() });
    const root = renderToDiv(h(ThrottleControlsPanel, {}));

    await vi.waitFor(() => {
      expect(root.querySelector(".throttle-paused-badge")).toBeTruthy();
    });

    expect(root.querySelector(".throttle-paused-badge")?.textContent).toBe("Paused");
  });

  it("shows active count when executions are running", async () => {
    globalThis.fetch = mockFetch({ activeExecutions: 2 });
    const root = renderToDiv(h(ThrottleControlsPanel, {}));

    await vi.waitFor(() => {
      expect(root.querySelector(".throttle-active-count")).toBeTruthy();
    });

    expect(root.querySelector(".throttle-active-count")?.textContent).toContain("2 active");
  });

  it("renders concurrency slider with correct value", async () => {
    globalThis.fetch = mockFetch({ effectiveMaxConcurrent: 5 });
    const root = renderToDiv(h(ThrottleControlsPanel, {}));

    await vi.waitFor(() => {
      expect(root.querySelector(".throttle-slider")).toBeTruthy();
    });

    const slider = root.querySelector(".throttle-slider") as HTMLInputElement;
    expect(slider.value).toBe("5");
    expect(slider.min).toBe("1");
    expect(slider.max).toBe("10");
  });

  it("shows override indicator when concurrency is overridden", async () => {
    globalThis.fetch = mockFetch({
      concurrencyOverride: 5,
      effectiveMaxConcurrent: 5,
      configMaxConcurrent: 3,
    });
    const root = renderToDiv(h(ThrottleControlsPanel, {}));

    await vi.waitFor(() => {
      expect(root.querySelector(".throttle-override-value")).toBeTruthy();
    });

    expect(root.querySelector(".throttle-override-value")?.textContent).toBe("5");
    expect(root.querySelector(".throttle-config-hint")?.textContent).toContain("config: 3");
  });

  it("shows reset button when concurrency is overridden", async () => {
    globalThis.fetch = mockFetch({
      concurrencyOverride: 7,
      effectiveMaxConcurrent: 7,
      configMaxConcurrent: 3,
    });
    const root = renderToDiv(h(ThrottleControlsPanel, {}));

    await vi.waitFor(() => {
      expect(root.querySelector(".throttle-reset-btn")).toBeTruthy();
    });

    expect(root.querySelector(".throttle-reset-btn")?.textContent).toContain("Reset to default (3)");
  });

  it("shows pause button when not paused", async () => {
    globalThis.fetch = mockFetch({ paused: false });
    const root = renderToDiv(h(ThrottleControlsPanel, {}));

    await vi.waitFor(() => {
      expect(root.querySelector(".throttle-pause-btn")).toBeTruthy();
    });

    expect(root.querySelector(".throttle-pause-btn")?.textContent).toContain("Pause New Executions");
  });

  it("shows resume button when paused", async () => {
    globalThis.fetch = mockFetch({ paused: true, pausedAt: new Date().toISOString() });
    const root = renderToDiv(h(ThrottleControlsPanel, {}));

    await vi.waitFor(() => {
      expect(root.querySelector(".throttle-resume-btn")).toBeTruthy();
    });

    expect(root.querySelector(".throttle-resume-btn")?.textContent).toContain("Resume Executions");
  });

  it("disables emergency stop when no active executions", async () => {
    globalThis.fetch = mockFetch({ activeExecutions: 0 });
    const root = renderToDiv(h(ThrottleControlsPanel, {}));

    await vi.waitFor(() => {
      expect(root.querySelector(".throttle-stop-btn")).toBeTruthy();
    });

    const btn = root.querySelector(".throttle-stop-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe("No Active Executions");
  });

  it("enables emergency stop when active executions exist", async () => {
    globalThis.fetch = mockFetch({ activeExecutions: 3 });
    const root = renderToDiv(h(ThrottleControlsPanel, {}));

    await vi.waitFor(() => {
      expect(root.querySelector(".throttle-stop-btn")).toBeTruthy();
    });

    const btn = root.querySelector(".throttle-stop-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toContain("Stop All Executions (3)");
  });

  it("shows confirmation dialog on emergency stop click", async () => {
    globalThis.fetch = mockFetch({ activeExecutions: 2 });
    const root = renderToDiv(h(ThrottleControlsPanel, {}));

    await vi.waitFor(() => {
      expect(root.querySelector(".throttle-stop-btn")).toBeTruthy();
    });

    const btn = root.querySelector(".throttle-stop-btn") as HTMLButtonElement;
    btn.click();

    await vi.waitFor(() => {
      expect(root.querySelector(".throttle-stop-confirm")).toBeTruthy();
    });

    expect(root.querySelector(".throttle-stop-warn")?.textContent).toContain(
      "terminate 2 running executions",
    );
  });

  it("has correct ARIA attributes", async () => {
    globalThis.fetch = mockFetch();
    const root = renderToDiv(h(ThrottleControlsPanel, {}));

    await vi.waitFor(() => {
      expect(root.querySelector(".throttle-controls")).toBeTruthy();
    });

    const panel = root.querySelector(".throttle-controls");
    expect(panel?.getAttribute("role")).toBe("region");
    expect(panel?.getAttribute("aria-label")).toBe("Execution throttle controls");
  });

  it("sends PUT request when concurrency slider changes", async () => {
    const fetchFn = mockFetch();
    globalThis.fetch = fetchFn;
    const root = renderToDiv(h(ThrottleControlsPanel, {}));

    await vi.waitFor(() => {
      expect(root.querySelector(".throttle-slider")).toBeTruthy();
    });

    // Clear the initial fetch call
    fetchFn.mockClear();
    fetchFn.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        paused: false,
        pausedAt: null,
        concurrencyOverride: 5,
        effectiveMaxConcurrent: 5,
        configMaxConcurrent: 3,
        lastEmergencyStopAt: null,
        lastEmergencyStopCount: 0,
        activeExecutions: 0,
        timestamp: new Date().toISOString(),
      }),
    });

    const slider = root.querySelector(".throttle-slider") as HTMLInputElement;
    const changeEvent = new Event("change", { bubbles: true });
    Object.defineProperty(changeEvent, "target", { value: { value: "5" } });
    slider.dispatchEvent(changeEvent);

    await vi.waitFor(() => {
      expect(fetchFn).toHaveBeenCalledWith(
        "/api/hench/throttle",
        expect.objectContaining({
          method: "PUT",
          body: expect.any(String),
        }),
      );
    });
  });
});
