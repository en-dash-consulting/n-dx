/**
 * Generated or adversarial input nested far deeper than real PHP: an include
 * path thousands of parentheses deep, a chain of dependent `define`s, closures
 * nested thousands deep, and a resolver whose `prepare` throws. Each is given
 * up on alone, with a counted notice, and the rest of the repository's facts
 * are kept; none throws out of the pack or degrades it. Skips when the grammar
 * is not built.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FileFacts } from "@n-dx/lang-kit";
import { createPackEntry, createTreeSitterRunner, skipUnlessGrammar, type PackSourceFile } from "@n-dx/lang-runtime";
import { MAX_SCOPE_CLOSURES, PHP_DEEP_SCOPE } from "../../src/php-dynamic-code.js";
import { MAX_CONSTANT_CHAIN, MAX_PATH_NESTING, PHP_TOO_DEEP, evaluatePath, repositoryConstants, type DepthReport } from "../../src/php-includes.js";
import { PHP_PACKAGE, PHP_SYMBOL_RULES, pack, phpGrammarPath, phpPack } from "../../src/index.js";
import { phpResolver } from "../../src/php-resolver.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "php-depth-caps-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function write(files: Record<string, string>): string[] {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return Object.keys(files).sort();
}

async function parse(paths: readonly string[]): Promise<PackSourceFile[]> {
  const runner = createTreeSitterRunner();
  try {
    const parsed: PackSourceFile[] = [];
    for (const path of paths) {
      const result = await runner.parseFile({ pack: phpPack, grammarPath: phpGrammarPath() }, join(dir, path));
      if (result.status === "parsed") parsed.push({ path, captures: result.captures });
    }
    return parsed;
  } finally {
    runner.dispose();
  }
}

const edges = (facts: readonly FileFacts[], path: string): string[] => (facts.find((f) => f.path === path)?.imports?.files ?? []).map((r) => r.to);

const noticesWith = (notices: readonly string[] | undefined, code: string): string[] => (notices ?? []).filter((n) => n.includes(`[${code}]`));

/** A report that records what it is told. */
function recording(): DepthReport & { readonly expressions: string[]; readonly constants: string[] } {
  const expressions: string[] = [];
  const constants: string[] = [];
  return { expressions, constants, expression: (file) => expressions.push(file), constant: (name) => constants.push(name) };
}

/** `define('C0', 'lib'); define('C1', C0 . '');` … to `C<length>`. */
const defineChain = (length: number): string =>
  ["<?php", "define('C0', 'lib');", ...Array.from({ length }, (_, i) => `define('C${i + 1}', C${i} . '');`)].join("\n") + "\n";

describe("evaluatePath nesting cap", () => {
  const none = () => undefined;
  const nested = (depth: number) => `${"(".repeat(depth)}'b.php'${")".repeat(depth)}`;

  it(`evaluates an expression nested to the cap and gives up past it, reporting each`, () => {
    const report = recording();
    expect(evaluatePath(nested(MAX_PATH_NESTING - 1), "a.php", none, undefined, report)).toBe("b.php");
    expect(report.expressions).toEqual([]);
    expect(evaluatePath(nested(MAX_PATH_NESTING), "a.php", none, undefined, report)).toBeUndefined();
    expect(evaluatePath(nested(6000), "a.php", none, undefined, report)).toBeUndefined();
    expect(evaluatePath(`${"dirname(".repeat(6000)}__FILE__${")".repeat(6000)}`, "b.php", none, undefined, report)).toBeUndefined();
    expect(report.expressions).toEqual(["a.php", "a.php", "b.php"]);
  });
});

describe("repositoryConstants chain cap", () => {
  it(`computes a chain of ${MAX_CONSTANT_CHAIN} and gives up on a longer one, in either lookup order`, async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const sources = await parse(write({ "defs.php": defineChain(1500) }));
    const atCap = `C${MAX_CONSTANT_CHAIN - 1}`; // C0 … C31: 32 constants
    const pastCap = `C${MAX_CONSTANT_CHAIN}`;

    const headFirst = recording();
    const lookup = repositoryConstants(sources, headFirst);
    expect(lookup("C1500")).toBeUndefined();
    expect(lookup(pastCap)).toBeUndefined();
    expect(lookup(atCap)).toBe("lib");
    expect(headFirst.constants).toEqual(["C1500", pastCap]);

    // Read bottom up, each lookup is one step: the memoized chain length still stops the long ones.
    const tailFirst = recording();
    const upward = repositoryConstants(sources, tailFirst);
    for (let i = 0; i <= 1500; i += 1) upward(`C${i}`);
    expect(upward(atCap)).toBe("lib");
    expect(upward(pastCap)).toBeUndefined();
    expect(upward("C1500")).toBeUndefined();
    expect(tailFirst.constants).toContain(pastCap);
  });
});

describe("the PHP pack on input nested past its caps", () => {
  it("an include 6,000 parentheses deep gives no edge and a notice; other includes resolve", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const files = write({
      "deep.php": `<?php\ninclude ${"(".repeat(6000)}'b.php'${")".repeat(6000)};\n`,
      "a.php": "<?php\ninclude 'b.php';\n",
      "b.php": "<?php\nfunction b() {}\n",
    });
    const result = await pack.analyzeProject({ projectDir: dir, files, kinds: ["imports", "symbols"] });
    expect(result.degraded).toBeUndefined();
    expect(edges(result.facts, "a.php")).toEqual(["b.php"]);
    expect(edges(result.facts, "deep.php")).toEqual([]);
    expect(noticesWith(result.notices, PHP_TOO_DEEP)).toEqual([
      `PHP: [${PHP_TOO_DEEP}] 1 path expression nests more than ${MAX_PATH_NESTING} levels deep (in deep.php); not evaluated, so an include using one gives no edge.`,
    ]);
  });

  it("a chain of 1,500 dependent defines gives no edge through its head and a notice; a short chain resolves", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const files = write({
      "defs.php": defineChain(1500),
      "deep.php": "<?php\ninclude C1500 . '/b.php';\n",
      "short.php": "<?php\ninclude C3 . '/b.php';\n",
      "lib/b.php": "<?php\nfunction b() {}\n",
    });
    const result = await pack.analyzeProject({ projectDir: dir, files, kinds: ["imports", "symbols"] });
    expect(result.degraded).toBeUndefined();
    expect(edges(result.facts, "short.php")).toEqual(["lib/b.php"]);
    expect(edges(result.facts, "deep.php")).toEqual([]);
    const [notice] = noticesWith(result.notices, PHP_TOO_DEEP);
    expect(notice).toMatch(/constants? (is|are) defined through a chain of more than 32 constants \(C1500/);
  });

  it(`closures nested 10,000 deep keep every dynamic-code site, the deep one's scope cut at ${MAX_SCOPE_CLOSURES}`, async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const depth = 10_000;
    const files = write({
      "deep.php": `<?php\n${"$f = function () {\n".repeat(depth)}eval($code);\n${"};\n".repeat(depth)}`,
      "top.php": "<?php\nfunction run($code) {\n  eval($code);\n}\n",
    });
    const result = await pack.analyzeProject({ projectDir: dir, files, kinds: ["dynamicCode"] });
    expect(result.degraded).toBeUndefined();
    const sites = (path: string) => result.facts.find((f) => f.path === path)?.dynamicCode ?? [];
    expect(sites("top.php").map((s) => s.scope)).toEqual(["run"]);
    const [deep] = sites("deep.php");
    expect(deep?.construct).toBe("eval");
    expect(deep?.scope).toBe(`${"{closure:".repeat(MAX_SCOPE_CLOSURES)}…${"}".repeat(MAX_SCOPE_CLOSURES)}`);
    expect(noticesWith(result.notices, PHP_DEEP_SCOPE)).toEqual([
      `PHP: [${PHP_DEEP_SCOPE}] 1 site sits in closures nested more than ${MAX_SCOPE_CLOSURES} deep; its scope is named to that depth: deep.php:${depth + 2}.`,
    ]);
  });

  it(`names a scope ${MAX_SCOPE_CLOSURES} closures deep in full`, async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const files = write({
      "a.php": `<?php\nfunction outer() {\n${"$f = function () {\n".repeat(MAX_SCOPE_CLOSURES)}eval($code);\n${"};\n".repeat(MAX_SCOPE_CLOSURES)}}\n`,
    });
    const result = await pack.analyzeProject({ projectDir: dir, files, kinds: ["dynamicCode"] });
    expect(result.facts[0]?.dynamicCode?.[0]?.scope).toBe(`${"{closure:".repeat(MAX_SCOPE_CLOSURES)}outer${"}".repeat(MAX_SCOPE_CLOSURES)}`);
    expect(noticesWith(result.notices, PHP_DEEP_SCOPE)).toEqual([]);
  });
});

describe("a resolver whose prepare throws", () => {
  it("records no imports, keeps the other facts, and gives a notice naming the failure instead of degrading", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const files = write({ "index.php": "<?php\ninclude 'b.php';\neval($code);\n", "b.php": "<?php\nfunction b() {}\n" });
    const failing = createPackEntry({
      package: PHP_PACKAGE,
      pack: {
        ...phpPack,
        resolver: {
          ...phpResolver,
          forProject: undefined,
          prepare: () => {
            throw new RangeError("Maximum call stack size exceeded");
          },
        },
      },
      symbolRules: PHP_SYMBOL_RULES,
    });
    const result = await failing.analyzeProject({ projectDir: dir, files, kinds: ["imports", "symbols", "routes", "dynamicCode"] });
    expect(result.degraded).toBeUndefined();
    expect(result.facts.every((f) => f.imports === undefined)).toBe(true);
    expect(result.facts.find((f) => f.path === "b.php")?.symbols?.map((s) => s.name)).toEqual(["b"]);
    expect(result.facts.find((f) => f.path === "index.php")?.dynamicCode?.map((s) => s.construct)).toEqual(["eval"]);
    expect(result.notices).toContain(
      "PHP: import resolution failed while preparing the project (Maximum call stack size exceeded); no imports were recorded, and frameworks followed no reference.",
    );
    expect(result.notices?.some((n) => /reinstall/i.test(n))).toBe(false);
  });
});
