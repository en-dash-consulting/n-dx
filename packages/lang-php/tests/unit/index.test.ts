import { describe, expect, it } from "vitest";
import { isLanguagePackEntry, phpConfig } from "@n-dx/lang-kit";
import { factGaps } from "@n-dx/lang-runtime";
import { PHP_SYMBOL_RULES, pack, phpPack } from "../../src/index.js";

describe("@n-dx/lang-php barrel", () => {
  it("exports the PHP pack entry, producing imports, symbols and calls", () => {
    expect(isLanguagePackEntry(pack)).toBe(true);
    expect(pack).toMatchObject({
      packageName: "@n-dx/lang-php",
      id: "php",
      config: phpConfig,
      produces: ["imports", "symbols", "calls"],
    });
  });

  it("can read every kind it produces", () => {
    expect(factGaps(phpPack, PHP_SYMBOL_RULES)).toEqual([]);
  });

  it("has provenance for every query", () => {
    for (const query of phpPack.queries) expect(phpPack.provenance[query.name], query.name).toBeDefined();
  });
});
