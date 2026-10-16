import { describe, expect, it } from "vitest";
import { topLevelIndex } from "../../src/python-clients.js";
import { stringParts, stringValue } from "../../src/python-web.js";

describe("topLevelIndex", () => {
  it("finds a character outside brackets and string literals", () => {
    expect(topLevelIndex('"a+b" + c', "+")).toBe(6);
    expect(topLevelIndex("f(a + b) + c", "+")).toBe(9);
    expect(topLevelIndex("'''x + y''' + z", "+")).toBe(12);
    expect(topLevelIndex('"a\\"+" + z', "+")).toBe(7);
    expect(topLevelIndex("a, b", "+")).toBe(-1);
  });

  it("gives -1 when a bracket closes that never opened", () => {
    expect(topLevelIndex('"A") or default(x', ",")).toBe(-1);
  });
});

describe("stringParts", () => {
  it("splits an f-string into literal text and fields, merging adjacent literals", () => {
    expect(stringParts('f"{settings.BASE}/items/{id!r:>3}"')).toEqual([{ field: "settings.BASE" }, { literal: "/items/" }, { field: "id" }]);
    expect(stringParts('"https://" f"{{host}}/{path}"')).toEqual([{ literal: "https://{host}/" }, { field: "path" }]);
    expect(stringParts('""')).toEqual([]);
    expect(stringParts("name")).toBeUndefined();
  });

  it("leaves stringValue's literal rule as it was: any f-string piece is not a literal", () => {
    expect(stringValue('f"/a"')).toEqual({ text: "/a", literal: false });
    expect(stringValue('"/a" "/b"')).toEqual({ text: "/a/b", literal: true });
  });
});
