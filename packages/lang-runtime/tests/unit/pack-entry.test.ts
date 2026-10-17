/**
 * The tree-sitter pack entry's degrade paths that need no real grammar, and
 * where a pack package's assets live. The paths that do (a query the grammar
 * rejects, unreadable build files, facts from real files) are tested in the
 * Java and Go packs.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { goConfig, isLanguagePackEntry } from "@n-dx/lang-kit";
import { createPackEntry } from "../../src/pack-entry.js";
import { factGaps } from "../../src/pack-facts.js";
import { packPackage, type PackPackage } from "../../src/pack-package.js";
import type { LanguagePack } from "../../src/pack.js";

const pack: LanguagePack = {
  id: "go",
  config: goConfig,
  grammar: { name: "tree-sitter-fake", version: "1.2.3" },
  queries: [],
  produces: ["imports"],
  resolver: { prepare: () => ({ resolve: () => ({ files: [], external: [] }) }) },
  provenance: {},
};

describe("packPackage", () => {
  let packages: string;
  let root: string;
  beforeEach(() => {
    packages = mkdtempSync(join(tmpdir(), "lang-runtime-pkg-"));
    root = join(packages, "lang-fake");
    mkdirSync(root);
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "@n-dx/lang-fake", version: "4.5.6" }));
  });
  afterEach(() => rmSync(packages, { recursive: true, force: true }));

  it("reads its version and places its grammar and queries under its root", () => {
    const pkg = packPackage("@n-dx/lang-fake", () => root);
    expect(pkg.version()).toBe("4.5.6");
    expect(pkg.grammarDir()).toBe(join(root, "build", "grammars"));
    expect(pkg.queryDir("fake")).toBe(join(root, "queries", "fake"));
  });

  it("names the pack's own build:grammars script in the source checkout", () => {
    mkdirSync(join(packages, "lang-runtime", "scripts"), { recursive: true });
    writeFileSync(join(packages, "lang-runtime", "scripts", "build-grammars.mjs"), "");
    const pkg = packPackage("@n-dx/lang-fake", () => root);
    expect(pkg.missingGrammarStep()).toBe("Build it with `pnpm --filter @n-dx/lang-fake build:grammars` in the n-dx checkout.");
    expect(pkg.rebuildStep()).toBe(
      "Rebuild it with `pnpm --filter @n-dx/lang-fake build:grammars` in the n-dx checkout, or reinstall @n-dx/lang-fake.",
    );
  });

  it("calls an installed pack without its grammar incomplete, pointing at no build script", () => {
    const pkg = packPackage("@n-dx/lang-fake", () => root);
    expect(pkg.missingGrammarStep()).toBe(
      "Published @n-dx/lang-fake ships this grammar, so this install is incomplete: reinstall @n-dx/lang-fake.",
    );
  });
});

describe("createPackEntry", () => {
  let root: string;
  let pkg: PackPackage;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lang-runtime-entry-"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "4.5.6" }));
    writeFileSync(join(root, "a.go"), "package a\n");
    pkg = packPackage("@n-dx/lang-fake", () => root);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("is a lang-kit pack entry carrying the pack's language and its package", () => {
    const entry = createPackEntry({ package: pkg, pack });
    expect(isLanguagePackEntry(entry)).toBe(true);
    expect(entry).toMatchObject({ packageName: "@n-dx/lang-fake", version: "4.5.6", id: "go", config: goConfig, produces: ["imports"] });
  });

  it("reports a grammar that is not built as degraded, naming where it was expected and how to build it", async () => {
    const result = await createPackEntry({ package: pkg, pack }).analyzeProject({ projectDir: root, files: ["a.go"] });
    expect(result).toEqual({
      facts: [],
      unparsed: [],
      degraded: {
        reason: `grammar tree-sitter-fake@1.2.3 is not built (expected ${join(root, "build", "grammars", "tree-sitter-fake.wasm")})`,
        remedy: "Published @n-dx/lang-fake ships this grammar, so this install is incomplete: reinstall @n-dx/lang-fake.",
      },
    });
  });

  it("reports a grammar that will not load as degraded, naming its path, without throwing", async () => {
    mkdirSync(pkg.grammarDir(), { recursive: true });
    const grammarPath = join(pkg.grammarDir(), "tree-sitter-fake.wasm");
    writeFileSync(grammarPath, "not a wasm module");
    const result = await createPackEntry({ package: pkg, pack }).analyzeProject({ projectDir: root, files: ["a.go"] });
    expect(result.facts).toEqual([]);
    expect(result.degraded?.reason).toContain(`grammar ${grammarPath} could not be loaded (`);
    expect(result.degraded?.remedy).toBe(pkg.rebuildStep());
  });
});

describe("factGaps", () => {
  const resourcesPack: LanguagePack = { id: "go", config: goConfig, grammar: pack.grammar, queries: [], produces: ["resources"], provenance: {} };

  it("names a kind no single file answers when the pack has no project facts reader", () => {
    expect(factGaps(resourcesPack, undefined)).toEqual(['produces "resources" but has no project facts reader']);
  });

  it("is empty once the pack has a project facts reader", () => {
    expect(factGaps(resourcesPack, undefined, () => new Map())).toEqual([]);
  });
});
