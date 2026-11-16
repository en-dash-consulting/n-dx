/**
 * PHP version floors and legacy constructs (the PHP pack's php-compat and
 * php-legacy rules) through the analyze pipeline: the imports phase's single
 * pack call collects them, and they become the SDLC profile's
 * `ecosystem.php`, which readiness carries through. Without the PHP pack the
 * profile has no `ecosystem`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { phpConfig, type FileFacts } from "@n-dx/lang-kit";
import { analyzeImports } from "../../src/analyzers/imports.js";
import { analyzeInventory } from "../../src/analyzers/inventory.js";
import { packEcosystem, withEcosystem } from "../../src/analyzers/pack-ecosystem.js";
import { computeReadinessScore } from "../../src/analyzers/readiness-score.js";
import { buildSdlcProfile, stripSdlcProfileForDisk } from "../../src/analyzers/sdlc-profile.js";
import { KNOWN_PACKS, type KnownPack } from "../../src/language/pack-loader.js";
import type { Inventory } from "../../src/schema/v1.js";
import { SdlcProfileSchema, validate } from "../../src/schema/validate.js";
import { toCanonicalJSON } from "../../src/util/sort.js";
import { skipUnlessPackRuns } from "../helpers/workspace-pack.js";

const PHP = KNOWN_PACKS.find((p) => p.id === phpConfig.id)!;

const FILES: Record<string, string> = {
  // PHP 4 style: nothing a rule dates, and a PHP 4 constructor.
  "legacy.php": "<?php\nclass Old { var $a = array(); function Old() { $this->a = array(1); } }\n",
  "closure.php": "<?php\n$f = function ($x) { return $x; };\n",
  "short.php": "<?php\n$ids = [1, 2];\n",
  "modern.php": "<?php\nenum Suit { case Hearts; }\n",
  "db.php": "<?php\n$r = mysql_query('SELECT 1');\nwhile ($row = mysql_fetch_row($r)) { each($row); }\n",
};

const NOT_INSTALLED_PHP: KnownPack = {
  ...PHP,
  importByResolution: () =>
    Promise.reject(Object.assign(new Error("Cannot find package '@n-dx/lang-php' imported from /x.js"), { code: "ERR_MODULE_NOT_FOUND" })),
};

const MIGRATION = "https://www.php.net/manual/en/migration";

describe("PHP version floors and legacy constructs in the SDLC profile and readiness", () => {
  let dir: string;
  let inventory: Inventory;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "sv-php-ecosystem-"));
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
    return withEcosystem(await buildSdlcProfile(dir), packEcosystem(facts, inventory));
  }

  it("counts each PHP file by its floor and the repository's legacy constructs, and readiness carries both", async (ctx) => {
    await skipUnlessPackRuns(ctx, "php");
    const profile = await profileWith(PHP);
    const expected = {
      php: {
        versionFloors: { files: 5, floors: { "5.3": 1, "5.4": 1, "8.1": 1 }, none: 2, highest: "8.1" },
        legacyConstructs: {
          files: 2,
          uses: 4,
          notices: 0,
          rules: {
            each: {
              status: "removed",
              uses: 1,
              files: 1,
              deprecated: { version: "7.2", source: `${MIGRATION}72.deprecated.php` },
              removed: { version: "8.0", source: `${MIGRATION}80.incompatible.php` },
              source: `${MIGRATION}80.incompatible.php`,
            },
            "mysql-functions": {
              status: "removed",
              uses: 2,
              files: 1,
              deprecated: { version: "5.5", source: "https://www.php.net/ChangeLog-5.php#5.5.0" },
              removed: { version: "7.0", source: `${MIGRATION}70.removed-exts-sapis.php` },
              source: `${MIGRATION}70.removed-exts-sapis.php`,
            },
            "php4-constructor": {
              status: "removed",
              uses: 1,
              files: 1,
              deprecated: { version: "7.0", source: `${MIGRATION}70.deprecated.php` },
              removed: { version: "8.0", source: `${MIGRATION}80.incompatible.php` },
              source: `${MIGRATION}80.incompatible.php`,
            },
          },
          removedIn: { "7.0": 2, "8.0": 2 },
          deprecatedIn: {},
        },
      },
    };
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
