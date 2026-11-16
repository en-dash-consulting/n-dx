/**
 * PHP through inventory and imports. Without the PHP pack, inventory.json and
 * imports.json are what they were before PHP was a pack, and the pack is only
 * suggested. With it, PHP class references resolve through the Composer
 * autoload, and literal includes to files, into edges and `php:` externals
 * beside the TypeScript ones, which
 * are unchanged, and the imports phase records PHP as analysed.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { phpConfig, type LanguagePackEntry } from "@n-dx/lang-kit";
import { analyzeImports } from "../../src/analyzers/imports.js";
import { analyzeZones } from "../../src/analyzers/zones.js";
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

/** The PHP pack's facts with every written import's `candidates` removed; `seen` counts the lists removed. */
function withoutCandidates(seen: { lists: number }): KnownPack[] {
  return KNOWN_PACKS.map((p) => {
    if (p.id !== phpConfig.id) return p;
    return {
      ...p,
      importByResolution: async () => {
        const mod = (await p.importByResolution()) as { pack: LanguagePackEntry };
        const analyzeProject: LanguagePackEntry["analyzeProject"] = async (request) => {
          const result = await mod.pack.analyzeProject(request);
          const facts = result.facts.map((f) => {
            const written = f.imports?.written;
            if (f.imports === undefined || written === undefined) return f;
            return {
              ...f,
              imports: {
                ...f.imports,
                written: written.map(({ candidates, ...w }) => {
                  if (candidates !== undefined) seen.lists++;
                  return w;
                }),
              },
            };
          });
          return { ...result, facts };
        };
        return { ...mod, pack: { ...mod.pack, analyzeProject } };
      },
    };
  });
}

describe("PHP dynamic include candidates", () => {
  const SITE: Record<string, string> = {
    "htdocs/index.php": "<?php\ninclude 'lang/' . $code . '.php';\ninclude \"modules/$name/index.php\";\ninclude 'lib/db.php';\n",
    "htdocs/lang/en.php": "<?php\n$strings = array();\n",
    "htdocs/lang/fr.php": "<?php\n$strings = array();\n",
    "htdocs/modules/blog/index.php": "<?php\necho 'blog';\n",
    "htdocs/modules/shop/index.php": "<?php\necho 'shop';\n",
    "htdocs/lib/db.php": "<?php\n$db = null;\n",
  };
  let dir: string;
  let emptyPackDir: string;
  let inventory: Inventory;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "sv-php-candidates-"));
    emptyPackDir = mkdtempSync(join(tmpdir(), "sv-php-no-packs-"));
    for (const [path, source] of Object.entries(SITE)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), source);
    }
    inventory = await analyzeInventory(dir, { languageConfig: phpConfig });
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(emptyPackDir, { recursive: true, force: true });
  });

  const run = (packs: KnownPack[]): Promise<Imports> =>
    analyzeImports(dir, inventory, { language: "php", packs: { packs, loader: { packDir: emptyPackDir }, warn: () => {} } });

  it("leaves imports.json and the zones as they are without them", async (ctx) => {
    await skipUnlessPackRuns(ctx, "php");
    const seen = { lists: 0 };
    const withThem = await run(KNOWN_PACKS.slice());
    const without = await run(withoutCandidates(seen));
    expect(seen.lists).toBe(2);
    expect(withThem.edges.map((e) => `${e.from} -> ${e.to}`)).toEqual(["htdocs/index.php -> htdocs/lib/db.php"]);
    expect(toCanonicalJSON(withThem)).toBe(toCanonicalJSON(without));
    const zonesWith = await analyzeZones(inventory, withThem, { enrich: false });
    const zonesWithout = await analyzeZones(inventory, without, { enrich: false });
    expect(toCanonicalJSON(zonesWith.zones)).toBe(toCanonicalJSON(zonesWithout.zones));
  });
});

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
    // The literal include between HTML is an edge, as is the constructor's type.
    expect(loaded.imports.edges.filter((e) => isPhp(e.from)).map((e) => `${e.from} -> ${e.to} ${e.type}`)).toEqual([
      "index.php -> lib/Db.php static",
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

describe("Drupal .module and .install files", () => {
  const MODULE = "<?php\nclass FieldException extends Exception {}\nfunction field_eval($code) {\n  return eval($code);\n}\n";
  const PHP_SITE: Record<string, string> = {
    "index.php": "<?php\nthrow new FieldException('x');\n",
    "modules/field/field.module": MODULE,
    "modules/field/field.install": "<?php\nfunction field_schema() {\n  return array();\n}\n",
  };
  const TS_SITE: Record<string, string> = {
    "package.json": '{"name": "web"}\n',
    "src/app.ts": 'import { api } from "./api";\nexport const app = api;\n',
    "src/api.ts": "export const api = 1;\n",
    "lib/field.module": MODULE,
  };
  const dirs: string[] = [];
  let emptyPackDir: string;

  async function project(files: Record<string, string>, language: "php" | "typescript") {
    const dir = mkdtempSync(join(tmpdir(), "sv-php-drupal-"));
    dirs.push(dir);
    for (const [path, source] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), source);
    }
    const inventory = await analyzeInventory(dir, language === "php" ? { languageConfig: phpConfig } : {});
    const run = (packs: KnownPack[]): Promise<Imports> =>
      analyzeImports(dir, inventory, { language, packs: { packs, loader: { packDir: emptyPackDir }, warn: () => {} } });
    return { inventory, run };
  }

  beforeAll(() => {
    emptyPackDir = mkdtempSync(join(tmpdir(), "sv-php-no-packs-"));
  });
  afterAll(() => {
    for (const dir of [...dirs, emptyPackDir]) rmSync(dir, { recursive: true, force: true });
  });

  it("in a PHP repository, are PHP and parsed: a class a .module file declares resolves to it", async (ctx) => {
    await skipUnlessPackRuns(ctx, "php");
    const { inventory, run } = await project(PHP_SITE, "php");
    expect(inventory.files.filter((f) => !f.path.endsWith(".php")).map((f) => `${f.path} ${f.language}`)).toEqual([
      "modules/field/field.install PHP",
      "modules/field/field.module PHP",
    ]);
    const imports = await run(KNOWN_PACKS.slice());
    expect(imports.edges.map((e) => `${e.from} -> ${e.to}`)).toEqual(["index.php -> modules/field/field.module"]);
    expect(imports.external.filter((e) => e.package.startsWith("php:"))).toEqual([]);
  });

  it("in a repository that is not PHP, are neither PHP nor parsed, and imports.json is unchanged", async (ctx) => {
    await skipUnlessPackRuns(ctx, "php");
    const { inventory, run } = await project(TS_SITE, "typescript");
    expect(inventory.files.map((f) => f.path)).not.toContain("lib/field.module");
    expect(inventory.summary.skippedExtensions?.[".module"]).toBe(1);
    const withPack = await run(KNOWN_PACKS.slice());
    expect(toCanonicalJSON(withPack)).toBe(toCanonicalJSON(await run(WITHOUT_PHP)));
    expect(withPack.edges.map((e) => `${e.from} -> ${e.to}`)).toEqual(["src/app.ts -> src/api.ts"]);
  });
});
