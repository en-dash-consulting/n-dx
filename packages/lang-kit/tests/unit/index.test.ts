import { describe, expect, it } from "vitest";
import { LANG_KIT_PACKAGE } from "../../src/index.js";

describe("@n-dx/lang-kit barrel", () => {
  it("exports the package name", () => {
    expect(LANG_KIT_PACKAGE).toBe("@n-dx/lang-kit");
  });
});
