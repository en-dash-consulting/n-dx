import { describe, expect, it } from "vitest";
import { LEGACY_RULES, SYNTAX_RULES, citedPhpVersion, phpVersionSource, type PhpLegacyRule } from "../../src/index.js";

const CHANGELOG = "https://www.php.net/ChangeLog-5.php";
const MANUAL = "https://www.php.net/manual/en/";

/** Every version-dated source the version-floor and legacy rules cite. */
const citedSources = (): string[] => [
  ...Object.values(SYNTAX_RULES).map((r) => r.source),
  ...(Object.values(LEGACY_RULES) as PhpLegacyRule[]).flatMap((r) => [r.deprecated, r.removed, r.changed].flatMap((b) => (b ? [b.source] : []))),
];

describe("php version sources", () => {
  it("cite no pre-5.6 migration guide, which php.net no longer hosts", () => {
    expect(citedSources().filter((s) => /migration5[345]/.test(s))).toEqual([]);
  });

  it("cite the PHP 5 changelog's release anchor for 5.3 to 5.5", () => {
    expect(phpVersionSource("5.3", "new-features")).toBe(`${CHANGELOG}#5.3.0`);
    expect(phpVersionSource("5.4", "incompatible")).toBe(`${CHANGELOG}#5.4.0`);
    expect(phpVersionSource("5.5", "deprecated")).toBe(`${CHANGELOG}#5.5.0`);
  });

  it("cite the migration guide page from 5.6 on", () => {
    expect(phpVersionSource("5.6", "new-features")).toBe(`${MANUAL}migration56.new-features.php`);
    expect(phpVersionSource("8.0", "incompatible")).toBe(`${MANUAL}migration80.incompatible.php`);
  });

  it("refuse a version neither source covers", () => {
    expect(() => phpVersionSource("5.2", "new-features")).toThrow();
    expect(() => phpVersionSource("5", "new-features")).toThrow();
  });

  it("read the version a source cites, accepting only the two forms", () => {
    expect(citedPhpVersion(`${CHANGELOG}#5.4.0`)).toBe("5.4");
    expect(citedPhpVersion(`${MANUAL}migration72.other-changes.php`)).toBe("7.2");
    expect(citedPhpVersion(`${MANUAL}migration56.new-features.php`)).toBe("5.6");
    for (const rejected of [
      `${MANUAL}migration53.deprecated.php`,
      `${MANUAL}migration55.new-features.php`,
      `${CHANGELOG}#5.6.0`,
      `${CHANGELOG}#5.2.0`,
      `${CHANGELOG}#5.4.1`,
      `${CHANGELOG}#5.4.0x`,
      `${MANUAL}ini.core.php#ini.short-open-tag`,
      `http://www.php.net/ChangeLog-5.php#5.4.0`,
    ]) {
      expect(citedPhpVersion(rejected), rejected).toBeUndefined();
    }
  });
});
