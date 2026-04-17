import { describe, it, expect } from "vitest";
import { validateTimeoutMs } from "../../packages/core/config.js";

describe("validateTimeoutMs", () => {
  it("accepts a valid positive timeout", () => {
    expect(() => validateTimeoutMs(1800000)).not.toThrow();
    expect(() => validateTimeoutMs(3600000)).not.toThrow();
    expect(() => validateTimeoutMs(14400000)).not.toThrow();
  });

  it("accepts zero (disables timeout)", () => {
    expect(() => validateTimeoutMs(0)).not.toThrow();
  });

  it("rejects negative values with a descriptive error", () => {
    expect(() => validateTimeoutMs(-1)).toThrow("non-negative");
    expect(() => validateTimeoutMs(-1000)).toThrow("non-negative");
  });

  it("includes the offending value in the negative-value error", () => {
    expect(() => validateTimeoutMs(-500)).toThrow("-500");
  });

  it("rejects NaN", () => {
    expect(() => validateTimeoutMs(NaN)).toThrow("number in milliseconds");
  });

  it("rejects non-numeric types (string, null, undefined)", () => {
    expect(() => validateTimeoutMs("1800000")).toThrow("number in milliseconds");
    expect(() => validateTimeoutMs(null)).toThrow("number in milliseconds");
    expect(() => validateTimeoutMs(undefined)).toThrow("number in milliseconds");
  });

  it("rejects Infinity", () => {
    expect(() => validateTimeoutMs(Infinity)).toThrow("number in milliseconds");
    expect(() => validateTimeoutMs(-Infinity)).toThrow("number in milliseconds");
  });
});
