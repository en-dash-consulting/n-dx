import { describe, it, expect } from "vitest";
import { isWindowsSafeSegment } from "../../../src/store/index.js";

describe("isWindowsSafeSegment", () => {
  it.each([
    "con", "CON", "Prn", "aux", "nul", "com1", "COM9", "lpt1", "lpt9", "com¹",
    "con.md", "NUL.txt", "aux.tar.gz", "lpt9 .txt",
    "ends-in-dot.", "ends-in-space ",
    "a<b", "a>b", "a:b", 'a"b', "a/b", "a\\b", "a|b", "a?b", "a*b", "a\u0000b", "a\u001fb",
    "",
  ])("refuses %j", (segment) => {
    expect(isWindowsSafeSegment(segment)).toBe(false);
  });

  it.each(["console", "auxiliary", "null-handling", "com10", "lpt10", "com", "prn-report", "con-tracts", "a.b", ".hidden"])(
    "accepts %j",
    (segment) => {
      expect(isWindowsSafeSegment(segment)).toBe(true);
    },
  );
});
