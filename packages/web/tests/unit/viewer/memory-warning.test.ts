// @vitest-environment jsdom
/**
 * Tests for the MemoryWarningBanner component.
 *
 * Covers: rendering at different levels, dismiss behavior,
 * accessibility attributes, and content display.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { MemoryWarningBanner } from "../../../src/viewer/components/memory-warning.js";
import type { MemorySnapshot, MemoryLevel } from "../../../src/viewer/performance/memory-monitor.js";

function makeSnapshot(overrides: Partial<MemorySnapshot> = {}): MemorySnapshot {
  return {
    usedJSHeapSize: 700 * 1024 * 1024,       // 700 MB
    totalJSHeapSize: 900 * 1024 * 1024,
    jsHeapSizeLimit: 1024 * 1024 * 1024,      // 1 GB
    usageRatio: 0.7,
    level: "warning",
    timestamp: new Date().toISOString(),
    precise: true,
    ...overrides,
  };
}

describe("MemoryWarningBanner", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    render(null, root);
    if (root.parentNode) root.parentNode.removeChild(root);
  });

  it("renders nothing when visible is false", () => {
    render(
      h(MemoryWarningBanner, {
        snapshot: makeSnapshot(),
        level: "warning",
        visible: false,
        onDismiss: vi.fn(),
      }),
      root,
    );
    expect(root.children.length).toBe(0);
  });

  it("renders nothing when level is normal", () => {
    render(
      h(MemoryWarningBanner, {
        snapshot: makeSnapshot({ level: "normal" }),
        level: "normal",
        visible: true,
        onDismiss: vi.fn(),
      }),
      root,
    );
    expect(root.children.length).toBe(0);
  });

  it("renders nothing when level is elevated", () => {
    render(
      h(MemoryWarningBanner, {
        snapshot: makeSnapshot({ level: "elevated" }),
        level: "elevated",
        visible: true,
        onDismiss: vi.fn(),
      }),
      root,
    );
    expect(root.children.length).toBe(0);
  });

  it("renders warning banner at warning level", () => {
    render(
      h(MemoryWarningBanner, {
        snapshot: makeSnapshot(),
        level: "warning",
        visible: true,
        onDismiss: vi.fn(),
      }),
      root,
    );
    const banner = root.querySelector(".memory-warning-banner");
    expect(banner).not.toBeNull();
    expect(banner!.classList.contains("memory-warning-level-warning")).toBe(true);
    expect(root.textContent).toContain("High memory usage");
  });

  it("renders critical banner at critical level", () => {
    render(
      h(MemoryWarningBanner, {
        snapshot: makeSnapshot({ level: "critical", usageRatio: 0.92 }),
        level: "critical",
        visible: true,
        onDismiss: vi.fn(),
      }),
      root,
    );
    const banner = root.querySelector(".memory-warning-banner");
    expect(banner).not.toBeNull();
    expect(banner!.classList.contains("memory-warning-level-critical")).toBe(true);
    expect(root.textContent).toContain("Critical memory usage");
  });

  it("displays memory usage details", () => {
    render(
      h(MemoryWarningBanner, {
        snapshot: makeSnapshot({
          usedJSHeapSize: 700 * 1024 * 1024,
          jsHeapSizeLimit: 1024 * 1024 * 1024,
          usageRatio: 0.7,
        }),
        level: "warning",
        visible: true,
        onDismiss: vi.fn(),
      }),
      root,
    );
    expect(root.textContent).toContain("70.0%");
    expect(root.textContent).toContain("700.0 MB");
    expect(root.textContent).toContain("1.00 GB");
  });

  it("displays advice text", () => {
    render(
      h(MemoryWarningBanner, {
        snapshot: makeSnapshot(),
        level: "warning",
        visible: true,
        onDismiss: vi.fn(),
      }),
      root,
    );
    expect(root.textContent).toContain("Consider closing the graph view");
  });

  it("displays critical advice text at critical level", () => {
    render(
      h(MemoryWarningBanner, {
        snapshot: makeSnapshot({ level: "critical" }),
        level: "critical",
        visible: true,
        onDismiss: vi.fn(),
      }),
      root,
    );
    expect(root.textContent).toContain("Memory is nearly exhausted");
  });

  it("calls onDismiss when dismiss button is clicked", () => {
    const onDismiss = vi.fn();
    render(
      h(MemoryWarningBanner, {
        snapshot: makeSnapshot(),
        level: "warning",
        visible: true,
        onDismiss,
      }),
      root,
    );
    const btn = root.querySelector<HTMLButtonElement>(".memory-warning-dismiss");
    expect(btn).not.toBeNull();
    btn!.click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("has role=alert for accessibility", () => {
    render(
      h(MemoryWarningBanner, {
        snapshot: makeSnapshot(),
        level: "warning",
        visible: true,
        onDismiss: vi.fn(),
      }),
      root,
    );
    const banner = root.querySelector(".memory-warning-banner");
    expect(banner!.getAttribute("role")).toBe("alert");
    expect(banner!.getAttribute("aria-live")).toBe("assertive");
  });

  it("dismiss button has accessible label", () => {
    render(
      h(MemoryWarningBanner, {
        snapshot: makeSnapshot(),
        level: "warning",
        visible: true,
        onDismiss: vi.fn(),
      }),
      root,
    );
    const btn = root.querySelector<HTMLButtonElement>(".memory-warning-dismiss");
    expect(btn!.getAttribute("aria-label")).toBe("Dismiss memory warning");
  });

  it("handles null snapshot gracefully", () => {
    render(
      h(MemoryWarningBanner, {
        snapshot: null,
        level: "warning",
        visible: true,
        onDismiss: vi.fn(),
      }),
      root,
    );
    const banner = root.querySelector(".memory-warning-banner");
    expect(banner).not.toBeNull();
    expect(root.textContent).toContain("N/A");
  });
});
