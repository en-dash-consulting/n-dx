import { describe, expect, it } from "vitest";
import { isLanguagePackEntry, phpConfig } from "@n-dx/lang-kit";
import { pack } from "../../src/index.js";

describe("@n-dx/lang-php barrel", () => {
  it("exports the PHP pack entry, producing no facts yet", () => {
    expect(isLanguagePackEntry(pack)).toBe(true);
    expect(pack).toMatchObject({
      packageName: "@n-dx/lang-php",
      id: "php",
      config: phpConfig,
      produces: [],
    });
  });
});
