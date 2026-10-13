import { describe, expect, it } from "vitest";
import { goConfig, isLanguagePackEntry } from "@n-dx/lang-kit";
import { pack } from "../../src/index.js";

describe("@n-dx/lang-go barrel", () => {
  it("exports the Go pack entry", () => {
    expect(isLanguagePackEntry(pack)).toBe(true);
    expect(pack).toMatchObject({ packageName: "@n-dx/lang-go", id: "go", config: goConfig, produces: ["imports", "symbols", "calls"] });
  });
});
