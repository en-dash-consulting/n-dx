/**
 * PHP through inventory and imports. Without the PHP pack, inventory.json and
 * imports.json are what they were before PHP was a pack, and the pack is only
 * suggested. With it, imports.json is the same too: the pack reports PHP
 * imports as written and resolves none, so it adds no edge and no external
 * package; the imports phase records PHP as analysed.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { phpConfig } from "@n-dx/lang-kit";
import { analyzeImports } from "../../src/analyzers/imports.js";
import { analyzeInventory, withPackAnalysedLanguages } from "../../src/analyzers/inventory.js";
import { KNOWN_PACKS, type KnownPack } from "../../src/language/pack-loader.js";
import type { Imports, Inventory } from "../../src/schema/v1.js";
import { toCanonicalJSON } from "../../src/util/sort.js";
import { skipUnlessPackRuns } from "../helpers/workspace-pack.js";

const FILES: Record<string, string> = {
  "composer.json": '{"name": "acme/shop"}\n',
  "index.php": "<html><body>\n<?php include 'lib/db.php'; ?>\n</body></html>\n",
  "lib/db.php": "<?php\nnamespace Acme;\n\nfunction db() { return null; }\n",
  "web/app.ts": 'import { api } from "./api";\nexport const app = api;\n',
  "web/api.ts": "export const api = 1;\n",
};

/** KNOWN_PACKS before PHP was a pack. */
const WITHOUT_PHP: KnownPack[] = KNOWN_PACKS.filter((p) => p.id !== phpConfig.id);

/** KNOWN_PACKS with the PHP pack not installed. */
const PHP_MISSING: KnownPack[] = KNOWN_PACKS.map((p) =>
  p.id !== phpConfig.id
    ? p
    : {
        ...p,
        importByResolution: () =>
          Promise.reject(Object.assign(new Error("Cannot find package '@n-dx/lang-php' imported from /x.js"), { code: "ERR_MODULE_NOT_FOUND" })),
      },
);

describe("PHP files with the PHP pack registered", () => {
  let dir: string;
  let emptyPackDir: string;
  let inventory: Inventory;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "sv-php-pack-"));
    emptyPackDir = mkdtempSync(join(tmpdir(), "sv-php-no-packs-"));
    for (const [path, source] of Object.entries(FILES)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), source);
    }
    inventory = await analyzeInventory(dir, { languageConfig: phpConfig });
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(emptyPackDir, { recursive: true, force: true });
  });

  async function imports(packs: KnownPack[]): Promise<{ imports: Imports; notices: string[]; analysed: string[]; suggested: string[] }> {
    const notices: string[] = [];
    const analysed: string[] = [];
    const suggested: string[] = [];
    const result = await analyzeImports(dir, inventory, {
      language: "php",
      packs: {
        packs,
        loader: { packDir: emptyPackDir },
        warn: (m) => notices.push(m),
        analysed: (id) => analysed.push(id),
        suggest: (id) => suggested.push(id),
      },
    });
    return { imports: result, notices, analysed, suggested };
  }

  it("lists PHP in the inventory but not as an analysed language", () => {
    expect(inventory.summary.byLanguage["PHP"]).toBe(2);
    expect(inventory.summary.analysedLanguages).toEqual(["TypeScript"]);
  });

  it("with the pack missing and not listed, writes the same imports as before and only suggests the pack", async () => {
    const before = await imports(WITHOUT_PHP);
    const missing = await imports(PHP_MISSING);
    expect(toCanonicalJSON(missing.imports)).toBe(toCanonicalJSON(before.imports));
    expect(before.imports.edges.map((e) => `${e.from} -> ${e.to}`)).toEqual(["web/app.ts -> web/api.ts"]);
    expect(missing.notices).toEqual([]);
    expect(missing.suggested).toEqual(["php"]);
    expect(missing.analysed).toEqual([]);
    expect(withPackAnalysedLanguages(inventory.summary, missing.analysed)).toBe(inventory.summary);
  });

  it("with the workspace pack running, writes the same imports: PHP imports are read as written, never as edges", async (ctx) => {
    await skipUnlessPackRuns(ctx, "php");
    const before = await imports(WITHOUT_PHP);
    const loaded = await imports(KNOWN_PACKS.slice());
    expect(toCanonicalJSON(loaded.imports)).toBe(toCanonicalJSON(before.imports));
    expect(loaded.notices).toEqual([]);
    expect(loaded.suggested).toEqual([]);
    expect(loaded.analysed).toEqual(["php"]);
  });
});
