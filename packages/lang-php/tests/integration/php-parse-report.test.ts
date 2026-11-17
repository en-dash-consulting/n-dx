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

  it("has no parse report when every file parses cleanly", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    writeFileSync(join(dir, "a.php"), "<?php\nrequire 'b.php';\n");
    writeFileSync(join(dir, "b.php"), "<?php\n// café, valid UTF-8\nfunction b() {}\n");
    const result = await pack.analyzeProject({ projectDir: dir, files: ["a.php", "b.php"] });
    expect(result.degraded).toBeUndefined();
    expect(result).not.toHaveProperty("parse");
  });
});
