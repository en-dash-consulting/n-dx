/**
 * Dynamic includes over `tests/fixtures/php-dynamic-includes`: paths built
 * from variables, `$_SERVER['HTTP_HOST']` and interpolated strings give no
 * edge, are counted in notices with their lines (host-based ones, inline or
 * through a variable in the include's scope, under their own code), and carry the files their literal prefix and suffix match as
 * `candidates`. Runs the pack entry; skips when the grammar is not built.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FileFacts } from "@n-dx/lang-kit";
import { createTreeSitterRunner, listFixtureFiles, skipUnlessGrammar, type PackSourceFile } from "@n-dx/lang-runtime";
import { MAX_INCLUDE_CANDIDATES, pack, PhpIncludes, phpGrammarPath, phpPack, preparePhpImports, readPhpProjectFacts } from "../../src/index.js";

const dir = join(import.meta.dirname, "..", "fixtures", "php-dynamic-includes");

async function analyze(): Promise<{
  index: FileFacts | undefined;
  boot: FileFacts | undefined;
  notices: readonly string[] | undefined;
}> {
  const files = listFixtureFiles(dir, [...phpPack.config.extensions]);
  const result = await pack.analyzeProject({ projectDir: dir, files, kinds: ["imports"] });
  expect(result.degraded).toBeUndefined();
  const facts = (path: string) => result.facts.find((f) => f.path === path);
  return { index: facts("htdocs/index.php"), boot: facts("htdocs/boot.php"), notices: result.notices };
}

describe("php dynamic includes", () => {
  it("fills candidates from the literal prefix and suffix, and never makes them edges", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const { index } = await analyze();
    expect(index?.imports?.written?.map((w) => [w.specifier, w.candidates ?? null])).toEqual([
      ["ROOT . '/config/' . $_SERVER['HTTP_HOST'] . '.php'", ["config/a.example.com.php", "config/b.example.com.php"]],
      // Relative: under the include path's `.`, the including directory.
      ['"lang/$lang.php"', ["htdocs/lang/en.php", "htdocs/lang/fr.php"]],
      ["ROOT . '/modules/' . $name . '/index.php'", ["modules/blog/index.php", "modules/shop/index.php"]],
      ["$page", null],
      // No prefix: a suffix with a `/` is searched for in the whole repository.
      ["$dir . '/index.php'", ["htdocs/index.php", "modules/blog/index.php", "modules/shop/index.php"]],
      // A bare extension constrains nothing.
      ["$name . '.php'", null],
      ["\"tenants/{$_SERVER['SERVER_NAME']}/settings.php\"", null],
      ["ROOT . '/modules/blog/index.php'", null],
    ]);
    // Only the literal include is an edge.
    expect(index?.imports?.files).toEqual([{ to: "modules/blog/index.php", symbols: ["*"] }]);
  });

  it("matches a repository-root file for a suffix starting with `/` after an unknown prefix", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const { boot } = await analyze();
    // SOME_RUNTIME_ROOT is getcwd(): not computable, so the whole repository is searched.
    expect(boot?.imports?.written?.map((w) => [w.specifier, w.candidates ?? null])).toEqual([
      ["SOME_RUNTIME_ROOT . '/includes/bootstrap.inc'", ["includes/bootstrap.inc"]],
    ]);
    expect(boot?.imports?.files ?? []).toEqual([]);
  });

  it("counts dynamic includes with their lines, host-based ones under their own code", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const { notices } = await analyze();
    expect(notices).toEqual([
      "PHP: [php-dynamic-include] 9 includes build their path at run time and give no edge: htdocs/boot.php:3, htdocs/index.php:4, htdocs/index.php:5, htdocs/index.php:6, htdocs/index.php:7, and 4 more; 6 with candidate files, never edges.",
      "PHP: [php-host-include] 5 includes choose their file by the request's host name and give no edge: htdocs/index.php:3, htdocs/index.php:9, htdocs/tenant.php:3, htdocs/tenant.php:9, htdocs/tenant.php:15; 3 with candidate files, never edges.",
    ]);
  });

  it("counts an include as host-based through a variable last assigned the host name in its scope", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const paths = listFixtureFiles(dir, [...phpPack.config.extensions]);
    const runner = createTreeSitterRunner();
    const parsed: PackSourceFile[] = [];
    try {
      for (const path of paths) {
        const result = await runner.parseFile({ pack: phpPack, grammarPath: phpGrammarPath() }, join(dir, path));
        if (result.status === "parsed") parsed.push({ path, captures: result.captures });
      }
    } finally {
      runner.dispose();
    }
    const facts = await readPhpProjectFacts(dir, paths);
    const flagged = preparePhpImports(facts.projects, parsed, [], facts)
      .includes("htdocs/tenant.php")
      .map(({ include, host }) => [include.position.line, host ?? false]);
    expect(flagged).toEqual([
      [3, true], // $host = $_SERVER['HTTP_HOST']
      // Inside a function: the file's $host, which holds the host here, is another variable.
      [5, false],
      [9, true], // $dir = $tenant = strtolower($_SERVER['SERVER_NAME'])
      [11, false], // $host reassigned from getenv()
      [15, true], // assigned the host in the function, then `.=`
      [18, false], // $_GET, not the host
    ]);
  });

  it("gives each dynamic-include site the candidates of its written include, by position", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const files = listFixtureFiles(dir, [...phpPack.config.extensions]);
    const result = await pack.analyzeProject({ projectDir: dir, files, kinds: ["imports", "dynamicCode"] });
    const index = result.facts.find((f) => f.path === "htdocs/index.php")!;
    const written = new Map(index.imports!.written!.map((w) => [`${w.position.line}:${w.position.column}`, w.candidates]));
    const sites = index.dynamicCode!.filter((f) => f.kind === "include");
    expect(sites.some((f) => f.candidates !== undefined)).toBe(true);
    for (const site of sites) {
      const listed = written.get(`${site.position.line}:${site.position.column}`);
      expect(site.candidates).toEqual(listed === undefined ? undefined : { files: listed, total: listed.length });
    }
  });

  it(`gives a site past ${MAX_INCLUDE_CANDIDATES} candidates the first ${MAX_INCLUDE_CANDIDATES} and the total`, async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const project = mkdtempSync(join(tmpdir(), "php-many-candidates-"));
    try {
      mkdirSync(join(project, "gen"));
      const pages = Array.from({ length: 60 }, (_, i) => `gen/page${String(i).padStart(2, "0")}.php`);
      for (const page of pages) writeFileSync(join(project, page), "<?php\n");
      writeFileSync(join(project, "index.php"), "<?php\ninclude __DIR__ . '/gen/page' . $n . '.php';\n");
      const result = await pack.analyzeProject({ projectDir: project, files: ["index.php", ...pages], kinds: ["imports", "dynamicCode"] });
      const index = result.facts.find((f) => f.path === "index.php")!;
      expect(index.dynamicCode!.map((f) => f.candidates)).toEqual([{ files: pages.slice(0, MAX_INCLUDE_CANDIDATES), total: 60 }]);
      expect(index.imports!.written!.map((w) => [w.candidates?.length, w.candidatesTotal])).toEqual([[MAX_INCLUDE_CANDIDATES, 60]]);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it(`lists at most ${MAX_INCLUDE_CANDIDATES} candidates and counts the rest`, () => {
    const files = new Set(Array.from({ length: 60 }, (_, i) => `gen/page${String(i).padStart(2, "0")}.php`));
    const includes = new PhpIncludes([], files, []);
    const found = includes.candidates("index.php", "__DIR__ . '/gen/page' . $n . '.php'");
    expect(found?.total).toBe(60);
    expect(found?.files).toHaveLength(MAX_INCLUDE_CANDIDATES);
    expect(found?.files[0]).toBe("gen/page00.php");
    expect(found?.files.at(-1)).toBe("gen/page49.php");
  });

  it("finds no candidates for a prefix outside the repository or a path that is computable", () => {
    const includes = new PhpIncludes([], new Set(["a/b.php"]), []);
    expect(includes.candidates("index.php", "'/usr/share/' . $x . '.php'")).toBeUndefined();
    expect(includes.candidates("index.php", "'a/b.php'")).toBeUndefined();
    expect(includes.candidates("index.php", "'a/' . $x")).toEqual({ files: ["a/b.php"], total: 1 });
  });

  it("takes no ends from a path whose top level has an operator binding more loosely than `.`", () => {
    const includes = new PhpIncludes([], new Set(["a/b.php", "c.php"]), []);
    // `('a/' . $x) ? 'c.php' : 'd.php'`: the path is 'c.php' or 'd.php', not under a/.
    expect(includes.candidates("index.php", "'a/' . $x ? 'c.php' : 'd.php'")).toBeUndefined();
    expect(includes.candidates("index.php", "'a/' . $x or die()")).toBeUndefined();
    // Inside parentheses, and in `->`, `?->` and `::`, they are part of one operand.
    expect(includes.candidates("index.php", "'a/' . ($x ?: 'b') . '.php'")).toEqual({ files: ["a/b.php"], total: 1 });
    expect(includes.candidates("index.php", "'a/' . $this?->name . '.php'")).toEqual({ files: ["a/b.php"], total: 1 });
    expect(includes.candidates("index.php", "'a/' . Config::$name . '.php'")).toEqual({ files: ["a/b.php"], total: 1 });
  });
});
