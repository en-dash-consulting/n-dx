import { describe, expect, it } from "vitest";
import { isLanguagePackEntry, pythonConfig } from "@n-dx/lang-kit";
import { pack } from "../../src/index.js";

describe("@n-dx/lang-python barrel", () => {
  it("exports the Python pack entry", () => {
    expect(isLanguagePackEntry(pack)).toBe(true);
    expect(pack).toMatchObject({
      packageName: "@n-dx/lang-python",
      id: "python",
      config: pythonConfig,
      produces: ["imports", "symbols", "calls", "routes", "outboundCalls"],
    });
  });
});
