import { describe, expect, it } from "vitest";
import { LANG_RUNTIME_PACKAGE } from "../../src/index.js";

describe("@n-dx/lang-runtime barrel", () => {
  it("exports the package name", () => {
    expect(LANG_RUNTIME_PACKAGE).toBe("@n-dx/lang-runtime");
  });
});
