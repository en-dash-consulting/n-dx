/**
 * The shipped `ndx init` ignore template must cover what the tools write.
 *
 * `packages/core/assistant-assets/ndx.gitignore` is what users are told to
 * paste into their own `.gitignore`. Nothing derived it from the code that
 * writes the files, so it silently drifted twice: `.hench/reviews/` (the
 * review-report transport) was never added, and `.rex/prd.json.lock` outlived
 * the lock file it named. Both matter because hench's pre-run gate commits
 * with `git add -A` — an unignored runtime artifact lands in the user's repo.
 *
 * This repo dogfoods n-dx, so its own `.gitignore` is the maintained list.
 * Pinning the two to the same set of `.hench/` and `.rex/` entries catches
 * drift in either direction: a new runtime artifact ignored here but missing
 * from the template, or a template entry that no longer corresponds to
 * anything.
 *
 * @see packages/hench/src/agent/lifecycle/shared.ts — the `git add -A` gate
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const TEMPLATE = join(ROOT, "packages/core/assistant-assets/ndx.gitignore");
const REPO_IGNORE = join(ROOT, ".gitignore");

/**
 * Ignore patterns naming a `.hench/` or `.rex/` path. Comments, blank lines,
 * negations, and entries for other tools (`.sourcevision/`, `.n-dx*`) are out
 * of scope — the template deliberately differs on those (it ignores
 * `.sourcevision/`; this repo commits it).
 */
function runtimeEntries(file) {
  return new Set(
    readFileSync(file, "utf-8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^\.(hench|rex)[/-]/.test(line)),
  );
}

describe("ndx init ignore template", () => {
  it("covers the review-report transport directory", () => {
    // `.hench/reviews/<run-id>.json` — ignore the directory, not just *.json:
    // `git add -A` would still stage any other file the pass leaves there.
    expect(runtimeEntries(TEMPLATE)).toContain(".hench/reviews/");
  });

  it("names no stale lock file", () => {
    // The folder-tree lock is `.rex/prd.lock`; `prd.json.lock` is a legacy
    // name FileStore no longer writes.
    expect(readFileSync(TEMPLATE, "utf-8")).not.toContain("prd.json.lock");
  });

  it("lists the same .hench/ and .rex/ entries as this repo's .gitignore", () => {
    expect([...runtimeEntries(TEMPLATE)].sort()).toEqual(
      [...runtimeEntries(REPO_IGNORE)].sort(),
    );
  });
});
