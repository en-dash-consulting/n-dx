/**
 * legacy.json through the analyze command, over the invented legacy PHP
 * estate (`tests/fixtures/php-legacy-estate/`): each PHP file's floor and
 * legacy-construct uses, summing to the SDLC profile's ecosystem written in
 * the same run, own and third-party, mirror copies left out. A run without
 * the imports phase reads the facts on demand and gets the same list. A
 * repository without such facts gets no legacy.json, and a stale one is
 * removed.
 *
 * The PHP cases skip when the PHP pack cannot run (grammar not built).
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { readImportsPackFrameworkFacts } from "../../src/analyzers/imports.js";
import { packLegacyData } from "../../src/analyzers/pack-legacy-files.js";
import { cmdAnalyze } from "../../src/cli/commands/analyze.js";
import { DATA_FILES } from "../../src/schema/data-files.js";
import type { Inventory, LegacyData, SdlcProfile } from "../../src/schema/index.js";
import { validateModule } from "../../src/schema/validate.js";
import { fileTotals, floorTotals, profileCounts } from "../helpers/legacy-totals.js";
import { skipUnlessPackRuns } from "../helpers/workspace-pack.js";

const FIXTURE = join(import.meta.dirname, "../fixtures/php-legacy-estate");

describe("legacy.json over a legacy PHP estate", { timeout: 180_000 }, () => {
  let skipped: string | undefined;
  let dir: string;
  let svDir: string;
  const json = <T>(file: string): T => JSON.parse(readFileSync(join(svDir, file), "utf-8")) as T;

  beforeAll(async () => {
    await skipUnlessPackRuns({ skip: (note) => (skipped = note ?? "PHP pack cannot run") }, "php");
    if (skipped) return;
    dir = mkdtempSync(join(tmpdir(), "sv-legacy-json-"));
    cpSync(FIXTURE, dir, { recursive: true });
    rmSync(join(dir, "README.md"));
    svDir = join(dir, ".sourcevision");
    await cmdAnalyze(dir, ["--fast"]);
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("is valid and lists the files, sorted, each use by position, with no page or code text", (ctx) => {
    if (skipped) ctx.skip(skipped);
    const legacy = json<LegacyData>(DATA_FILES.legacy);
    expect(validateModule("legacy", legacy).ok).toBe(true);
    const php = legacy.languages.php;
    const paths = php.files.map((f) => f.path);
    expect(paths).toEqual([...paths].sort());
    expect(paths.some((p) => p.startsWith("tenant-copy/"))).toBe(true);
    for (const f of [...php.files, ...(php.thirdParty ?? [])]) {
      const positions = f.constructs.map((u) => [u.line, u.column]);
      expect(positions).toEqual([...positions].sort(([la, ca], [lb, cb]) => la - lb || ca - cb));
    }
    const text = readFileSync(join(svDir, DATA_FILES.legacy), "utf-8");
    expect(text).not.toContain("https://");
    expect(text).not.toContain("SELECT");
  });

  it("sums to the profile's legacyConstructs and versionFloors, own and third-party, mirror copies left out", (ctx) => {
    if (skipped) ctx.skip(skipped);
    const php = json<LegacyData>(DATA_FILES.legacy).languages.php;
    const eco = json<SdlcProfile>(DATA_FILES.sdlcProfile).ecosystem!.php;
    expect(fileTotals(php.files)).toEqual(profileCounts(eco.legacyConstructs!));
    expect(floorTotals(php.files)).toEqual(eco.versionFloors!.floors);
    if (eco.thirdParty?.legacyConstructs) expect(fileTotals(php.thirdParty ?? [])).toEqual(profileCounts(eco.thirdParty.legacyConstructs));
    else expect(php.thirdParty?.every((f) => f.constructs.length === 0) ?? true).toBe(true);

    const inventory = json<Inventory>(DATA_FILES.inventory);
    const mirrors = new Set(inventory.files.filter((f) => f.mirrorOf !== undefined).map((f) => f.path));
    const thirdParty = new Set(inventory.files.filter((f) => f.thirdParty !== undefined).map((f) => f.path));
    for (const f of php.files) expect(mirrors.has(f.path) || thirdParty.has(f.path)).toBe(false);
    for (const f of php.thirdParty ?? []) expect(mirrors.has(f.path)).toBe(false);
  });

  it("is what a run without the imports phase builds from facts read on demand", async (ctx) => {
    if (skipped) ctx.skip(skipped);
    const inventory = json<Inventory>(DATA_FILES.inventory);
    expect(packLegacyData(await readImportsPackFrameworkFacts(dir, inventory), inventory)).toEqual(json(DATA_FILES.legacy));
  });
});

describe("legacy.json without legacy-construct or version-floor facts", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("is not written, and a stale one is removed", async () => {
    dir = mkdtempSync(join(tmpdir(), "sv-legacy-json-none-"));
    writeFileSync(join(dir, "package.json"), "{}");
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src/app.ts"), "export const x = 1;\n");
    const svDir = join(dir, ".sourcevision");
    mkdirSync(svDir, { recursive: true });
    writeFileSync(join(svDir, DATA_FILES.legacy), "{}");

    await cmdAnalyze(dir, ["--fast"]);

    expect(existsSync(join(svDir, DATA_FILES.sdlcProfile))).toBe(true);
    expect(existsSync(join(svDir, DATA_FILES.legacy))).toBe(false);
  }, 60_000);
});
