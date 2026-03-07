import { describe, it, expect } from "vitest";
import {
  updateEmptyTurnCount,
  isSpinningRun,
  DEFAULT_SPIN_THRESHOLD,
} from "../../../src/agent/analysis/spin.js";

describe("spin detection", () => {
  describe("DEFAULT_SPIN_THRESHOLD", () => {
    it("is a reasonable value (3-10 range)", () => {
      expect(DEFAULT_SPIN_THRESHOLD).toBeGreaterThanOrEqual(3);
      expect(DEFAULT_SPIN_THRESHOLD).toBeLessThanOrEqual(10);
    });
  });

  describe("updateEmptyTurnCount", () => {
    it("increments when no tool calls were made", () => {
      expect(updateEmptyTurnCount(0, false)).toBe(1);
      expect(updateEmptyTurnCount(3, false)).toBe(4);
    });

    it("resets to 0 when tool calls were made", () => {
      expect(updateEmptyTurnCount(0, true)).toBe(0);
      expect(updateEmptyTurnCount(5, true)).toBe(0);
    });

    it("tracks consecutive empty turns correctly", () => {
      let count = 0;
      count = updateEmptyTurnCount(count, false); // 1
      count = updateEmptyTurnCount(count, false); // 2
      count = updateEmptyTurnCount(count, true);  // 0 (reset)
      count = updateEmptyTurnCount(count, false); // 1
      expect(count).toBe(1);
    });
  });

  describe("isSpinningRun", () => {
    it("detects spin when turns >= threshold and zero tool calls", () => {
      expect(isSpinningRun(DEFAULT_SPIN_THRESHOLD, 0)).toBe(true);
      expect(isSpinningRun(DEFAULT_SPIN_THRESHOLD + 10, 0)).toBe(true);
    });

    it("does not flag runs with tool calls", () => {
      expect(isSpinningRun(DEFAULT_SPIN_THRESHOLD, 1)).toBe(false);
      expect(isSpinningRun(100, 5)).toBe(false);
    });

    it("does not flag short runs even with zero tool calls", () => {
      expect(isSpinningRun(1, 0)).toBe(false);
      expect(isSpinningRun(DEFAULT_SPIN_THRESHOLD - 1, 0)).toBe(false);
    });

    it("respects custom threshold", () => {
      expect(isSpinningRun(3, 0, 3)).toBe(true);
      expect(isSpinningRun(2, 0, 3)).toBe(false);
    });
  });
});
