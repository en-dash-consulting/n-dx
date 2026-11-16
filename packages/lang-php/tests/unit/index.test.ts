import { describe, expect, it } from "vitest";
import { isLanguagePackEntry, phpConfig } from "@n-dx/lang-kit";
import { factGaps } from "@n-dx/lang-runtime";
import { PHP_SYMBOL_RULES, pack, phpPack } from "../../src/index.js";

describe("@n-dx/lang-php barrel", () => {
  it("exports the PHP pack entry, producing imports, symbols, calls, routes, entry points and outbound calls", () => {
    expect(isLanguagePackEntry(pack)).toBe(true);
    expect(pack).toMatchObject({
      packageName: "@n-dx/lang-php",
      id: "php",
      config: phpConfig,
      produces: ["imports", "symbols", "calls", "routes", "entryPoints", "outboundCalls"],
    });
  });

  it("can read every kind it produces", () => {
    expect(factGaps(phpPack, PHP_SYMBOL_RULES)).toEqual([]);
  });

  it("has provenance for every query, its frameworks' included", () => {
    for (const query of phpPack.queries) expect(phpPack.provenance[query.name], query.name).toBeDefined();
    for (const framework of phpPack.frameworks ?? []) {
      for (const query of framework.queries) expect(framework.provenance[query.name], query.name).toBeDefined();
    }
  });
});
