import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VALID_LANGUAGE_IDS } from "../../packages/lang-kit/dist/index.js";

const config = readFileSync(new URL("../../packages/core/config.js", import.meta.url), "utf8");

describe("config language parity", () => {
  it("accepts every language the analysis registry supports", () => {
    const values = /const VALID_LANGUAGES = new Set\(\[([^\]]+)\]\)/.exec(config);
    expect(values).not.toBeNull();
    const names = [...values[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    expect(names.sort()).toEqual([...VALID_LANGUAGE_IDS].sort());
  });

  it("documents the same accepted values in help", () => {
    const list = /Valid values: ([^\n]+)/.exec(config.slice(config.indexOf("Language detection override")));
    expect(list).not.toBeNull();
    expect(list[1].split(/,\s*/).sort()).toEqual([...VALID_LANGUAGE_IDS].sort());
  });
});
