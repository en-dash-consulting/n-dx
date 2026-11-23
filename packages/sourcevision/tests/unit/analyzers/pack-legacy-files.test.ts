import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LegacyConstructFact, VersionFloorFact } from "@n-dx/lang-kit";
import { packEcosystem } from "../../../src/analyzers/pack-ecosystem.js";
import type { PackFrameworkFacts } from "../../../src/analyzers/pack-framework-facts.js";
import { packLegacyData, writeLegacyData } from "../../../src/analyzers/pack-legacy-files.js";
import { DATA_FILES } from "../../../src/schema/data-files.js";
import type { Inventory, LegacyData, LegacyFileEntry } from "../../../src/schema/index.js";
import { validateModule } from "../../../src/schema/validate.js";
import { fileTotals, floorTotals, profileCounts } from "../../helpers/legacy-totals.js";

type File = { language?: string; thirdParty?: string; mirrorOf?: string };

function inventory(files: Record<string, File>): Inventory {
  return {
    files: Object.entries(files).map(([path, f]) => ({
      path,
      language: f.language ?? "PHP",
      size: 1,
      lineCount: 1,
      hash: "h",
      role: "source",
      category: "",
      ...(f.thirdParty === undefined ? {} : { thirdParty: f.thirdParty }),
      ...(f.mirrorOf === undefined ? {} : { mirrorOf: f.mirrorOf }),
    })),
  } as unknown as Inventory;
}

const MIGRATION = "https://www.php.net/manual/en/migration";
const page = (version: string, section: string) => ({ version, source: `${MIGRATION}${version.replace(".", "")}.${section}.php` });

const floor = (version: string, line = 1): VersionFloorFact => ({
  version,
  rule: "short-array",
  construct: "short array syntax",
  source: page(version, "new-features").source,
  position: { line, column: 0 },
});

const MYSQL: Omit<LegacyConstructFact, "position"> = {
  rule: "mysql-functions",
  construct: "mysql_query()",
  status: "removed",
  deprecated: { version: "5.5", source: "https://www.php.net/ChangeLog-5.php#5.5.0" },
  removed: page("7.0", "removed-exts-sapis"),
  source: page("7.0", "removed-exts-sapis").source,
};
const DYNAMIC: Omit<LegacyConstructFact, "position"> = {
  rule: "dynamic-property",
  construct: "dynamic property A::$b",
  status: "deprecated",
  deprecated: page("8.2", "deprecated"),
  source: page("8.2", "deprecated").source,
  likely: true,
};
const SHORT_TAG: Omit<LegacyConstructFact, "position"> = {
  rule: "short-open-tag",
  construct: "<? short open tag",
  status: "notice",
  source: "https://www.php.net/manual/en/ini.core.php#ini.short-open-tag",
};

const use = (fact: Omit<LegacyConstructFact, "position">, line: number, column = 0): LegacyConstructFact => ({ ...fact, position: { line, column } });

const asked = ["versionFloor", "legacyConstructs"] as const;

describe("packLegacyData", () => {
  it("is undefined with no floor and no use", () => {
    expect(packLegacyData(undefined, inventory({ "a.php": {} }))).toBeUndefined();
    expect(packLegacyData([{ path: "a.php", asked: [...asked] }, { path: "b.php", legacyConstructs: [] }], inventory({ "a.php": {}, "b.php": {} }))).toBeUndefined();
    expect(packLegacyData([{ path: "gone.php", versionFloor: floor("5.4") }], inventory({ "a.php": {} }))).toBeUndefined();
  });

  it("lists each file with a floor or a use, sorted by path then position, with versions and no pages", () => {
    const facts: PackFrameworkFacts = [
      { path: "z.php", legacyConstructs: [use(MYSQL, 9, 4), use(DYNAMIC, 3), use(MYSQL, 9, 1)] },
      { path: "a.php", versionFloor: floor("5.4", 2) },
      { path: "m.php", legacyConstructs: [use(SHORT_TAG, 1)] },
      { path: "none.php", asked: [...asked] },
    ];
    const data = packLegacyData(facts, inventory({ "z.php": {}, "a.php": {}, "m.php": {}, "none.php": {} }));
    expect(data).toEqual<LegacyData>({
      languages: {
        php: {
          files: [
            { path: "a.php", floor: { version: "5.4", rule: "short-array", line: 2 }, uses: 0, notices: 0, removedIn: {}, deprecatedIn: {}, constructs: [] },
            {
              path: "m.php",
              uses: 0,
              notices: 1,
              removedIn: {},
              deprecatedIn: {},
              constructs: [{ rule: "short-open-tag", construct: "<? short open tag", status: "notice", line: 1, column: 0 }],
            },
            {
              path: "z.php",
              uses: 3,
              notices: 0,
              removedIn: { "7.0": 2 },
              deprecatedIn: { "8.2": 1 },
              constructs: [
                { rule: "dynamic-property", construct: "dynamic property A::$b", status: "deprecated", line: 3, column: 0, deprecated: "8.2", likely: true },
                { rule: "mysql-functions", construct: "mysql_query()", status: "removed", line: 9, column: 1, deprecated: "5.5", removed: "7.0" },
                { rule: "mysql-functions", construct: "mysql_query()", status: "removed", line: 9, column: 4, deprecated: "5.5", removed: "7.0" },
              ],
            },
          ],
        },
      },
    });
    expect(JSON.stringify(data)).not.toContain("https://");
    expect(validateModule("legacy", data).ok).toBe(true);
  });

  it("lists third-party files apart and leaves mirror copies out", () => {
    const facts: PackFrameworkFacts = [
      { path: "app.php", legacyConstructs: [use(MYSQL, 1)] },
      { path: "vendor/lib.php", legacyConstructs: [use(MYSQL, 5)] },
      { path: "copy/app.php", legacyConstructs: [use(MYSQL, 1)] },
    ];
    const data = packLegacyData(facts, inventory({ "app.php": {}, "vendor/lib.php": { thirdParty: "vendor" }, "copy/app.php": { mirrorOf: "app.php" } }));
    expect(data?.languages.php.files.map((f) => f.path)).toEqual(["app.php"]);
    expect(data?.languages.php.thirdParty?.map((f) => f.path)).toEqual(["vendor/lib.php"]);
  });

  it("omits thirdParty when no third-party file has a floor or use, and keeps a language with third-party files only", () => {
    const own = packLegacyData([{ path: "a.php", versionFloor: floor("5.3") }], inventory({ "a.php": {} }));
    expect(own?.languages.php).not.toHaveProperty("thirdParty");
    const outside = packLegacyData([{ path: "vendor/x.php", versionFloor: floor("5.3") }], inventory({ "vendor/x.php": { thirdParty: "vendor" } }));
    expect(outside?.languages.php.files).toEqual([]);
    expect(outside?.languages.php.thirdParty).toHaveLength(1);
  });

  it("sums to the SDLC profile's legacyConstructs and versionFloors, own and third-party", () => {
    const facts: PackFrameworkFacts = [
      { path: "a.php", asked: [...asked], versionFloor: floor("5.4"), legacyConstructs: [use(MYSQL, 2), use(SHORT_TAG, 1), use(DYNAMIC, 4)] },
      { path: "b.php", asked: [...asked], versionFloor: floor("7.4"), legacyConstructs: [use(MYSQL, 1)] },
      { path: "c.php", asked: [...asked], versionFloor: floor("5.4") },
      { path: "d.php", asked: [...asked] },
      { path: "lib/x.php", asked: [...asked], legacyConstructs: [use(MYSQL, 3), use(SHORT_TAG, 1)] },
      { path: "lib/y.php", asked: [...asked], legacyConstructs: [use(DYNAMIC, 3)] },
      { path: "mirror/a.php", asked: [...asked], versionFloor: floor("5.4"), legacyConstructs: [use(MYSQL, 2)] },
    ];
    const inv = inventory({
      "a.php": {},
      "b.php": {},
      "c.php": {},
      "d.php": {},
      "lib/x.php": { thirdParty: "lib" },
      "lib/y.php": { thirdParty: "lib" },
      "mirror/a.php": { mirrorOf: "a.php" },
    });
    const php = packLegacyData(facts, inv)!.languages.php;
    const eco = packEcosystem(facts, inv)!.php;

    expect(fileTotals(php.files)).toEqual(profileCounts(eco.legacyConstructs!));
    expect(fileTotals(php.thirdParty!)).toEqual(profileCounts(eco.thirdParty!.legacyConstructs!));
    expect(floorTotals(php.files)).toEqual(eco.versionFloors!.floors);
  });
});

describe("writeLegacyData", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("writes valid canonical JSON, removes a stale file when there is no data, and creates nothing otherwise", () => {
    dir = mkdtempSync(join(tmpdir(), "sv-legacy-json-"));
    const path = join(dir, DATA_FILES.legacy);
    writeLegacyData(dir, undefined);
    expect(existsSync(path)).toBe(false);

    writeLegacyData(dir, packLegacyData([{ path: "a.php", legacyConstructs: [use(MYSQL, 1)] }], inventory({ "a.php": {} })));
    expect(validateModule("legacy", JSON.parse(readFileSync(path, "utf-8"))).ok).toBe(true);

    writeFileSync(path, "{}");
    writeLegacyData(dir, undefined);
    expect(existsSync(path)).toBe(false);
  });
});

describe("LegacySchema", () => {
  const entry: LegacyFileEntry = { path: "a.php", uses: 0, notices: 0, removedIn: {}, deprecatedIn: {}, constructs: [] };
  it("refuses a file with neither floor nor use, a bad version and an empty thirdParty", () => {
    expect(validateModule("legacy", { languages: { php: { files: [entry] } } }).ok).toBe(false);
    expect(validateModule("legacy", { languages: { php: { files: [{ ...entry, floor: { version: "5", rule: "r", line: 1 } }] } } }).ok).toBe(false);
    expect(validateModule("legacy", { languages: { php: { files: [], thirdParty: [] } } }).ok).toBe(false);
    expect(validateModule("legacy", { languages: { php: { files: [{ ...entry, floor: { version: "5.4", rule: "r", line: 1 } }] } } }).ok).toBe(true);
  });
});
