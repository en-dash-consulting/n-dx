/**
 * The pull-request markdown pipeline reads the PRD through rex, never from a
 * legacy file of its own.
 *
 * `.rex/prd.md` and `.rex/prd.json` are formats a folder-tree or v2 project
 * does not have, and every read in this pipeline is wrapped in a `catch` that
 * returns "no PRD" — so a module that goes back to parsing one reports an
 * empty Completed Work section instead of failing, which is how the defect
 * went unnoticed the first time. The guard is on the source rather than on
 * behaviour for the same reason: an absent read has no output to assert on.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = resolve(import.meta.dirname, "../../../src");

/** The modules `sv pr` reaches for PRD content. */
const PR_MARKDOWN_SOURCES = [
  "cli/commands/pr-markdown.ts",
  "cli/commands/prd-epic-resolver.ts",
  "analyzers/branch-work-collector.ts",
];

/** Source with block and line comments removed, so a prose mention is not a hit. */
function code(relativePath: string): string {
  return readFileSync(resolve(SRC, relativePath), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("pr-markdown PRD reads", () => {
  it.each(PR_MARKDOWN_SOURCES)("%s names no legacy PRD file", (relativePath) => {
    expect(code(relativePath)).not.toMatch(/prd\.(md|json)/);
  });

  it("the epic resolver reads the PRD through the rex spawn seam", () => {
    expect(code("cli/commands/prd-epic-resolver.ts")).toContain("readPRDViaRex");
  });
});
