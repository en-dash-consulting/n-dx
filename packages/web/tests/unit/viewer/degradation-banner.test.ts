// @vitest-environment jsdom
/**
 * Tests for the DegradationBanner component.
 *
 * Covers: rendering at different tiers, dismiss behavior,
 * accessibility attributes, feature list display, and visibility logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { DegradationBanner } from "../../../src/viewer/components/degradation-banner.js";
import type { DegradableFeature } from "../../../src/viewer/performance/graceful-degradation.js";
import type { MemoryLevel } from "../../../src/viewer/performance/memory-monitor.js";

function makeProps(overrides: Partial<Parameters<typeof DegradationBanner>[0]> = {}) {
  return {
    tier: "elevated" as MemoryLevel,
    isDegraded: true,
    summary: "Memory usage is elevated. Auto-refresh and background data loading have been paused.",
    disabledFeatures: new Set<DegradableFeature>(["autoRefresh", "deferredLoading"]),
    visible: true,
    onDismiss: vi.fn(),
    ...overrides,
  };
}

describe("DegradationBanner", () => {
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
    render(h(DegradationBanner, makeProps({ visible: false })), root);
    expect(root.children.length).toBe(0);
  });

  it("renders nothing when not degraded", () => {
    render(
      h(DegradationBanner, makeProps({ isDegraded: false, tier: "normal" })),
      root,
    );
    expect(root.children.length).toBe(0);
  });

  it("renders nothing when tier is normal", () => {
    render(
      h(DegradationBanner, makeProps({ tier: "normal", isDegraded: false })),
      root,
    );
    expect(root.children.length).toBe(0);
  });

  it("renders elevated banner with correct class", () => {
    render(h(DegradationBanner, makeProps()), root);
    const banner = root.querySelector(".degradation-banner");
    expect(banner).not.toBeNull();
    expect(banner!.classList.contains("degradation-elevated")).toBe(true);
  });

  it("renders warning banner with correct class", () => {
    render(
      h(DegradationBanner, makeProps({
        tier: "warning",
        summary: "High memory usage detected.",
        disabledFeatures: new Set<DegradableFeature>(["autoRefresh", "deferredLoading", "graphRendering", "animations"]),
      })),
      root,
    );
    const banner = root.querySelector(".degradation-banner");
    expect(banner).not.toBeNull();
    expect(banner!.classList.contains("degradation-warning")).toBe(true);
  });

  it("renders critical banner with correct class", () => {
    render(
      h(DegradationBanner, makeProps({
        tier: "critical",
        summary: "Critical memory pressure.",
        disabledFeatures: new Set<DegradableFeature>(["autoRefresh", "deferredLoading", "graphRendering", "animations", "detailPanel"]),
      })),
      root,
    );
    const banner = root.querySelector(".degradation-banner");
    expect(banner).not.toBeNull();
    expect(banner!.classList.contains("degradation-critical")).toBe(true);
  });

  it("displays the summary message", () => {
    render(h(DegradationBanner, makeProps()), root);
    expect(root.textContent).toContain("Auto-refresh and background data loading");
  });

  it("displays the disabled features list", () => {
    render(h(DegradationBanner, makeProps()), root);
    expect(root.textContent).toContain("Auto-refresh");
    expect(root.textContent).toContain("Background loading");
  });

  it("displays 'Reduced functionality' heading", () => {
    render(h(DegradationBanner, makeProps()), root);
    expect(root.textContent).toContain("Reduced functionality");
  });

  it("calls onDismiss when dismiss button is clicked", () => {
    const onDismiss = vi.fn();
    render(h(DegradationBanner, makeProps({ onDismiss })), root);
    const btn = root.querySelector<HTMLButtonElement>(".degradation-dismiss");
    expect(btn).not.toBeNull();
    btn!.click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("has role=status for accessibility", () => {
    render(h(DegradationBanner, makeProps()), root);
    const banner = root.querySelector(".degradation-banner");
    expect(banner!.getAttribute("role")).toBe("status");
    expect(banner!.getAttribute("aria-live")).toBe("polite");
  });

  it("dismiss button has accessible label", () => {
    render(h(DegradationBanner, makeProps()), root);
    const btn = root.querySelector<HTMLButtonElement>(".degradation-dismiss");
    expect(btn!.getAttribute("aria-label")).toBe("Dismiss degradation notice");
  });

  it("shows all five features at critical tier", () => {
    render(
      h(DegradationBanner, makeProps({
        tier: "critical",
        disabledFeatures: new Set<DegradableFeature>([
          "autoRefresh", "deferredLoading", "graphRendering", "animations", "detailPanel",
        ]),
      })),
      root,
    );
    expect(root.textContent).toContain("Auto-refresh");
    expect(root.textContent).toContain("Background loading");
    expect(root.textContent).toContain("Graph view");
    expect(root.textContent).toContain("Animations");
    expect(root.textContent).toContain("Detail panel");
  });
});
