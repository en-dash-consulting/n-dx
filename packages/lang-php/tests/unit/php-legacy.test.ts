import { describe, expect, it } from "vitest";
import { compareLanguageVersions } from "@n-dx/lang-kit";
import { LEGACY_RULES, blankStringsAndComments, citedPhpVersion, legacySource, legacyStatus, phpLegacy, type PhpLegacyRule } from "../../src/index.js";

const rules = Object.entries(LEGACY_RULES) as [string, PhpLegacyRule][];

describe("php legacy rules", () => {
  it("cite, for every version they give, that version's php.net page", () => {
    for (const [id, rule] of rules) {
      for (const boundary of [rule.deprecated, rule.removed, rule.changed]) {
        if (boundary === undefined) continue;
        expect(citedPhpVersion(boundary.source), `${id}: ${boundary.source}`).toBe(boundary.version);
      }
    }
  });

  it("give every rule a version, except the short open tag, which depends on configuration", () => {
    const versionless = rules.filter(([, r]) => !r.deprecated && !r.removed && !r.changed).map(([id]) => id);
    expect(versionless).toEqual(["short-open-tag"]);
  });

  it("deprecate before they remove", () => {
    for (const [id, rule] of rules) {
      if (rule.deprecated && rule.removed) expect(compareLanguageVersions(rule.deprecated.version, rule.removed.version), id).toBeLessThan(0);
    }
  });

  it("make only the short open tag and the string-to-number comparison notices", () => {
    expect(rules.filter(([, r]) => legacyStatus(r) === "notice").map(([id]) => id)).toEqual(["short-open-tag", "string-number-comparison"]);
    expect(legacyStatus(LEGACY_RULES.each)).toBe("removed");
    expect(legacyStatus(LEGACY_RULES["utf8-encode-decode"])).toBe("deprecated");
  });

  it("carry each rule's page as its provenance", () => {
    for (const [id, rule] of rules) expect(phpLegacy.provenance[id]?.source, id).toBe(legacySource(rule));
  });

  it("name in their provenance only the documents their versions cite", () => {
    expect(phpLegacy.provenance.each?.verifiedAgainst).toEqual(["tree-sitter-php@0.25.1", "PHP 7.2 migration guide", "PHP 8.0 migration guide"]);
    expect(phpLegacy.provenance["session-register"]?.verifiedAgainst).toEqual(["tree-sitter-php@0.25.1", "PHP 5 changelog"]);
    expect(phpLegacy.provenance["mysql-functions"]?.verifiedAgainst).toEqual(["tree-sitter-php@0.25.1", "PHP 5 changelog", "PHP 7.0 migration guide"]);
    expect(phpLegacy.provenance["short-open-tag"]?.verifiedAgainst).toEqual(["tree-sitter-php@0.25.1", "PHP manual"]);
  });
});

describe("blankStringsAndComments", () => {
  it("blanks quoted strings and comments, keeping offsets and newlines", () => {
    const text = `$a{0}; "$b{1}" '$c{2}' // $d{3}\n# $e{4}\n/* $f{5}\n */ $g{6}`;
    const blanked = blankStringsAndComments(text);
    expect(blanked).toHaveLength(text.length);
    expect([...blanked.matchAll(/\$(\w)\{/g)].map((m) => m[1])).toEqual(["a", "g"]);
    expect(blanked.split("\n")).toHaveLength(text.split("\n").length);
  });

  it("skips an escaped quote and ends an unterminated string or comment at the text's end", () => {
    expect(blankStringsAndComments(`"a\\"$x{0}" $y{1}`).trim()).toBe("$y{1}");
    expect(blankStringsAndComments(`$z{0} "open $q{1}`).trim()).toBe("$z{0}");
    expect(blankStringsAndComments(`$z{0} /* open $q{1}`).trim()).toBe("$z{0}");
  });
});
