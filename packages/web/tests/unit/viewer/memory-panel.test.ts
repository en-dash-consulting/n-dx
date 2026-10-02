// @vitest-environment jsdom
/**
 * The Memory panel against the shared available-memory reading.
 *
 * Two things matter here and nothing else does: the number is *available*
 * memory rather than `os.freemem()`, and a machine that could not be read is
 * shown as unknown — never as a machine under pressure.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { MemoryPanel } from "../../../src/viewer/components/memory-panel.js";

const GIB = 1024 ** 3;

/** A /api/hench/memory body, defaulting to a healthy macOS reading. */
function body(system: Record<string, unknown>, health: string) {
  return {
    system: { totalBytes: 16 * GIB, ...system },
    server: { pid: 1, rssBytes: 100 * 1024 ** 2, heapUsedBytes: 1, heapTotalBytes: 2, externalBytes: 0 },
    processes: [],
    health,
    loadAvg: [1.5, 1, 1],
    cpuCount: 8,
    timestamp: "2026-10-01T12:00:00.000Z",
  };
}

describe("MemoryPanel", () => {
  let root: HTMLDivElement;
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    // The panel opens a socket for live updates; the fetch is enough here.
    globalThis.WebSocket = class {
      close(): void {}
    } as unknown as typeof WebSocket;
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    globalThis.WebSocket = originalWebSocket;
    vi.unstubAllGlobals();
  });

  async function mount(payload: unknown): Promise<HTMLDivElement> {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => payload })));
    render(h(MemoryPanel, {}), root);
    await vi.waitFor(() => expect(root.querySelector(".memory-panel")).not.toBeNull());
    return root;
  }

  it("labels the machine's memory 'available', not 'free'", async () => {
    await mount(body(
      { freeBytes: 3.9 * GIB, availableBytes: 3.9 * GIB, usedBytes: 12.1 * GIB, usedPercent: 76 },
      "healthy",
    ));

    const labels = [...root.querySelectorAll(".memory-stat-label")].map((el) => el.textContent);
    expect(labels).toContain("available");
    expect(labels).not.toContain("free");
    expect(root.querySelector(".memory-pct-value")?.textContent).toBe("76");
  });

  it("renders an unknown reading as a dash, with no warning or critical state", async () => {
    await mount(body(
      { freeBytes: null, availableBytes: null, usedBytes: null, usedPercent: null },
      "unknown",
    ));

    expect(root.querySelector(".memory-pct-value")?.textContent).toBe("—");
    expect(root.querySelector(".memory-stat-value")?.textContent).toBe("—");
    expect(root.textContent).toContain("Memory reading unavailable");

    // Nothing anywhere in the panel may say warning or critical.
    expect(root.querySelector(".memory-pressure-warning")).toBeNull();
    expect(root.querySelector(".memory-pressure-critical")).toBeNull();
    expect(root.querySelector(".memory-panel-warning")).toBeNull();
    expect(root.querySelector(".memory-panel-critical")).toBeNull();
    expect(root.querySelector(".memory-bar-fill")?.getAttribute("style")).toContain("width: 0%");
  });

  it("still warns when the machine really is under pressure", async () => {
    await mount(body(
      { freeBytes: 1 * GIB, availableBytes: 1 * GIB, usedBytes: 15 * GIB, usedPercent: 94 },
      "critical",
    ));

    expect(root.querySelector(".memory-pressure-critical")).not.toBeNull();
    expect(root.textContent).toContain("System memory critically low");
  });
});
