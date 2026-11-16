import { describe, expect, it } from "vitest";
import { compareLanguageVersions } from "@n-dx/lang-kit";
import { SYNTAX_RULES, phpCompat } from "../../src/index.js";

describe("php version-floor rules", () => {
  it("cite the php.net migration guide page of the version they set", () => {
    for (const [id, rule] of Object.entries(SYNTAX_RULES)) {
      const [major, minor] = rule.version.split(".");
      expect(rule.source, id).toBe(`https://www.php.net/manual/en/migration${major}${minor}.new-features.php`);
    }
  });

  it("are listed oldest version first", () => {
    const versions = Object.values(SYNTAX_RULES).map((r) => r.version);
    expect([...versions].sort(compareLanguageVersions)).toEqual(versions);
  });

  it("carry each rule's page as its provenance", () => {
    for (const [id, rule] of Object.entries(SYNTAX_RULES)) expect(phpCompat.provenance[id]?.source, id).toBe(rule.source);
  });
});
