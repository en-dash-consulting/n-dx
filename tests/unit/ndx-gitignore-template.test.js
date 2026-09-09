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
 * Pinning the two files to each other is necessary but not sufficient: they
 * agree trivially when an artifact is missing from *both*, which is how
 * `.hench/session-cache.json` stayed green here while being committed on every
 * run. `HENCH_RUNTIME_GITIGNORE_ENTRIES` is a third statement of the same list
 * — the one hench's own code reads — so it is checked against both files
 * rather than left to drift alongside them.
 *
 * @see packages/hench/src/agent/lifecycle/shared.ts — the `git add -A` gate
 * @see packages/hench/src/store/artifacts.ts — the list hench itself uses
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { HENCH_RUNTIME_GITIGNORE_ENTRIES } from "../../packages/hench/src/store/artifacts.ts";

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

  it("ignores every path hench declares as its own runtime artifact", () => {
    // The list hench's gate discounts and the list `hench init` writes are the
    // same constant; both ignore files must carry it in full. Checked in this
    // direction only — the files may legitimately ignore more than the gate
    // discounts (`.hench/reviews/` does today).
    const template = runtimeEntries(TEMPLATE);
    const repo = runtimeEntries(REPO_IGNORE);
    for (const entry of HENCH_RUNTIME_GITIGNORE_ENTRIES) {
      expect(template, `${entry} missing from ndx.gitignore`).toContain(entry);
      expect(repo, `${entry} missing from this repo's .gitignore`).toContain(entry);
    }
  });
});
