import { describe, it, expect } from "vitest";

/**
 * Tests for zoom/pan math used by GraphRenderer.
 *
 * The renderer stores viewport state as (viewX, viewY, viewW, viewH) and
 * derives scale = viewW / containerWidth. These tests verify the math in
 * isolation without requiring SVG DOM.
 *
 * Source implementation: src/viewer/graph/renderer.ts
 * These functions are duplicated here because the renderer does not export
 * its internal algorithms. If the renderer is refactored to extract pure
 * logic modules, these tests should import from those modules directly.
 */

// ── Viewport state type (mirrors renderer internals) ─────────────────────────

interface ViewportState {
  viewX: number;
  viewY: number;
  viewW: number;
  viewH: number;
  containerWidth: number;
}

/** Compute scale from viewport state. */
function getScale(v: ViewportState): number {
  return v.viewW / v.containerWidth;
}

// ── Zoom math (matches GraphRenderer.applyZoomFromCenter) ────────────────────

/** Apply a zoom factor from the viewport center. factor > 1 = zoom out. */
function applyZoomFromCenter(v: ViewportState, factor: number): ViewportState {
  const cx = v.viewX + v.viewW / 2;
  const cy = v.viewY + v.viewH / 2;
  const newW = v.viewW * factor;
  const newH = v.viewH * factor;
  return {
    viewX: cx - newW / 2,
    viewY: cy - newH / 2,
    viewW: newW,
    viewH: newH,
    containerWidth: v.containerWidth,
  };
}

/** Apply a zoom factor centered on a point in viewBox coords. */
function applyZoomAtPoint(
  v: ViewportState,
  factor: number,
  px: number,
  py: number,
): ViewportState {
  const newW = v.viewW * factor;
  const newH = v.viewH * factor;
  return {
    viewX: px - (px - v.viewX) * (newW / v.viewW),
    viewY: py - (py - v.viewY) * (newH / v.viewH),
    viewW: newW,
    viewH: newH,
    containerWidth: v.containerWidth,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("zoom from center", () => {
  const base: ViewportState = {
    viewX: 0, viewY: 0, viewW: 800, viewH: 600,
    containerWidth: 800,
  };

  it("zoom in reduces viewW/viewH (shows smaller area)", () => {
    const factor = 1 / 1.25; // zoomIn uses 1/factor
    const zoomed = applyZoomFromCenter(base, factor);
    expect(zoomed.viewW).toBeLessThan(base.viewW);
    expect(zoomed.viewH).toBeLessThan(base.viewH);
  });

  it("zoom out increases viewW/viewH (shows larger area)", () => {
    const factor = 1.25;
    const zoomed = applyZoomFromCenter(base, factor);
    expect(zoomed.viewW).toBeGreaterThan(base.viewW);
    expect(zoomed.viewH).toBeGreaterThan(base.viewH);
  });

  it("preserves viewport center", () => {
    const shifted: ViewportState = { ...base, viewX: 100, viewY: 50 };
    const cx = shifted.viewX + shifted.viewW / 2;
    const cy = shifted.viewY + shifted.viewH / 2;

    const zoomed = applyZoomFromCenter(shifted, 0.5);
    const newCx = zoomed.viewX + zoomed.viewW / 2;
    const newCy = zoomed.viewY + zoomed.viewH / 2;

    expect(newCx).toBeCloseTo(cx, 10);
    expect(newCy).toBeCloseTo(cy, 10);
  });

  it("zoom in then out returns to original viewport", () => {
    const factor = 1.25;
    const zoomedIn = applyZoomFromCenter(base, 1 / factor);
    const restored = applyZoomFromCenter(zoomedIn, factor);

    expect(restored.viewW).toBeCloseTo(base.viewW, 10);
    expect(restored.viewH).toBeCloseTo(base.viewH, 10);
    expect(restored.viewX).toBeCloseTo(base.viewX, 10);
    expect(restored.viewY).toBeCloseTo(base.viewY, 10);
  });

  it("scale decreases when zooming in", () => {
    const zoomed = applyZoomFromCenter(base, 1 / 1.25);
    expect(getScale(zoomed)).toBeLessThan(getScale(base));
  });

  it("scale increases when zooming out", () => {
    const zoomed = applyZoomFromCenter(base, 1.25);
    expect(getScale(zoomed)).toBeGreaterThan(getScale(base));
  });
});

describe("zoom at point (wheel zoom)", () => {
  const base: ViewportState = {
    viewX: 0, viewY: 0, viewW: 800, viewH: 600,
    containerWidth: 800,
  };

  it("preserves the point under the cursor", () => {
    const px = 200, py = 150;
    const factor = 0.9; // zoom in

    const zoomed = applyZoomAtPoint(base, factor, px, py);

    // The point (px, py) should be at the same relative position in the viewport
    // relativeX = (px - viewX) / viewW
    const relBefore = (px - base.viewX) / base.viewW;
    const relAfter = (px - zoomed.viewX) / zoomed.viewW;
    expect(relAfter).toBeCloseTo(relBefore, 10);
  });

  it("zooming at center is equivalent to applyZoomFromCenter", () => {
    const cx = base.viewX + base.viewW / 2;
    const cy = base.viewY + base.viewH / 2;
    const factor = 0.8;

    const fromCenter = applyZoomFromCenter(base, factor);
    const atPoint = applyZoomAtPoint(base, factor, cx, cy);

    expect(atPoint.viewX).toBeCloseTo(fromCenter.viewX, 10);
    expect(atPoint.viewY).toBeCloseTo(fromCenter.viewY, 10);
    expect(atPoint.viewW).toBeCloseTo(fromCenter.viewW, 10);
    expect(atPoint.viewH).toBeCloseTo(fromCenter.viewH, 10);
  });

  it("zooming at corner shifts viewport toward corner", () => {
    // Zoom in at top-left corner: viewport should shift so top-left stays anchored
    const factor = 0.5; // zoom in (halve viewport)
    const zoomed = applyZoomAtPoint(base, factor, 0, 0);

    // Top-left should stay at (0, 0) since that's our anchor point
    expect(zoomed.viewX).toBeCloseTo(0, 10);
    expect(zoomed.viewY).toBeCloseTo(0, 10);
    expect(zoomed.viewW).toBe(400);
    expect(zoomed.viewH).toBe(300);
  });
});

describe("pan math", () => {
  it("updates viewX/viewY based on drag delta", () => {
    // Pan simulation: drag right by 100px in a 800px container showing 800 viewBox units
    const viewW = 800, viewH = 600;
    const containerWidth = 800, containerHeight = 600;
    const startVX = 0, startVY = 0;
    const dx = 100, dy = -50; // drag right and up

    const newViewX = startVX - (dx / containerWidth) * viewW;
    const newViewY = startVY - (dy / containerHeight) * viewH;

    // Dragging right should move viewport left (content moves right)
    expect(newViewX).toBe(-100);
    // Dragging up should move viewport down (content moves up)
    expect(newViewY).toBe(50);
  });

  it("pan scale is proportional to zoom level", () => {
    // When zoomed in (smaller viewW), same pixel drag = smaller viewBox movement
    const containerWidth = 800;
    const dx = 100;

    const viewW_normal = 800;
    const viewW_zoomed = 400; // 2x zoomed in

    const panNormal = (dx / containerWidth) * viewW_normal;
    const panZoomed = (dx / containerWidth) * viewW_zoomed;

    expect(panZoomed).toBe(panNormal / 2);
  });
});

describe("LOD zoom thresholds", () => {
  it("font size scales inversely with sqrt of scale", () => {
    // Matches: Math.max(7, Math.min(11, 9 / Math.sqrt(scale)))
    const computeFontSize = (scale: number) =>
      Math.max(7, Math.min(11, 9 / Math.sqrt(scale)));

    // At scale 1 (default): 9px
    expect(computeFontSize(1)).toBe(9);

    // Zoomed in (scale < 1): larger font (capped at 11)
    expect(computeFontSize(0.25)).toBe(11); // 9 / 0.5 = 18, capped at 11

    // Zoomed out (scale > 1): smaller font (capped at 7)
    expect(computeFontSize(4)).toBe(7); // 9 / 2 = 4.5, capped at 7
  });

  it("labels hidden when visual radius is too small", () => {
    const nodeRadius = 5;
    // visualRadius = nodeRadius / scale
    // Labels shown when visualRadius >= 3

    // At scale 1: visual = 5, visible
    expect(nodeRadius / 1).toBeGreaterThanOrEqual(3);

    // At scale 2 (zoomed out): visual = 2.5, hidden
    expect(nodeRadius / 2).toBeLessThan(3);

    // At scale 0.5 (zoomed in): visual = 10, visible
    expect(nodeRadius / 0.5).toBeGreaterThanOrEqual(3);
  });

  it("zone label font size scales with zoom level", () => {
    // Matches: Math.max(10, Math.min(14, 12 / Math.sqrt(scale)))
    const computeZoneFontSize = (scale: number) =>
      Math.max(10, Math.min(14, 12 / Math.sqrt(scale)));

    // At scale 1 (default): 12px
    expect(computeZoneFontSize(1)).toBe(12);

    // Zoomed in (scale < 1): larger font (capped at 14)
    expect(computeZoneFontSize(0.25)).toBe(14); // 12 / 0.5 = 24, capped at 14

    // Zoomed out (scale > 1): smaller font (capped at 10)
    expect(computeZoneFontSize(4)).toBe(10); // 12 / 2 = 6, capped at 10
  });
});

describe("zone label overlap reservation", () => {
  /** AABB overlap test — same algorithm as in renderer. */
  function rectsOverlap(
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number },
  ): boolean {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  it("file label overlapping a zone label region is rejected", () => {
    // Zone label at (100, 50), pill 80x20
    const zoneRect = { x: 60, y: 40, w: 80, h: 20 };
    // File label trying to place at overlapping position
    const fileRect = { x: 70, y: 42, w: 60, h: 12 };
    expect(rectsOverlap(zoneRect, fileRect)).toBe(true);
  });

  it("file label that does not overlap zone label is accepted", () => {
    const zoneRect = { x: 60, y: 40, w: 80, h: 20 };
    const fileRect = { x: 200, y: 42, w: 60, h: 12 };
    expect(rectsOverlap(zoneRect, fileRect)).toBe(false);
  });

  it("greedy placement with zone reservation seeds zone rects first", () => {
    // Simulate the renderer's greedy algorithm:
    // 1. Pre-seed zone label rects
    // 2. Try to place file labels in importance order
    const placed: { x: number; y: number; w: number; h: number }[] = [];

    // Zone label occupies center area
    placed.push({ x: 90, y: 45, w: 80, h: 20 });

    // File label A: overlaps zone → rejected
    const fileA = { x: 95, y: 50, w: 50, h: 12 };
    const aOverlaps = placed.some(p => rectsOverlap(fileA, p));
    expect(aOverlaps).toBe(true);

    // File label B: far away → accepted
    const fileB = { x: 300, y: 50, w: 50, h: 12 };
    const bOverlaps = placed.some(p => rectsOverlap(fileB, p));
    expect(bOverlaps).toBe(false);
    if (!bOverlaps) placed.push(fileB);

    // File label C: overlaps file B → rejected
    const fileC = { x: 310, y: 52, w: 50, h: 12 };
    const cOverlaps = placed.some(p => rectsOverlap(fileC, p));
    expect(cOverlaps).toBe(true);

    // Only zone rect + file B placed (2 total)
    expect(placed).toHaveLength(2);
  });
});
