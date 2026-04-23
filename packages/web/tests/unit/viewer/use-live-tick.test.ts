// @vitest-environment jsdom
/**
 * Tests for the PRD tree's live-duration tick hook.
 *
 * The hook must:
 *   1. Return the wall-clock value in millis.
 *   2. Re-render at least once per second when `active` is true (so the
 *      brief's "update at least once per second" requirement is met).
 *   3. Schedule no timers at all when `active` is false (idle trees
 *      must pay zero cost).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { useLiveTick } from "../../../src/viewer/components/prd-tree/use-live-tick.js";

function Harness({ active, onTick }: { active: boolean; onTick: (t: number) => void }) {
  const t = useLiveTick(active);
  onTick(t);
  return h("div", null, String(t));
}

describe("useLiveTick", () => {
  let setIntervalSpy: ReturnType<typeof vi.spyOn>;
  let clearIntervalSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
  });

  afterEach(() => {
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    vi.useRealTimers();
  });

  it("returns a wall-clock millis value", () => {
    const ticks: number[] = [];
    const root = document.createElement("div");
    act(() => {
      render(h(Harness, { active: false, onTick: (t) => ticks.push(t) }), root);
    });
    expect(ticks.length).toBeGreaterThan(0);
    expect(typeof ticks[0]).toBe("number");
    expect(ticks[0]).toBeGreaterThan(0);
  });

  it("does not schedule any interval when inactive", () => {
    const root = document.createElement("div");
    act(() => {
      render(h(Harness, { active: false, onTick: () => {} }), root);
    });
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it("advances the tick value while active", () => {
    const ticks: number[] = [];
    const root = document.createElement("div");
    act(() => {
      render(h(Harness, { active: true, onTick: (t) => ticks.push(t) }), root);
    });
    const baselineTick = ticks[ticks.length - 1]!;

    // Advance fake time three seconds. Preact may batch multiple
    // setInterval callbacks into a single re-render, so we can't
    // assert a strict tick-count — we assert the wall-clock value the
    // consumer reads has moved by at least 3s.
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    const latestTick = ticks[ticks.length - 1]!;
    expect(latestTick - baselineTick).toBeGreaterThanOrEqual(3000);
  });

  it("clears its interval when active flips back to false", () => {
    const root = document.createElement("div");
    act(() => {
      render(h(Harness, { active: true, onTick: () => {} }), root);
    });
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    act(() => {
      render(h(Harness, { active: false, onTick: () => {} }), root);
    });
    expect(clearIntervalSpy).toHaveBeenCalled();
  });
});
