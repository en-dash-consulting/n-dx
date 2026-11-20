/**
 * `use` statements are paired with their clauses, names and aliases in one
 * sweep, so the work grows as n log n in the file's captures (#1082 P5: the
 * per-declaration scan took 7.5 s at 1,000 `use` lines, 91 s at 2,000). Work
 * is counted, not timed: every containment or order test reads a capture's
 * `start` or `end`, so those reads bound the comparisons on every machine.
 * Skips when the grammar is not built.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTreeSitterRunner, skipUnlessGrammar, type Capture, type PackSourceFile } from "@n-dx/lang-runtime";
import { phpGrammarPath, phpPack } from "../../src/index.js";
import { readWrittenImports } from "../../src/php-imports.js";
import { preparePhpImports } from "../../src/php-resolver.js";

const USES = 2_000;

/**
 * Position reads allowed per capture per log₂(captures). Measured at 2,000
 * `use` lines (8,802 captures): 2.2 for `readWrittenImports` and 4.4 for
 * `preparePhpImports`, which reads the imports twice. The per-declaration
 * scan it replaced passed this bound within its first few declarations.
 */
const READS_PER_CAPTURE_LOG = 10;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "php-use-scale-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Plain, aliased, function, const and group uses, in rotation. */
function useLine(i: number): string {
  switch (i % 5) {
    case 0:
      return `use Acme\\Lib${i}\\Thing;`;
    case 1:
      return `use Acme\\Lib${i}\\Thing as Alias${i};`;
    case 2:
      return `use function Acme\\Lib${i}\\helper;`;
    case 3:
      return `use const Acme\\Lib${i}\\LIMIT;`;
    default:
      return `use Acme\\Lib${i}\\{First, Second as Other${i}};`;
  }
}

async function parse(path: string): Promise<PackSourceFile> {
  const runner = createTreeSitterRunner();
  try {
    const result = await runner.parseFile({ pack: phpPack, grammarPath: phpGrammarPath() }, join(dir, path));
    if (result.status !== "parsed") throw new Error(`not parsed: ${result.status}`);
    return { path, captures: result.captures };
  } finally {
    runner.dispose();
  }
}

class TooMuchWork extends Error {}

/**
 * `file` with every capture counting the reads of its `start` and `end`,
 * throwing {@link TooMuchWork} past the n log n bound so a regression fails
 * at once instead of running for minutes.
 */
function counted(file: PackSourceFile): PackSourceFile {
  const captures = Object.values(file.captures).reduce((n, list) => n + list.length, 0);
  const limit = READS_PER_CAPTURE_LOG * captures * Math.log2(captures);
  let reads = 0;
  const watch = (capture: Capture): Capture =>
    new Proxy(capture, {
      get(target, key, receiver) {
        if ((key === "start" || key === "end") && ++reads > limit) {
          throw new TooMuchWork(`more than ${Math.round(limit)} position reads for ${captures} captures`);
        }
        return Reflect.get(target, key, receiver);
      },
    });
  const watched = Object.fromEntries(Object.entries(file.captures).map(([query, list]) => [query, list.map(watch)]));
  return { ...file, captures: watched };
}

describe("use statements at scale", () => {
  it(`reads ${USES} use statements in n log n position reads`, async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const lines = Array.from({ length: USES }, (_, i) => useLine(i));
    writeFileSync(join(dir, "uses.php"), ["<?php", "namespace App;", ...lines, ""].join("\n"));
    const parsed = await parse("uses.php");

    const written = readWrittenImports(counted(parsed));
    // Every fifth line is a group use with two entries.
    expect(written).toHaveLength(USES + USES / 5);
    expect(written.slice(0, 6).map((w) => [w.form, w.specifier, w.alias])).toEqual([
      ["use", "Acme\\Lib0\\Thing", undefined],
      ["use", "Acme\\Lib1\\Thing", "Alias1"],
      ["use function", "Acme\\Lib2\\helper", undefined],
      ["use const", "Acme\\Lib3\\LIMIT", undefined],
      ["use", "Acme\\Lib4\\First", undefined],
      ["use", "Acme\\Lib4\\Second", "Other4"],
    ]);

    preparePhpImports([], [counted(parsed)], []);
  });
});
