/**
 * PHP version floors (the PHP pack's php-compat rules) through the analyze
 * pipeline: the imports phase's single pack call collects them, and they
 * become the SDLC profile's `ecosystem.php.versionFloors`, which readiness
 * carries through. Without the PHP pack the profile has no `ecosystem`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { phpConfig, type FileFacts } from "@n-dx/lang-kit";
import { analyzeImports } from "../../src/analyzers/imports.js";
import { analyzeInventory } from "../../src/analyzers/inventory.js";
import { packVersionFloors, withEcosystem } from "../../src/analyzers/pack-version-floors.js";
import { computeReadinessScore } from "../../src/analyzers/readiness-score.js";
import { buildSdlcProfile, stripSdlcProfileForDisk } from "../../src/analyzers/sdlc-profile.js";
import { KNOWN_PACKS, type KnownPack } from "../../src/language/pack-loader.js";
import type { Inventory } from "../../src/schema/v1.js";
import { SdlcProfileSchema, validate } from "../../src/schema/validate.js";
import { toCanonicalJSON } from "../../src/util/sort.js";
import { skipUnlessPackRuns } from "../helpers/workspace-pack.js";

const PHP = KNOWN_PACKS.find((p) => p.id === phpConfig.id)!;

const FILES: Record<string, string> = {
  // PHP 4 style: nothing a rule dates.
  "legacy.php": "<?php\nclass Old { var $a = array(); function Old() { $this->a = array(1); } }\n",
  "closure.php": "<?php\n$f = function ($x) { return $x; };\n",
  "short.php": "<?php\n$ids = [1, 2];\n",
  "modern.php": "<?php\nenum Suit { case Hearts; }\n",
};

const NOT_INSTALLED_PHP: KnownPack = {
  ...PHP,
  importByResolution: () =>
    Promise.reject(Object.assign(new Error("Cannot find package '@n-dx/lang-php' imported from /x.js"), { code: "ERR_MODULE_NOT_FOUND" })),
};

describe("PHP version floors in the SDLC profile and readiness", () => {
  let dir: string;
  let inventory: Inventory;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "sv-php-floors-"));
    for (const [path, text] of Object.entries(FILES)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    inventory = await analyzeInventory(dir, { languageConfig: phpConfig });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  async function profileWith(php: KnownPack | undefined) {
    const facts: FileFacts[] = [];
    await analyzeImports(dir, inventory, {
      language: "php",
      // An empty pack directory: the workspace pack, never one installed for the user.
      packs: { packs: [php ?? NOT_INSTALLED_PHP], loader: { packDir: join(dir, "no-packs") }, warn: () => {}, framework: (f) => facts.push(...f) },
    });
    return withEcosystem(await buildSdlcProfile(dir), packVersionFloors(facts, inventory));
  }

  it("counts each PHP file by its floor, and readiness carries the histogram", async (ctx) => {
    await skipUnlessPackRuns(ctx, "php");
    const profile = await profileWith(PHP);
    const expected = { php: { versionFloors: { files: 4, floors: { "5.3": 1, "5.4": 1, "8.1": 1 }, none: 1, highest: "8.1" } } };
    expect(profile.ecosystem).toEqual(expected);

    const onDisk = JSON.parse(toCanonicalJSON(stripSdlcProfileForDisk(profile)));
    const reread = validate(SdlcProfileSchema, onDisk);
    expect(reread.ok && reread.data.ecosystem).toEqual(expected);
    expect(computeReadinessScore(profile, { agentSafety: { sources: [], findings: [] } }).ecosystem).toEqual(expected);
  });

  it("leaves the profile without an ecosystem when the PHP pack is not installed", async () => {
    const profile = await profileWith(undefined);
    expect("ecosystem" in profile).toBe(false);
    expect(toCanonicalJSON(stripSdlcProfileForDisk(profile))).toBe(toCanonicalJSON(stripSdlcProfileForDisk(await buildSdlcProfile(dir))));
  });
});
