/**
 * The pack entry's parse report (`PackProjectResult.parse`) over an invented
 * legacy project built in a temp directory: a file with syntax errors, one
 * over the runner's size limit, a latin-1 file, one with invalid UTF-8 bytes,
 * an unreadable path and a clean file. Skips when the grammar is not built.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MAX_FILE_BYTES, skipUnlessGrammar } from "@n-dx/lang-runtime";
import { pack, phpGrammarPath } from "../../src/index.js";

describe("php parse report", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "php-parse-report-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("lists syntax-error, oversized, unreadable and non-UTF-8 files, and still reads facts from the partial tree", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    writeFileSync(join(dir, "clean.php"), "<?php\nfunction ok() { return 1; }\n");
    writeFileSync(join(dir, "broken.php"), "<?php\nrequire_once 'clean.php';\nfunction kept() { return 2; }\n$z = (1 + ;\n");
    const body = "<?php\n" + "$x = 1;\n".repeat(Math.ceil(DEFAULT_MAX_FILE_BYTES / 8) + 1);
    writeFileSync(join(dir, "huge.php"), body);
    // latin-1 "café" in a string: 0xE9 alone is not UTF-8.
    writeFileSync(join(dir, "latin1.php"), Buffer.concat([Buffer.from('<?php\necho "caf'), Buffer.from([0xe9]), Buffer.from('";\n')]));
    writeFileSync(join(dir, "bytes.php"), Buffer.concat([Buffer.from("<?php\n// "), Buffer.from([0xff, 0xfe, 0xc3]), Buffer.from("\n$y = 2;\n")]));
    mkdirSync(join(dir, "dir.php")); // a path that cannot be read as a file

    const files = ["broken.php", "bytes.php", "clean.php", "dir.php", "huge.php", "latin1.php"];
    const result = await pack.analyzeProject({ projectDir: dir, files, kinds: ["imports", "symbols"] });

    expect(result.degraded).toBeUndefined();
    expect(result.parse).toEqual({
      files: 6,
      sizeLimitBytes: DEFAULT_MAX_FILE_BYTES,
      syntaxErrors: ["broken.php"],
      oversized: ["huge.php"],
      unreadable: ["dir.php"],
      notUtf8: ["bytes.php", "latin1.php"],
    });
    expect(result.unparsed).toEqual(["dir.php", "huge.php"]);
    // Never fatal: the broken file's include and symbols are still read.
    const broken = result.facts.find((f) => f.path === "broken.php");
    expect(broken?.imports?.files.map((ref) => ref.to)).toEqual(["clean.php"]);
    expect(broken?.symbols?.map((s) => s.name)).toContain("kept");
    expect(result.facts.map((f) => f.path)).toEqual(["broken.php", "bytes.php", "clean.php", "latin1.php"]);
  });

  it("reports PHP 5 brace offsets as legacy syntax and reads whole facts from the rewritten parse", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    writeFileSync(join(dir, "lib.php"), "<?php\nfunction helper($s) { return $s; }\n");
    // Short tag, brace offsets in a condition and an assignment, interpolation that must stay, then an include, a call and a class.
    const legacy = [
      "<?",
      "require_once 'lib.php';",
      "if ($name{0} == 'x') { $first = $name{1}; }",
      'echo "{$name}";',
      "class Legacy { function run($v) { return helper($v{0}); } }",
      "",
    ].join("\n");
    writeFileSync(join(dir, "legacy.php"), legacy);

    const result = await pack.analyzeProject({ projectDir: dir, files: ["legacy.php", "lib.php"], kinds: ["imports", "symbols", "calls", "legacyConstructs"] });

    expect(result.parse).toEqual({
      files: 2,
      sizeLimitBytes: DEFAULT_MAX_FILE_BYTES,
      syntaxErrors: [],
      oversized: [],
      unreadable: [],
      notUtf8: [],
      legacySyntax: [{ path: "legacy.php", constructs: { "brace-offset": 3 } }],
    });
    const facts = result.facts.find((f) => f.path === "legacy.php");
    expect(facts?.imports?.files.map((ref) => ref.to)).toEqual(["lib.php"]);
    expect(facts?.symbols?.map((s) => s.name)).toEqual(expect.arrayContaining(["Legacy", "run"]));
    expect(facts?.calls?.some((c) => c.callee === "helper")).toBe(true);
    // Positions are the source's: the method sits where it is written.
    expect(facts?.symbols?.find((s) => s.name === "run")?.position).toEqual({ line: 5, column: 24 });
    // Each brace offset counted once, the short tag once, at source positions.
    const legacyFacts = facts?.legacyConstructs ?? [];
    expect(legacyFacts.filter((f) => f.rule === "curly-offset").map((f) => f.position)).toEqual([
      { line: 3, column: 9 },
      { line: 3, column: 37 },
      { line: 5, column: 50 },
    ]);
    expect(legacyFacts.filter((f) => f.rule === "short-open-tag")).toHaveLength(1);
  });

  it("reports every list empty when every file parses cleanly", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    writeFileSync(join(dir, "a.php"), "<?php\nrequire 'b.php';\n");
    writeFileSync(join(dir, "b.php"), "<?php\n// café, valid UTF-8\nfunction b() {}\n");
    const result = await pack.analyzeProject({ projectDir: dir, files: ["a.php", "b.php"] });
    expect(result.degraded).toBeUndefined();
    expect(result.parse).toEqual({ files: 2, sizeLimitBytes: 1024 * 1024, syntaxErrors: [], oversized: [], unreadable: [], notUtf8: [] });
  });
});
