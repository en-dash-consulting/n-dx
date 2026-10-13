import { describe, expect, it } from "vitest";
import { LANG_JAVA_PACKAGE } from "../../src/index.js";

describe("@n-dx/lang-java barrel", () => {
  it("exports the package name", () => {
    expect(LANG_JAVA_PACKAGE).toBe("@n-dx/lang-java");
  });
});
