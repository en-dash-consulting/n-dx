import { describe, expect, it } from "vitest";
import type { DynamicCodeFact, LegacyConstructFact, VersionFloorFact } from "@n-dx/lang-kit";
import { packEcosystem, withEcosystem } from "../../../src/analyzers/pack-ecosystem.js";
import { computeReadinessScore } from "../../../src/analyzers/readiness-score.js";
import type { Inventory, SdlcProfile } from "../../../src/schema/index.js";
import { SdlcProfileSchema, validate } from "../../../src/schema/validate.js";

function inventory(files: Record<string, string>): Inventory {
  return {
    files: Object.entries(files).map(([path, language]) => ({ path, language, size: 1, lineCount: 1, hash: "h", role: "source", category: "" })),
  } as unknown as Inventory;
}

const floor = (version: string): VersionFloorFact => ({
  version,
  rule: "r",
  construct: "c",
  source: `https://www.php.net/manual/en/migration${version.replace(".", "")}.new-features.php`,
  position: { line: 1, column: 0 },
});

const page = (version: string, section: string) => ({ version, source: `https://www.php.net/manual/en/migration${version.replace(".", "")}.${section}.php` });

const MYSQL: Omit<LegacyConstructFact, "position"> = {
  rule: "mysql-functions",
  construct: "mysql_query()",
  status: "removed",
  deprecated: { version: "5.5", source: "https://www.php.net/ChangeLog-5.php#5.5.0" },
  removed: page("7.0", "removed-exts-sapis"),
  source: page("7.0", "removed-exts-sapis").source,
};
const EACH: Omit<LegacyConstructFact, "position"> = {
  rule: "each",
  construct: "each()",
  status: "removed",
  deprecated: page("7.2", "deprecated"),
  removed: page("8.0", "incompatible"),
  source: page("8.0", "incompatible").source,
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

const use = (fact: Omit<LegacyConstructFact, "position">, line = 1): LegacyConstructFact => ({ ...fact, position: { line, column: 0 } });

const EMPTY_PROFILE: SdlcProfile = {
  schemaVersion: "1",
  commands: [],
  tests: { frameworks: [], suites: [] },
  ci: [],
  cd: [],
  rollback: [],
  migrations: [],
  featureFlags: [],
  qualityGates: [],
  observability: [],
  containers: [],
  iac: [],
  parseFailures: [],
};

describe("packEcosystem: version floors", () => {
  it("counts a language's files by floor, oldest first, with files no rule dated and the highest floor", () => {
    const inv = inventory({ "a.php": "PHP", "b.php": "PHP", "c.php": "PHP", "d.php": "PHP", "e.php": "PHP" });
    const ecosystem = packEcosystem(
      [
        { path: "a.php", versionFloor: floor("7.4") },
        { path: "b.php", versionFloor: floor("5.3") },
        { path: "c.php", versionFloor: floor("7.4") },
        { path: "d.php" },
        { path: "e.php", versionFloor: floor("7.10") },
      ],
      inv,
    );
    expect(ecosystem).toEqual({ php: { versionFloors: { files: 5, floors: { "5.3": 1, "7.4": 2, "7.10": 1 }, none: 1, highest: "7.10" } } });
    expect(Object.keys(ecosystem!.php!.versionFloors!.floors)).toEqual(["5.3", "7.4", "7.10"]);
  });

  it("is undefined without facts, without floors or uses, or for files the inventory does not list", () => {
    const inv = inventory({ "a.php": "PHP" });
    expect(packEcosystem(undefined, inv)).toBeUndefined();
    expect(packEcosystem([{ path: "a.php" }, { path: "a.php", routes: [], legacyConstructs: [] }], inv)).toBeUndefined();
    expect(packEcosystem([{ path: "gone.php", versionFloor: floor("8.0"), legacyConstructs: [use(EACH)] }], inv)).toBeUndefined();
  });

  it("writes the histogram with no floor when the pack was asked for floors and no rule dated a file", () => {
    const inv = inventory({ "a.php": "PHP", "b.php": "PHP", "App.java": "Java" });
    const asked = ["routes", "versionFloor"] as const;
    const ecosystem = packEcosystem(
      [{ path: "a.php", asked }, { path: "b.php", asked }, { path: "App.java", asked: ["routes"] }],
      inv,
    );
    expect(ecosystem).toEqual({ php: { versionFloors: { files: 2, floors: {}, none: 2 } } });
    expect("highest" in ecosystem!.php!.versionFloors!).toBe(false);
    expect(validate(SdlcProfileSchema, withEcosystem(EMPTY_PROFILE, ecosystem)).ok).toBe(true);
  });

  it("leaves out a language whose files have neither", () => {
    const inv = inventory({ "a.php": "PHP", "App.java": "Java" });
    expect(packEcosystem([{ path: "a.php", versionFloor: floor("8.1") }, { path: "App.java" }], inv)).toEqual({
      php: { versionFloors: { files: 1, floors: { "8.1": 1 }, none: 0, highest: "8.1" } },
    });
  });
});

describe("packEcosystem: legacy constructs", () => {
  const inv = inventory({ "a.php": "PHP", "b.php": "PHP", "c.php": "PHP" });

  it("counts uses and files by rule, by removal version and by deprecation version, notices apart", () => {
    const ecosystem = packEcosystem(
      [
        { path: "a.php", legacyConstructs: [use(MYSQL, 1), use(MYSQL, 2), use(EACH, 3), use(SHORT_TAG, 4)] },
        { path: "b.php", legacyConstructs: [use(MYSQL), use(DYNAMIC)] },
        { path: "c.php" },
      ],
      inv,
    );
    expect(ecosystem).toEqual({
      php: {
        legacyConstructs: {
          files: 2,
          uses: 5,
          notices: 1,
          rules: {
            "dynamic-property": { status: "deprecated", uses: 1, files: 1, deprecated: DYNAMIC.deprecated, source: DYNAMIC.source, likely: true },
            each: { status: "removed", uses: 1, files: 1, deprecated: EACH.deprecated, removed: EACH.removed, source: EACH.source },
            "mysql-functions": { status: "removed", uses: 3, files: 2, deprecated: MYSQL.deprecated, removed: MYSQL.removed, source: MYSQL.source },
            "short-open-tag": { status: "notice", uses: 1, files: 1, source: SHORT_TAG.source },
          },
          removedIn: { "7.0": 3, "8.0": 1 },
          deprecatedIn: { "8.2": 1 },
        },
      },
    });
    expect(Object.keys(ecosystem!.php!.legacyConstructs!.rules)).toEqual(["dynamic-property", "each", "mysql-functions", "short-open-tag"]);
  });

  it("sits beside the version floors of the same language", () => {
    const ecosystem = packEcosystem([{ path: "a.php", versionFloor: floor("5.3"), legacyConstructs: [use(EACH)] }], inv);
    expect(Object.keys(ecosystem!.php!)).toEqual(["versionFloors", "legacyConstructs"]);
  });

  it("counts a file with notices only, but no uses", () => {
    expect(packEcosystem([{ path: "a.php", legacyConstructs: [use(SHORT_TAG)] }], inv)?.php?.legacyConstructs).toMatchObject({
      files: 1,
      uses: 0,
      notices: 1,
      removedIn: {},
      deprecatedIn: {},
    });
  });
});

const site = (kind: DynamicCodeFact["kind"], construct: string, literal = false): DynamicCodeFact => ({
  kind,
  construct,
  expression: `${construct}(...)`,
  position: { line: 1, column: 0 },
  ...(literal ? { literal: true as const } : {}),
});

describe("packEcosystem: dynamic code", () => {
  const inv = inventory({ "a.php": "PHP", "b.php": "PHP", "c.php": "PHP" });

  it("counts sites and files by kind and by construct, literal exec sites apart", () => {
    const ecosystem = packEcosystem(
      [
        { path: "a.php", dynamicCode: [site("exec", "eval"), site("exec", "eval", true), site("dispatch", "variable-function")] },
        { path: "b.php", dynamicCode: [site("include", "dynamic-include"), site("dispatch", "call_user_func")] },
        { path: "c.php", dynamicCode: [] },
      ],
      inv,
    );
    expect(ecosystem?.php?.dynamicCode).toEqual({
      files: 2,
      sites: 5,
      kinds: { exec: 2, dispatch: 2, include: 1 },
      literal: 1,
      constructs: { call_user_func: 1, "dynamic-include": 1, eval: 2, "variable-function": 1 },
    });
  });

  it("counts database-driven sites by kind, table and column, only when there is one", () => {
    const fed = (fact: DynamicCodeFact, tables: string[], columns: string[]): DynamicCodeFact => ({
      ...fact,
      database: { tables, columns, sources: [{ path: "lib/db.php", position: { line: 3, column: 2 } }] },
    });
    const ecosystem = packEcosystem(
      [
        {
          path: "a.php",
          dynamicCode: [
            fed(site("dispatch", "call_user_func"), ["pages"], ["pages.handler"]),
            fed(site("exec", "eval"), ["blocks", "pages"], ["blocks.body"]),
            fed(site("dispatch", "variable-new"), ["menu_router"], []),
            site("exec", "eval"),
          ],
        },
      ],
      inv,
    );
    expect(ecosystem?.php?.dynamicCode?.database).toEqual({
      sites: 3,
      kinds: { exec: 1, dispatch: 2 },
      tables: { blocks: 1, menu_router: 1, pages: 2 },
      columns: { "blocks.body": 1, "pages.handler": 1 },
    });
    expect(packEcosystem([{ path: "a.php", dynamicCode: [site("exec", "eval")] }], inv)?.php?.dynamicCode).not.toHaveProperty("database");
  });

  it("is absent when no file has a site, and sits beside the other sections when one does", () => {
    expect(packEcosystem([{ path: "a.php", dynamicCode: [] }], inv)).toBeUndefined();
    const ecosystem = packEcosystem([{ path: "a.php", versionFloor: floor("5.3"), legacyConstructs: [use(EACH)], dynamicCode: [site("exec", "eval")] }], inv);
    expect(Object.keys(ecosystem!.php!)).toEqual(["versionFloors", "legacyConstructs", "dynamicCode"]);
  });
});

describe("the profile's ecosystem", () => {
  const ecosystem = {
    php: {
      versionFloors: { files: 2, floors: { "5.3": 1, "8.0": 1 }, none: 0, highest: "8.0" },
      legacyConstructs: packEcosystem([{ path: "a.php", legacyConstructs: [use(MYSQL), use(DYNAMIC), use(SHORT_TAG)] }], inventory({ "a.php": "PHP" }))!.php!
        .legacyConstructs!,
      dynamicCode: {
        files: 1,
        sites: 2,
        kinds: { exec: 1, dispatch: 1, include: 0 },
        literal: 0,
        constructs: { eval: 1, "variable-new": 1 },
        database: { sites: 1, kinds: { exec: 0, dispatch: 1 }, tables: { routes: 1 }, columns: { "routes.controller": 1 } },
      },
    },
  };

  it("is added only when there is one", () => {
    expect(withEcosystem(EMPTY_PROFILE, undefined)).toBe(EMPTY_PROFILE);
    expect(withEcosystem(EMPTY_PROFILE, ecosystem).ecosystem).toEqual(ecosystem);
  });

  it("is carried through readiness unscored, and absent when the profile has none", () => {
    const agentSafety = { sources: [], findings: [] };
    const without = computeReadinessScore(EMPTY_PROFILE, { agentSafety });
    const withIt = computeReadinessScore(withEcosystem(EMPTY_PROFILE, ecosystem), { agentSafety });
    expect("ecosystem" in without).toBe(false);
    expect(withIt.ecosystem).toEqual(ecosystem);
    expect(withIt.overall).toBe(without.overall);
  });

  it("survives the profile's schema, which rejects a malformed histogram or count", () => {
    const checked = validate(SdlcProfileSchema, withEcosystem(EMPTY_PROFILE, ecosystem));
    expect(checked.ok && checked.data.ecosystem).toEqual(ecosystem);
    const bad = { ...EMPTY_PROFILE, ecosystem: { php: { versionFloors: { files: 1, floors: { "eight": 1 }, none: 0 } } } };
    expect(validate(SdlcProfileSchema, bad).ok).toBe(false);
    const legacy = ecosystem.php.legacyConstructs;
    const badStatus = { ...EMPTY_PROFILE, ecosystem: { php: { legacyConstructs: { ...legacy, rules: { x: { ...legacy.rules["mysql-functions"]!, status: "gone" } } } } } };
    expect(validate(SdlcProfileSchema, badStatus).ok).toBe(false);
    const badVersion = { ...EMPTY_PROFILE, ecosystem: { php: { legacyConstructs: { ...legacy, removedIn: { seven: 1 } } } } };
    expect(validate(SdlcProfileSchema, badVersion).ok).toBe(false);
    const badKinds = { ...EMPTY_PROFILE, ecosystem: { php: { dynamicCode: { ...ecosystem.php.dynamicCode, kinds: { exec: 1, dispatch: 1 } } } } };
    expect(validate(SdlcProfileSchema, badKinds).ok).toBe(false);
    const dynamic = ecosystem.php.dynamicCode;
    const badDatabase = { ...EMPTY_PROFILE, ecosystem: { php: { dynamicCode: { ...dynamic, database: { ...dynamic.database, sites: 0 } } } } };
    expect(validate(SdlcProfileSchema, badDatabase).ok).toBe(false);
  });
});
