import { describe, expect, it } from "vitest";
import { isLanguagePackEntry } from "@n-dx/lang-kit";
import { pack } from "../../src/index.js";

describe("@n-dx/lang-sql barrel", () => {
  it("exports the SQL pack entry", () => {
    expect(isLanguagePackEntry(pack)).toBe(true);
    expect(pack).toMatchObject({ packageName: "@n-dx/lang-sql", id: "sql", produces: ["symbols"] });
  });
});
