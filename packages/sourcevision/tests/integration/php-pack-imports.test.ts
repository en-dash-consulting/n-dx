/**
 * PHP through inventory and imports. Without the PHP pack, inventory.json and
 * imports.json are what they were before PHP was a pack, and the pack is only
 * suggested. With it, PHP class references resolve through the Composer
 * autoload into edges and `php:` externals beside the TypeScript ones, which
 * are unchanged, and the imports phase records PHP as analysed.
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
  "composer.json": '{"name": "acme/shop", "autoload": {"psr-4": {"Acme\\\\": "lib/"}}}\n',
  "index.php": "<html><body>\n<?php include 'lib/Db.php'; ?>\n</body></html>\n",
  "lib/Db.php": "<?php\nnamespace Acme;\n\nclass Db {}\n",
  "lib/Repo.php": "<?php\nnamespace Acme;\n\nuse Monolog\\Logger;\n\nclass Repo {\n  public function __construct(private Db $db, private Logger $log) {}\n}\n",
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
    expect(inventory.summary.byLanguage["PHP"]).toBe(3);
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

  it("with the workspace pack running, adds PHP edges and php: externals and leaves the others alone", async (ctx) => {
    await skipUnlessPackRuns(ctx, "php");
    const before = await imports(WITHOUT_PHP);
    const loaded = await imports(KNOWN_PACKS.slice());
    const isPhp = (path: string): boolean => path.endsWith(".php");
    // The include is reported as written, not as an edge; the constructor's type is.
    expect(loaded.imports.edges.filter((e) => isPhp(e.from)).map((e) => `${e.from} -> ${e.to} ${e.type}`)).toEqual([
      "lib/Repo.php -> lib/Db.php static",
    ]);
    expect(loaded.imports.external.filter((e) => e.package.startsWith("php:"))).toEqual([
      { package: "php:Monolog", importedBy: ["lib/Repo.php"], symbols: ["Monolog\\Logger"] },
    ]);
    expect(toCanonicalJSON(loaded.imports.edges.filter((e) => !isPhp(e.from)))).toBe(toCanonicalJSON(before.imports.edges));
    expect(toCanonicalJSON(loaded.imports.external.filter((e) => !e.package.startsWith("php:")))).toBe(toCanonicalJSON(before.imports.external));
    expect(loaded.notices).toEqual([]);
    expect(loaded.suggested).toEqual([]);
    expect(loaded.analysed).toEqual(["php"]);
  });
});
