import { describe, expect, it } from "vitest";
import * as runtime from "../../src/index.js";

describe("@n-dx/lang-runtime barrel", () => {
  it("exports the loader, the runner, the facts adapter and the pack test helpers", () => {
    for (const name of [
      "loadLanguagePacks",
      "inventoryOnlyOutcome",
      "createTreeSitterRunner",
      "loadGrammar",
      "groupCalls",
      "readPackFacts",
      "factGaps",
      "skipUnlessGrammar",
      "checkGolden",
    ]) {
      expect(typeof (runtime as Record<string, unknown>)[name], name).toBe("function");
    }
  });
});
