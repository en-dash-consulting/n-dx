import { describe, expect, it } from "vitest";
import { LANG_SQL_PACKAGE } from "../../src/index.js";

describe("@n-dx/lang-sql barrel", () => {
  it("exports the package name", () => {
    expect(LANG_SQL_PACKAGE).toBe("@n-dx/lang-sql");
  });
});
