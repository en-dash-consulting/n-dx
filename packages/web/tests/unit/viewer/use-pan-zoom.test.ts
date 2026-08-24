// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { usePanZoom, type ViewBox } from "../../../src/viewer/hooks/use-pan-zoom.js";

/**
 * usePanZoom's first tests.
 *
 * The hook converts screen pixels into user-space units by dividing by the
 * element's measured box, so a zero-sized box yields Infinity — or NaN where the
 * delta is also zero — and that value reaches the rendered viewBox. jsdom reports
 * 0x0 for every element, which is why the box has to be stubbed explicitly: without
 * a stub every test would take the degenerate path and the normal-path arithmetic
 * would never be exercised.
 *
 * The stub sizes are chosen so the arithmetic is derivable rather than
 * coincidental: a 400x300 box against a 400x300 viewBox makes the scale exactly 1,
 * so a 50px drag must move the viewBox by exactly 50 user units. A test that only
 * asserted "the number changed" would pass against a broken scale.
 */

const FIT: ViewBox = { x: 0, y: 0, w: 400, h: 300 };

/** Captured handles from the hook, refreshed on every render. */
let api: ReturnType<typeof usePanZoom>;

function Harness() {
  api = usePanZoom(FIT);
  const { viewBox, svgRef } = api;
  return h("svg", {
    ref: svgRef,
    // Rendered so assertions read what a browser would actually paint, rather
    // than trusting the hook's internal state.
    "data-viewbox": `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`,
  });
}

const roots: HTMLElement[] = [];

/**
 * Mount the harness with the SVG's measured box stubbed.
 *
 * Stubbing the prototype rather than the instance: Preact hands the ref an element
 * created during render, so there is no instance to patch beforehand.
 */
function mount(rect: { width: number; height: number; left?: number; top?: number }) {
  vi.spyOn(SVGElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: rect.width,
    height: rect.height,
    left: rect.left ?? 0,
    top: rect.top ?? 0,
    right: (rect.left ?? 0) + rect.width,
    bottom: (rect.top ?? 0) + rect.height,
    x: rect.left ?? 0,
    y: rect.top ?? 0,
    toJSON: () => ({}),
  } as DOMRect);

  const root = document.createElement("div");
  roots.push(root);
  act(() => {
    render(h(Harness, null), root);
  });
  return {
    root,
    viewBoxAttr: () => root.querySelector("svg")?.getAttribute("data-viewbox") ?? "",
  };
}

afterEach(() => {
  for (const root of roots) render(null, root);
  roots.length = 0;
  vi.restoreAllMocks();
});

/** A wheel event carrying only what the handler reads. */
function wheel(overrides: Partial<WheelEvent> = {}) {
  return {
    preventDefault: () => {},
    ctrlKey: false,
    deltaX: 0,
    deltaY: 0,
    clientX: 0,
    clientY: 0,
    ...overrides,
  } as unknown as WheelEvent;
}

function mouse(clientX: number, clientY: number) {
  return { clientX, clientY, button: 0, currentTarget: null } as unknown as MouseEvent;
}

describe("usePanZoom — normal geometry", () => {
  it("pans by exactly the scaled wheel delta", () => {
    // 400x300 box against a 400x300 viewBox → scale 1, so deltas map 1:1.
    const view = mount({ width: 400, height: 300 });

    act(() => {
      api.handleWheel(wheel({ deltaX: 30, deltaY: -20 }));
    });

    expect(view.viewBoxAttr()).toBe("30 -20 400 300");
  });

  it("halves the delta when the element is twice the viewBox", () => {
    // 800x600 box against a 400x300 viewBox → scale 0.5. Pinning a second ratio
    // proves the division is real rather than the identity case passing by luck.
    const view = mount({ width: 800, height: 600 });

    act(() => {
      api.handleWheel(wheel({ deltaX: 100, deltaY: 100 }));
    });

    expect(view.viewBoxAttr()).toBe("50 50 400 300");
  });

  it("pans by exactly the drag distance", () => {
    const view = mount({ width: 400, height: 300 });

    act(() => {
      api.startPan(mouse(100, 100));
    });
    act(() => {
      api.movePan(mouse(150, 130));
    });

    // Dragging right/down moves the viewBox left/up by the same amount at scale 1.
    expect(view.viewBoxAttr()).toBe("-50 -30 400 300");
  });

  it("zooms around the cursor without producing a non-finite box", () => {
    const view = mount({ width: 400, height: 300 });

    act(() => {
      api.handleWheel(wheel({ ctrlKey: true, deltaY: -2, clientX: 200, clientY: 150 }));
    });

    const numbers = view.viewBoxAttr().split(" ").map(Number);
    expect(numbers).toHaveLength(4);
    expect(numbers.every(Number.isFinite)).toBe(true);
    // Zooming in shrinks the viewBox.
    expect(numbers[2]!).toBeLessThan(400);
  });
});

describe("usePanZoom — zero-sized element", () => {
  it("leaves the viewBox untouched on a wheel pan", () => {
    const view = mount({ width: 0, height: 0 });
    const before = view.viewBoxAttr();

    act(() => {
      api.handleWheel(wheel({ deltaX: 30, deltaY: -20 }));
    });

    expect(view.viewBoxAttr()).toBe(before);
    expect(view.viewBoxAttr()).not.toContain("Infinity");
    expect(view.viewBoxAttr()).not.toContain("NaN");
  });

  it("leaves the viewBox untouched on a vertical-only scroll — the NaN case", () => {
    // The nastiest value, and the likeliest: an ordinary vertical scroll has
    // deltaX 0, and 0 * Infinity is NaN, so x becomes NaN while y becomes
    // Infinity. NaN is worse than Infinity because it compares unequal to
    // everything, so downstream guards written as range checks would not catch it.
    const view = mount({ width: 0, height: 0 });
    const before = view.viewBoxAttr();

    act(() => {
      api.handleWheel(wheel({ deltaX: 0, deltaY: -120 }));
    });

    expect(view.viewBoxAttr()).toBe(before);
    expect(view.viewBoxAttr()).not.toContain("NaN");
  });

  it("leaves the viewBox untouched on a wheel zoom", () => {
    // The zoom branch divides by the box too, for the cursor focal point — a detail
    // the original report missed, since it listed only the pan divisions.
    const view = mount({ width: 0, height: 0 });
    const before = view.viewBoxAttr();

    act(() => {
      api.handleWheel(wheel({ ctrlKey: true, deltaY: -2, clientX: 10, clientY: 10 }));
    });

    expect(view.viewBoxAttr()).toBe(before);
    expect(view.viewBoxAttr()).not.toContain("NaN");
  });

  it("leaves the viewBox untouched mid-drag", () => {
    const view = mount({ width: 0, height: 0 });
    const before = view.viewBoxAttr();

    act(() => {
      api.startPan(mouse(100, 100));
    });
    act(() => {
      api.movePan(mouse(150, 130));
    });

    expect(view.viewBoxAttr()).toBe(before);
    expect(view.viewBoxAttr()).not.toContain("NaN");
  });

  it("recovers once the element is sized again", () => {
    // The point of returning rather than clamping: nothing is stored while the
    // geometry is unusable, so a later event behaves normally. Had a non-finite
    // value been written, the state would stay poisoned after layout settled.
    const view = mount({ width: 0, height: 0 });

    act(() => {
      api.handleWheel(wheel({ deltaX: 30, deltaY: -20 }));
    });
    expect(view.viewBoxAttr()).toBe("0 0 400 300");

    vi.spyOn(SVGElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 400,
      height: 300,
      left: 0,
      top: 0,
      right: 400,
      bottom: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    act(() => {
      api.handleWheel(wheel({ deltaX: 30, deltaY: -20 }));
    });
    expect(view.viewBoxAttr()).toBe("30 -20 400 300");
  });
});
