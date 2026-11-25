/**
 * PHP CLI and cron entry points (the PHP pack's php-entry rules) through the
 * analyze pipeline: the imports phase's single pack call collects them and
 * the classifications phase marks each file `entrypoint` with `pack`
 * evidence, a cron job's schedule in its detail and its `schedule` field. Without the PHP pack,
 * classifications.json is what the path signals alone produce.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { phpConfig, type FileFacts } from "@n-dx/lang-kit";
import { analyzeClassifications } from "../../src/analyzers/classify.js";
import { analyzeImports } from "../../src/analyzers/imports.js";
import { analyzeInventory } from "../../src/analyzers/inventory.js";
import { packEntryPointSignals } from "../../src/analyzers/pack-framework-facts.js";
import { KNOWN_PACKS, type KnownPack } from "../../src/language/pack-loader.js";
import type { Inventory } from "../../src/schema/v1.js";
import { ClassificationsSchema } from "../../src/schema/validate.js";
import { toCanonicalJSON } from "../../src/util/sort.js";
import { skipUnlessPackRuns, workspacePack } from "../helpers/workspace-pack.js";

const PHP = KNOWN_PACKS.find((p) => p.id === phpConfig.id)!;

const FILES: Record<string, string> = {
  "index.php": "<?php\necho 'home';\n",
  "tools/migrate.php": "#!/usr/bin/env php\n<?php\necho 'migrated';\n",
  "cron/cleanup.php": "<?php\nif (php_sapi_name() !== 'cli') { exit(1); }\necho 'clean';\n",
  "lib/report.php": "<?php\necho 'report';\n",
  "bin/sync.php": "<?php\necho 'synced';\n",
  crontab: "MAILTO=ops@example.com\n15 4 * * * php /var/www/app/lib/report.php\n*/5 * * * * php /app/bin/sync.php\n",
};

/** The workspace PHP pack, never one in the user's pack directory. */
const WORKSPACE_PHP: KnownPack = { ...PHP, importByResolution: async () => ({ pack: await workspacePack("php") }) };

const NOT_INSTALLED_PHP: KnownPack = {
  ...PHP,
  importByResolution: () =>
    Promise.reject(Object.assign(new Error("Cannot find package '@n-dx/lang-php' imported from /x.js"), { code: "ERR_MODULE_NOT_FOUND" })),
};

describe("PHP entry points in classifications", () => {
  let dir: string;
  let inventory: Inventory;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "sv-php-entry-"));
    for (const [path, text] of Object.entries(FILES)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    inventory = await analyzeInventory(dir, { languageConfig: phpConfig });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /** imports → classifications, as the analyze phases chain them. */
  async function pipeline(php: KnownPack) {
    const facts: FileFacts[] = [];
    const imports = await analyzeImports(dir, inventory, {
      language: "php",
      packs: { packs: [php], warn: () => {}, framework: (f) => facts.push(...f) },
    });
    const packSignals = packEntryPointSignals(facts);
    const options = { projectLanguage: "php", ...(packSignals.size > 0 ? { packSignals } : {}) };
    return { classifications: analyzeClassifications(inventory, imports, options), imports };
  }

  it("marks shebang, cli-checking and crontab-run scripts as entry points with pack evidence", async (ctx) => {
    await skipUnlessPackRuns(ctx, "php");
    const { classifications } = await pipeline(WORKSPACE_PHP);
    const entry = (path: string) => classifications.files.find((f) => f.path === path);

    expect(entry("tools/migrate.php")).toMatchObject({
      archetype: "entrypoint",
      evidence: [{ archetypeId: "entrypoint", signalKind: "pack", detail: "cli entry point: shebang (line 1)", weight: 1 }],
    });
    expect(entry("cron/cleanup.php")).toMatchObject({
      archetype: "entrypoint",
      evidence: [{ signalKind: "pack", detail: "cli entry point: PHP_SAPI check (line 2)" }],
    });
    expect(entry("lib/report.php")?.archetype).toBe("entrypoint");
    expect(entry("lib/report.php")?.evidence).toContainEqual({
      archetypeId: "entrypoint",
      signalKind: "pack",
      detail: "cron entry point: 15 4 * * * (crontab:2)",
      weight: 1,
      schedule: { expression: "15 4 * * *", file: "crontab", line: 2 },
    });
    expect(entry("index.php")?.evidence?.some((e) => e.signalKind === "pack")).not.toBe(true);
  });

  it("carries a crontab job's schedule as a structured field, and none for a CLI script", async (ctx) => {
    await skipUnlessPackRuns(ctx, "php");
    const { classifications } = await pipeline(WORKSPACE_PHP);
    const entry = (path: string) => classifications.files.find((f) => f.path === path);

    expect(entry("bin/sync.php")).toMatchObject({ archetype: "entrypoint" });
    expect(entry("bin/sync.php")?.evidence).toContainEqual({
      archetypeId: "entrypoint",
      signalKind: "pack",
      detail: "cron entry point: */5 * * * * (crontab:3)",
      weight: 1,
      schedule: { expression: "*/5 * * * *", file: "crontab", line: 3 },
    });
    expect(entry("tools/migrate.php")?.evidence?.every((e) => e.schedule === undefined)).toBe(true);
    expect(ClassificationsSchema.safeParse(classifications).success).toBe(true);
  });

  it("reclassifies an unchanged file whose pack evidence is gone", async (ctx) => {
    await skipUnlessPackRuns(ctx, "php");
    const { classifications, imports } = await pipeline(WORKSPACE_PHP);
    const again = analyzeClassifications(inventory, imports, { projectLanguage: "php", previousClassifications: classifications, changedFiles: new Set() });
    expect(toCanonicalJSON(again)).toBe(toCanonicalJSON(analyzeClassifications(inventory, imports, { projectLanguage: "php" })));
  });

  it("leaves classifications byte-identical without the PHP pack", async () => {
    const { classifications, imports } = await pipeline(NOT_INSTALLED_PHP);
    expect(toCanonicalJSON(classifications)).toBe(toCanonicalJSON(analyzeClassifications(inventory, imports, { projectLanguage: "php" })));
  });
});
