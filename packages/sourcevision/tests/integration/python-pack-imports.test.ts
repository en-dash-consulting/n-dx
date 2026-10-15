/**
 * Python through inventory and imports. Without the Python pack,
 * inventory.json and imports.json are what they were before Python was a
 * pack (no Python edges, externals or analysed language), and only the
 * notices differ. With it, Python edges and externals join the TypeScript
 * ones in the same imports.json.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pythonConfig } from "@n-dx/lang-kit";
import { analyzeImports } from "../../src/analyzers/imports.js";
import { analyzeInventory } from "../../src/analyzers/inventory.js";
import { KNOWN_PACKS, type KnownPack } from "../../src/language/pack-loader.js";
import type { Imports, Inventory } from "../../src/schema/v1.js";
import { toCanonicalJSON } from "../../src/util/sort.js";
import { skipUnlessPackRuns } from "../helpers/workspace-pack.js";

const FILES: Record<string, string> = {
  "pyproject.toml": '[project]\nname = "shop"\n',
  "shop/__init__.py":
    "from typing import TYPE_CHECKING\nfrom .orders import place\n\nif TYPE_CHECKING:\n    from .models import Order\n\n__all__ = [\"place\"]\n",
  "shop/orders.py":
    "import importlib\nimport requests\nfrom . import models\nfrom .models import Order\n\n" +
    "def place(name):\n    return importlib.import_module(name)\n",
  "shop/models.py": "class Order:\n    pass\n",
  "shop/models.pyi": "class Order: ...\n",
  "web/app.ts": 'import { api } from "./api";\nexport const app = api;\n',
  "web/api.ts": "export const api = 1;\n",
};

/** KNOWN_PACKS before Python was a pack. */
const WITHOUT_PYTHON: KnownPack[] = KNOWN_PACKS.filter((p) => p.id !== pythonConfig.id);

/** KNOWN_PACKS with the Python pack not installed. */
const PYTHON_MISSING: KnownPack[] = KNOWN_PACKS.map((p) =>
  p.id !== pythonConfig.id
    ? p
    : {
        ...p,
        importByResolution: () =>
          Promise.reject(Object.assign(new Error("Cannot find package '@n-dx/lang-python' imported from /x.js"), { code: "ERR_MODULE_NOT_FOUND" })),
      },
);

describe("Python files through the Python pack", () => {
  let dir: string;
  let emptyPackDir: string;
  let inventory: Inventory;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "sv-python-pack-"));
    emptyPackDir = mkdtempSync(join(tmpdir(), "sv-python-no-packs-"));
    for (const [path, source] of Object.entries(FILES)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), source);
    }
    inventory = await analyzeInventory(dir, { languageConfig: pythonConfig });
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(emptyPackDir, { recursive: true, force: true });
  });

  async function imports(packs: KnownPack[]): Promise<{ imports: Imports; notices: string[] }> {
    const notices: string[] = [];
    const result = await analyzeImports(dir, inventory, {
      language: "python",
      packs: { packs, loader: { packDir: emptyPackDir }, warn: (m) => notices.push(m) },
    });
    return { imports: result, notices };
  }

  it("lists Python in the inventory but not as an analysed language, as before", async () => {
    const before = await analyzeInventory(dir, { languageConfig: { ...pythonConfig, parseableExtensions: new Set() } });
    expect(inventory.summary.byLanguage["Python"]).toBe(4);
    expect(inventory.summary.analysedLanguages).toEqual(["TypeScript"]);
    expect(toCanonicalJSON(inventory)).toBe(toCanonicalJSON(before));
  });

  it("with the pack missing, writes the same imports as before and says how to install it", async () => {
    const before = await imports(WITHOUT_PYTHON);
    const missing = await imports(PYTHON_MISSING);
    expect(toCanonicalJSON(missing.imports)).toBe(toCanonicalJSON(before.imports));
    expect(before.imports.edges.map((e) => `${e.from} -> ${e.to}`)).toEqual(["web/app.ts -> web/api.ts"]);
    expect(missing.notices).toEqual([
      "Python: pack @n-dx/lang-python is not installed; Python files get inventory only. Install it with `ndx sv pack add python`.",
    ]);
  });

  it("with the pack loaded, records Python edges and externals beside TypeScript, and counts the dynamic import", async (ctx) => {
    await skipUnlessPackRuns(ctx, "python");
    const loaded = await imports(KNOWN_PACKS.slice());
    expect(loaded.imports.edges.map((e) => [e.from, e.to, e.type, e.symbols])).toEqual([
      // A TYPE_CHECKING-only import is a type edge; models.py wins over the stub beside it.
      ["shop/__init__.py", "shop/models.py", "type", ["Order"]],
      ["shop/__init__.py", "shop/orders.py", "static", ["place"]],
      ["shop/orders.py", "shop/models.py", "static", ["*", "Order"]],
      ["web/app.ts", "web/api.ts", "static", ["api"]],
    ]);
    expect(loaded.imports.external.map((e) => [e.package, e.importedBy])).toEqual([
      ["requests", ["shop/orders.py"]],
      ["stdlib:importlib", ["shop/orders.py"]],
      ["stdlib:typing", ["shop/__init__.py"]],
    ]);
    expect(loaded.notices).toEqual([
      "Python: 1 dynamic import names its module at run time and is not an import fact: shop/orders.py:7 (importlib.import_module).",
    ]);
  });
});
