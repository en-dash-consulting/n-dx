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

import { phpConfig } from "@n-dx/lang-kit";
import { analyzeImports } from "../../src/analyzers/imports.js";
import { analyzeInventory } from "../../src/analyzers/inventory.js";
import { packEcosystem, withEcosystem } from "../../src/analyzers/pack-ecosystem.js";
import type { PackFrameworkFact } from "../../src/analyzers/pack-framework-facts.js";
import { packFrameworkFactsOf } from "../../src/analyzers/pack-imports.js";
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

// PHP 5.2 style: classes, includes and arrays, nothing a rule dates or retires.
const PHP52_FILES: Record<string, string> = {
  "index.php": "<?php\nrequire_once dirname(__FILE__) . '/lib/db.php';\n$db = new Db('shop');\necho htmlspecialchars($db->name());\n",
  "lib/db.php": "<?php\nclass Db {\n  var $name;\n  function __construct($name) { $this->name = $name; }\n  function name() { return isset($this->name) ? $this->name : array(); }\n}\n",
  "admin/page.php": "<html><body><?php include 'header.inc'; echo date('Y'); ?></body></html>\n",
};

const NOT_INSTALLED_PHP: KnownPack = {
  ...PHP,
  importByResolution: () =>
    Promise.reject(Object.assign(new Error("Cannot find package '@n-dx/lang-php' imported from /x.js"), { code: "ERR_MODULE_NOT_FOUND" })),
};

const MIGRATION = "https://www.php.net/manual/en/migration";

function writeRepository(prefix: string, files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/** The SDLC profile of `root` with the ecosystem the imports phase's pack call collects, as `analyze` builds it. */
async function profileOf(root: string, inventory: Inventory, php: KnownPack | undefined) {
  const facts: PackFrameworkFact[] = [];
  await analyzeImports(root, inventory, {
    language: "php",
    // An empty pack directory: the workspace pack, never one installed for the user.
    packs: {
      packs: [php ?? NOT_INSTALLED_PHP],
      loader: { packDir: join(root, "no-packs") },
      warn: () => {},
      framework: (f, asked) => facts.push(...packFrameworkFactsOf(f, asked)),
    },
  });
  return withEcosystem(await buildSdlcProfile(root), packEcosystem(facts, inventory));
}

describe("PHP version floors and legacy constructs in the SDLC profile and readiness", () => {
  let dir: string;
  let inventory: Inventory;

  beforeAll(async () => {
    dir = writeRepository("sv-php-ecosystem-", FILES);
    inventory = await analyzeInventory(dir, { languageConfig: phpConfig });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const profileWith = (php: KnownPack | undefined) => profileOf(dir, inventory, php);

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

describe("a PHP 5.2-style repository no syntax rule dates", () => {
  let dir: string;
  let inventory: Inventory;

  beforeAll(async () => {
    dir = writeRepository("sv-php52-ecosystem-", PHP52_FILES);
    inventory = await analyzeInventory(dir, { languageConfig: phpConfig });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("still gets the histogram: every file read, none dated, no highest floor", async (ctx) => {
    await skipUnlessPackRuns(ctx, "php");
    const profile = await profileOf(dir, inventory, PHP);
    const expected = { php: { versionFloors: { files: 3, floors: {}, none: 3 } } };
    expect(profile.ecosystem).toEqual(expected);

    const onDisk = JSON.parse(toCanonicalJSON(stripSdlcProfileForDisk(profile)));
    expect(onDisk.ecosystem).toEqual(expected);
    const reread = validate(SdlcProfileSchema, onDisk);
    expect(reread.ok && reread.data.ecosystem).toEqual(expected);
    expect(computeReadinessScore(profile, { agentSafety: { sources: [], findings: [] } }).ecosystem).toEqual(expected);
  });

  it("has no ecosystem without the PHP pack", async () => {
    const profile = await profileOf(dir, inventory, undefined);
    expect(toCanonicalJSON(stripSdlcProfileForDisk(profile))).toBe(toCanonicalJSON(stripSdlcProfileForDisk(await buildSdlcProfile(dir))));
  });
});
