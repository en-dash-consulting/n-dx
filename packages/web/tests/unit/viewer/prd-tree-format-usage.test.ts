/**
 * Tests for PRD tree usage/duration formatters.
 *
 * The tree view relies on these pure functions to render the new
 * tokens + duration columns. The brief specifies explicit shapes
 * (`1.2s`, `4m 10s`, `2h 15m`, thousands-separated tokens, `—` for
 * empty) — these tests pin those shapes so regressions surface as
 * assertion failures rather than UI drift.
 */
import { describe, it, expect } from "vitest";
import {
  formatTokensExact,
  formatDuration,
  EMPTY_DASH,
} from "../../../src/viewer/components/prd-tree/format-usage.js";

describe("formatTokensExact", () => {
  it("renders zero as the plain integer", () => {
    expect(formatTokensExact(0)).toBe("0");
  });

  it("adds thousands separators", () => {
    expect(formatTokensExact(1234)).toBe("1,234");
    expect(formatTokensExact(14321)).toBe("14,321");
    expect(formatTokensExact(1_234_567)).toBe("1,234,567");
  });

  it("rounds fractional counts to nearest integer", () => {
    expect(formatTokensExact(999.6)).toBe("1,000");
    expect(formatTokensExact(1234.4)).toBe("1,234");
  });

  it("renders null/undefined as dash", () => {
    expect(formatTokensExact(null)).toBe(EMPTY_DASH);
    expect(formatTokensExact(undefined)).toBe(EMPTY_DASH);
  });

  it("renders non-finite and negative as dash", () => {
    expect(formatTokensExact(Number.NaN)).toBe(EMPTY_DASH);
    expect(formatTokensExact(Number.POSITIVE_INFINITY)).toBe(EMPTY_DASH);
    expect(formatTokensExact(-1)).toBe(EMPTY_DASH);
  });
});

describe("formatDuration", () => {
  it("renders sub-second as dash (too short to be meaningful)", () => {
    expect(formatDuration(0)).toBe(EMPTY_DASH);
    expect(formatDuration(500)).toBe(EMPTY_DASH);
    expect(formatDuration(999)).toBe(EMPTY_DASH);
  });

  it("renders sub-minute with one decimal, dropping trailing .0", () => {
    expect(formatDuration(1000)).toBe("1s");
    expect(formatDuration(1200)).toBe("1.2s");
    expect(formatDuration(5400)).toBe("5.4s");
    expect(formatDuration(59_900)).toBe("59.9s");
  });

  it("renders sub-hour as `Mm Ss`", () => {
    expect(formatDuration(60_000)).toBe("1m 0s");
    expect(formatDuration(250_000)).toBe("4m 10s"); // brief's example
    expect(formatDuration(3_599_000)).toBe("59m 59s");
  });

  it("renders >= 1h as `Hh Mm`", () => {
    expect(formatDuration(3_600_000)).toBe("1h 0m");
    expect(formatDuration(8_100_000)).toBe("2h 15m"); // brief's example
    expect(formatDuration(90_061_000)).toBe("25h 1m");
  });

  it("renders null/undefined/invalid as dash", () => {
    expect(formatDuration(null)).toBe(EMPTY_DASH);
    expect(formatDuration(undefined)).toBe(EMPTY_DASH);
    expect(formatDuration(Number.NaN)).toBe(EMPTY_DASH);
    expect(formatDuration(-1)).toBe(EMPTY_DASH);
  });
});
