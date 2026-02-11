import { describe, it, expect } from "vitest";
import { toCanonicalJSON } from "../../src/json.js";

describe("toCanonicalJSON", () => {
  it("pretty-prints with 2-space indent", () => {
    const result = toCanonicalJSON({ a: 1, b: [2, 3] });
    expect(result).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}\n');
  });

  it("ends with trailing newline", () => {
    expect(toCanonicalJSON({})).toMatch(/\n$/);
  });

  it("handles null", () => {
    expect(toCanonicalJSON(null)).toBe("null\n");
  });

  it("handles empty array", () => {
    expect(toCanonicalJSON([])).toBe("[]\n");
  });

  it("handles strings", () => {
    expect(toCanonicalJSON("hello")).toBe('"hello"\n');
  });
});
