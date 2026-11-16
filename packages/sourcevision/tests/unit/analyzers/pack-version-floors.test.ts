import { describe, expect, it } from "vitest";
import type { VersionFloorFact } from "@n-dx/lang-kit";
import { packVersionFloors, withEcosystem } from "../../../src/analyzers/pack-version-floors.js";
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

describe("packVersionFloors", () => {
  it("counts a language's files by floor, oldest first, with files no rule dated and the highest floor", () => {
    const inv = inventory({ "a.php": "PHP", "b.php": "PHP", "c.php": "PHP", "d.php": "PHP", "e.php": "PHP" });
    const ecosystem = packVersionFloors(
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

  it("is undefined without facts, without floors, or for files the inventory does not list", () => {
    const inv = inventory({ "a.php": "PHP" });
    expect(packVersionFloors(undefined, inv)).toBeUndefined();
    expect(packVersionFloors([{ path: "a.php" }, { path: "a.php", routes: [] }], inv)).toBeUndefined();
    expect(packVersionFloors([{ path: "gone.php", versionFloor: floor("8.0") }], inv)).toBeUndefined();
  });

  it("leaves out a language whose files have no floor", () => {
    const inv = inventory({ "a.php": "PHP", "App.java": "Java" });
    expect(packVersionFloors([{ path: "a.php", versionFloor: floor("8.1") }, { path: "App.java" }], inv)).toEqual({
      php: { versionFloors: { files: 1, floors: { "8.1": 1 }, none: 0, highest: "8.1" } },
    });
  });
});

describe("the profile's ecosystem", () => {
  const ecosystem = { php: { versionFloors: { files: 2, floors: { "5.3": 1, "8.0": 1 }, none: 0, highest: "8.0" } } };

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

  it("survives the profile's schema, which rejects a malformed histogram", () => {
    const checked = validate(SdlcProfileSchema, withEcosystem(EMPTY_PROFILE, ecosystem));
    expect(checked.ok && checked.data.ecosystem).toEqual(ecosystem);
    const bad = { ...EMPTY_PROFILE, ecosystem: { php: { versionFloors: { files: 1, floors: { "eight": 1 }, none: 0 } } } };
    expect(validate(SdlcProfileSchema, bad).ok).toBe(false);
  });
});
