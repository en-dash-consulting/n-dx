import { describe, expect, it } from "vitest";
import { LANG_GO_PACKAGE } from "../../src/index.js";

describe("@n-dx/lang-go barrel", () => {
  it("exports the package name", () => {
    expect(LANG_GO_PACKAGE).toBe("@n-dx/lang-go");
  });
});
