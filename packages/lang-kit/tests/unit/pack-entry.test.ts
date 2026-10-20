import { describe, expect, it } from "vitest";

import { goConfig } from "../../src/go.js";
import { isLanguagePackEntry, type LanguagePackEntry } from "../../src/pack-entry.js";

const entry: LanguagePackEntry = {
  packageName: "@n-dx/lang-go",
  version: "1.0.0",
  id: goConfig.id,
  config: goConfig,
  produces: ["imports"],
  analyzeProject: async () => ({ facts: [], unparsed: [] }),
};

describe("isLanguagePackEntry", () => {
  it("accepts a well-formed entry", () => {
    expect(isLanguagePackEntry(entry)).toBe(true);
  });

  it.each([
    ["undefined", undefined],
    ["a string", "pack"],
    ["no analyzeProject", { ...entry, analyzeProject: undefined }],
    ["no version", { ...entry, version: undefined }],
    ["an id that is not its config's", { ...entry, id: "java" }],
    ["an unknown fact kind", { ...entry, produces: ["imports", "dependencies"] }],
  ])("rejects %s", (_label, value) => {
    expect(isLanguagePackEntry(value)).toBe(false);
  });
});
