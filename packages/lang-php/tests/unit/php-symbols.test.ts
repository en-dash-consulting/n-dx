import { describe, expect, it } from "vitest";
import { defineName } from "../../src/php-symbols.js";

describe("defineName", () => {
  it("reads a constant name from a plain single- or double-quoted literal", () => {
    expect(defineName("'APP_ROOT'")).toBe("APP_ROOT");
    expect(defineName('"VERSION"')).toBe("VERSION");
    expect(defineName("'Acme\\\\VERSION'")).toBe("Acme\\VERSION");
  });

  it("rejects interpolation, empty strings, mismatched quotes and names that are not identifiers", () => {
    for (const text of ['"PREFIX_$x"', "''", "'A\"", "'1ABC'", "'A B'", "PHP_EOL"]) {
      expect(defineName(text), text).toBeUndefined();
    }
  });
});
