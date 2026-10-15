import { describe, expect, it } from "vitest";
import { isLanguagePackEntry, javaConfig } from "@n-dx/lang-kit";
import { pack } from "../../src/index.js";

describe("@n-dx/lang-java barrel", () => {
  it("exports the Java pack entry", () => {
    expect(isLanguagePackEntry(pack)).toBe(true);
    expect(pack).toMatchObject({ packageName: "@n-dx/lang-java", id: "java", config: javaConfig, produces: ["imports", "symbols", "calls", "routes", "outboundCalls"] });
  });
});
