/**
 * config.json through the analyze pipeline. A stand-in pack producing
 * `configReads` and `flagChecks` is asked for them in the imports phase's one
 * call, and its facts become a valid config.json. The real analyze command
 * with no producing pack writes no config.json and removes a stale one.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { phpConfig, type FileFacts, type LanguagePackEntry, type PackProjectRequest } from "@n-dx/lang-kit";
import { analyzeImports } from "../../src/analyzers/imports.js";
import { analyzeInventory } from "../../src/analyzers/inventory.js";
import { packConfigData, writeConfigData } from "../../src/analyzers/pack-config-facts.js";
import { cmdAnalyze } from "../../src/cli/commands/analyze.js";
import { KNOWN_PACKS, type KnownPack } from "../../src/language/pack-loader.js";
import { DATA_FILES } from "../../src/schema/data-files.js";
import { validateModule } from "../../src/schema/validate.js";

const PHP = KNOWN_PACKS.find((p) => p.id === phpConfig.id)!;

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "sv-config-json-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/** A PHP pack that reports one config read and one flag check per file it is sent, recording each request. */
function producingPhp(requests: PackProjectRequest[]): KnownPack {
  const entry: LanguagePackEntry = {
    packageName: PHP.packageName,
    version: JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf-8")).version,
    id: phpConfig.id,
    config: phpConfig,
    produces: ["imports", "configReads", "flagChecks"],
    analyzeProject: async (request) => {
      requests.push(request);
      const facts: FileFacts[] = request.files.map((path) => ({
        path,
        imports: { files: [], external: [] },
        configReads: [{ key: "db.host", source: "file", sourceFile: "config.php", position: { line: 2, column: 0 } }],
        flagChecks: [{ name: "FEATURE_NEW_CHECKOUT", normalized: "new_checkout", mechanism: "constant", position: { line: 3, column: 4 }, gated: { start: 4, end: 5 } }],
      }));
      return { facts, unparsed: [] };
    },
  };
  return { ...PHP, importByResolution: () => Promise.resolve({ pack: entry }) };
}

describe("config.json", () => {
  it("is built from a producing pack's facts, asked for in the imports phase's one call", async () => {
    dir = project({ "index.php": "<?php\n$h = $config['db']['host'];\nif (FEATURE_NEW_CHECKOUT) {\n  checkout();\n}\n", "cart.php": "<?php\n" });
    const inventory = await analyzeInventory(dir, { languageConfig: phpConfig });
    const requests: PackProjectRequest[] = [];
    const facts: FileFacts[] = [];
    await analyzeImports(dir, inventory, {
      language: "php",
      packs: { packs: [producingPhp(requests)], loader: { packDir: join(dir, "no-packs") }, warn: () => {}, framework: (f) => facts.push(...f) },
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].kinds).toEqual(["imports", "configReads", "flagChecks"]);

    const svDir = join(dir, ".sourcevision");
    mkdirSync(svDir, { recursive: true });
    writeConfigData(svDir, packConfigData(facts, inventory));
    const written = JSON.parse(readFileSync(join(svDir, DATA_FILES.config), "utf-8"));
    expect(validateModule("config", written).ok).toBe(true);
    expect(written.files.map((f: { file: string }) => f.file)).toEqual(["cart.php", "index.php"]);
    expect(written.flags).toEqual([
      { normalized: "new_checkout", names: ["FEATURE_NEW_CHECKOUT"], mechanisms: ["constant"], files: ["cart.php", "index.php"], checks: 2, gatedLines: 4 },
    ]);
    expect(written.keys).toEqual([{ key: "db.host", sources: ["file"], sourceFiles: ["config.php"], files: ["cart.php", "index.php"] }]);
  });

  it("is not written by analyze when no pack produces config reads or flag checks, and a stale one is removed", async () => {
    dir = project({ "package.json": "{}", "src/app.ts": "export const flag = process.env.FEATURE_X;\n" });
    const svDir = join(dir, ".sourcevision");
    mkdirSync(svDir, { recursive: true });
    writeFileSync(join(svDir, DATA_FILES.config), "{}");

    await cmdAnalyze(dir, ["--fast"]);

    expect(existsSync(join(svDir, DATA_FILES.outbound))).toBe(true);
    expect(existsSync(join(svDir, DATA_FILES.config))).toBe(false);
  }, 60_000);
});
