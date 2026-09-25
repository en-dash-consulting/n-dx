import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * No hench source suggests or performs an unscoped stage (WM2048, PR E).
 *
 * `git add -A` and `git add .` sweep whatever else is sitting in the working
 * tree — an operator's half-finished edit, another task's leftovers — into
 * whatever commit follows. Hench's own commits are pathspec-scoped
 * (commitPrdTreeIfStaged), its refusal messages suggest only pathspec-scoped
 * commands, and the agent prompt instructs scoped staging; this test keeps the
 * strings from growing back anywhere in src. Comment lines are skipped — the
 * history of #363 is told in comments, and telling it is not suggesting it.
 */

const SRC_ROOT = join(import.meta.dirname, "../../../src");

/** `git add -A`, or `git add .` where the dot is the whole pathspec (not `.rex/...`). */
const UNSCOPED_ADD = /git add (?:-A\b|\.(?![\w/]))/;

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (entry.endsWith(".ts")) files.push(full);
  }
  return files;
}

describe("no unscoped git add in hench source", () => {
  it("no non-comment line in packages/hench/src contains 'git add -A' or 'git add .'", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC_ROOT)) {
      const lines = readFileSync(file, "utf-8").split("\n");
      lines.forEach((line, i) => {
        const code = line.trim();
        if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
        if (UNSCOPED_ADD.test(code)) {
          offenders.push(`${file.split(/src[\\/]/)[1]}:${i + 1}: ${code.slice(0, 100)}`);
        }
      });
    }
    expect(
      offenders,
      `Unscoped git add found — use an explicit pathspec (git add -- <paths>):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
