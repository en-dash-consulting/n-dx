import { describe, expect, it } from "vitest";
import { isLanguagePackEntry, terraformConfig } from "@n-dx/lang-kit";
import { GRAMMARS } from "../../../lang-runtime/scripts/build-grammars.mjs";
import { factGaps } from "@n-dx/lang-runtime";
import { AUDIT_ATTRIBUTE_RULES, REGISTRY_MODULES, pack, readTerraformFacts, terraformPack } from "../../src/index.js";

describe("@n-dx/lang-terraform barrel", () => {
  it("exports the Terraform pack entry, which produces resources", () => {
    expect(isLanguagePackEntry(pack)).toBe(true);
    expect(pack).toMatchObject({ packageName: "@n-dx/lang-terraform", id: "terraform", config: terraformConfig, produces: ["resources"] });
  });

  it("reads every kind it produces and records provenance for every query", () => {
    expect(factGaps(terraformPack, undefined, readTerraformFacts)).toEqual([]);
    for (const query of terraformPack.queries) expect(terraformPack.provenance[query.name], query.name).toBeDefined();
    for (const rule of [...AUDIT_ATTRIBUTE_RULES, ...REGISTRY_MODULES]) expect(rule.provenance.source).toMatch(/^https:\/\//);
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
