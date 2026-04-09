// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { formatMs, parseMs, validateTimeoutInput } from "../../../src/viewer/views/cli-timeout.js";

describe("formatMs", () => {
  it("formats 0 as 'no timeout'", () => {
    expect(formatMs(0)).toBe("no timeout");
  });

  it("formats sub-minute values in seconds", () => {
    expect(formatMs(5000)).toBe("5s");
    expect(formatMs(30000)).toBe("30s");
    expect(formatMs(59000)).toBe("59s");
  });

  it("formats values in whole minutes", () => {
    expect(formatMs(60000)).toBe("1 min");
    expect(formatMs(1800000)).toBe("30 min");
    expect(formatMs(3600000)).toBe("60 min");
  });
});

describe("parseMs", () => {
  it("returns null for empty string", () => {
    expect(parseMs("")).toBeNull();
    expect(parseMs("   ")).toBeNull();
  });

  it("returns null for non-numeric input", () => {
    expect(parseMs("abc")).toBeNull();
    expect(parseMs("fast")).toBeNull();
    expect(parseMs("1e309")).toBeNull(); // Infinity
  });

  it("returns null for negative values", () => {
    expect(parseMs("-1")).toBeNull();
    expect(parseMs("-100")).toBeNull();
  });

  it("parses valid non-negative numbers", () => {
    expect(parseMs("0")).toBe(0);
    expect(parseMs("1000")).toBe(1000);
    expect(parseMs("1800000")).toBe(1_800_000);
  });

  it("parses zero as a valid value (disables timeout)", () => {
    expect(parseMs("0")).toBe(0);
  });
});

describe("validateTimeoutInput", () => {
  it("returns null for valid non-negative integers", () => {
    expect(validateTimeoutInput("0", "Global")).toBeNull();
    expect(validateTimeoutInput("1000", "analyze")).toBeNull();
    expect(validateTimeoutInput("1800000", "work")).toBeNull();
  });

  it("rejects empty string", () => {
    expect(validateTimeoutInput("", "Global")).toBeTruthy();
    expect(validateTimeoutInput("   ", "work")).toBeTruthy();
  });

  it("rejects non-numeric input with an error message", () => {
    const err = validateTimeoutInput("abc", "Global");
    expect(err).toBeTruthy();
    expect(err).toContain("valid number");
  });

  it("rejects negative values", () => {
    const err = validateTimeoutInput("-1", "analyze");
    expect(err).toBeTruthy();
    expect(err).toContain("0 or greater");
  });

  it("rejects fractional values", () => {
    const err = validateTimeoutInput("1.5", "work");
    expect(err).toBeTruthy();
    expect(err).toContain("whole number");
  });

  it("includes the label in the error message", () => {
    const err = validateTimeoutInput("abc", "MyLabel");
    expect(err).toContain("MyLabel");
  });
});
