/**
 * Tests for the triple-click gesture detector.
 *
 * Uses vi.spyOn(Date, "now") for deterministic timing and
 * vi.spyOn(Math, "random") to verify both branches of the probability gate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createTripleClickDetector,
  TRIPLE_CLICK_PROBABILITY,
} from "../../../src/viewer/components/triple-click-detector.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Advance the Date.now stub by the given sequence of absolute timestamps. */
function stubTimes(...times: number[]) {
  const spy = vi.spyOn(Date, "now");
  for (const t of times) spy.mockReturnValueOnce(t);
  return spy;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("createTripleClickDetector", () => {
  let onTrigger: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onTrigger = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Exported constants ────────────────────────────────────────────────────

  it("exports TRIPLE_CLICK_PROBABILITY ≈ 0.271828", () => {
    expect(TRIPLE_CLICK_PROBABILITY).toBeCloseTo(0.271828, 6);
  });

  // ── Probability gate: pass branch ─────────────────────────────────────────

  it("fires onTrigger on three rapid clicks when Math.random passes gate", () => {
    stubTimes(0, 400, 800);
    vi.spyOn(Math, "random").mockReturnValue(0.2); // < 0.271828

    const handler = createTripleClickDetector({ onTrigger });
    handler();
    handler();
    handler();

    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  // ── Probability gate: reject branch ──────────────────────────────────────

  it("does NOT fire onTrigger when Math.random fails the gate", () => {
    stubTimes(0, 400, 800);
    vi.spyOn(Math, "random").mockReturnValue(0.5); // ≥ 0.271828

    const handler = createTripleClickDetector({ onTrigger });
    handler();
    handler();
    handler();

    expect(onTrigger).not.toHaveBeenCalled();
  });

  // ── Double-click: no trigger ──────────────────────────────────────────────

  it("does not fire on only two clicks", () => {
    stubTimes(0, 400);
    vi.spyOn(Math, "random").mockReturnValue(0.1);

    const handler = createTripleClickDetector({ onTrigger });
    handler();
    handler();

    expect(onTrigger).not.toHaveBeenCalled();
  });

  // ── Gap too long: counter resets ──────────────────────────────────────────

  it("does not fire when a gap between consecutive clicks exceeds 1.5 s", () => {
    // Click at 0 and 500, then third click arrives 2000 ms after the second.
    // Gap 500→2500 is 2000 ms > 1500 ms, so counter resets to 1 on click 3.
    stubTimes(0, 500, 2500);
    vi.spyOn(Math, "random").mockReturnValue(0.1);

    const handler = createTripleClickDetector({ onTrigger });
    handler(); // click 1
    handler(); // click 2
    handler(); // gap too large → reset to [2500], count = 1

    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("resets counter to 1 on a click that arrives after the window", () => {
    // After a reset the new click is click #1; two more rapid clicks are
    // still needed to reach the required count.
    stubTimes(0, 500, 3000, 3400, 3800);
    vi.spyOn(Math, "random").mockReturnValue(0.1);

    const handler = createTripleClickDetector({ onTrigger });
    handler(); // t=0    → count 1
    handler(); // t=500  → count 2
    handler(); // t=3000 → gap 2500ms > 1500ms → reset, count 1
    handler(); // t=3400 → count 2
    handler(); // t=3800 → count 3 → trigger

    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  // ── Counter resets after trigger ──────────────────────────────────────────

  it("resets after triggering so the next sequence starts fresh", () => {
    // Six quick clicks: first triple triggers (or not), second triple also
    // independently fires the gate. Math.random returns 0.1 each time.
    stubTimes(0, 100, 200, 300, 400, 500);
    vi.spyOn(Math, "random").mockReturnValue(0.1);

    const handler = createTripleClickDetector({ onTrigger });
    for (let i = 0; i < 6; i++) handler();

    // Two independent triples → two trigger calls.
    expect(onTrigger).toHaveBeenCalledTimes(2);
  });

  it("resets after reaching requiredClicks even when gate is rejected", () => {
    // First triple: gate rejected. Second triple: gate passes.
    stubTimes(0, 100, 200, 300, 400, 500);
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0.9) // first triple — rejected
      .mockReturnValueOnce(0.1); // second triple — passes

    const handler = createTripleClickDetector({ onTrigger });
    for (let i = 0; i < 6; i++) handler();

    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  // ── Custom options ─────────────────────────────────────────────────────────

  it("respects a custom windowMs option", () => {
    // Custom window of 200 ms. Gap of 300 ms should reset.
    stubTimes(0, 100, 400);
    vi.spyOn(Math, "random").mockReturnValue(0.1);

    const handler = createTripleClickDetector({ onTrigger, windowMs: 200 });
    handler(); // count 1
    handler(); // count 2
    handler(); // gap 300 ms > 200 ms → reset, count 1

    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("respects a custom probability option", () => {
    stubTimes(0, 100, 200);
    // Gate set to exactly 0 — should never pass.
    vi.spyOn(Math, "random").mockReturnValue(0.0);

    const handler = createTripleClickDetector({ onTrigger, probability: 0 });
    handler();
    handler();
    handler();

    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("respects a custom requiredClicks option", () => {
    stubTimes(0, 100);
    vi.spyOn(Math, "random").mockReturnValue(0.1);

    const handler = createTripleClickDetector({ onTrigger, requiredClicks: 2 });
    handler(); // count 1
    handler(); // count 2 → trigger

    expect(onTrigger).toHaveBeenCalledTimes(1);
  });
});
