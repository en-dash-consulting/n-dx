import { describe, expect, it } from "vitest";
import { isLanguagePackEntry, terraformConfig } from "@n-dx/lang-kit";
import { GRAMMARS } from "../../../lang-runtime/scripts/build-grammars.mjs";
import { pack, terraformPack } from "../../src/index.js";

describe("@n-dx/lang-terraform barrel", () => {
  it("exports the Terraform pack entry, which produces no fact kinds yet", () => {
    expect(isLanguagePackEntry(pack)).toBe(true);
    expect(pack).toMatchObject({ packageName: "@n-dx/lang-terraform", id: "terraform", config: terraformConfig, produces: [] });
  });

  it("pins tree-sitter-hcl v1.2.0 with a checksum, the version the pack names", () => {
    expect(GRAMMARS["tree-sitter-hcl"]).toMatchObject({
      repo: "tree-sitter-grammars/tree-sitter-hcl",
      version: "1.2.0",
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(terraformPack.grammar).toEqual({ name: "tree-sitter-hcl", version: GRAMMARS["tree-sitter-hcl"].version });
  });
});
