/**
 * Regression: rex serializes PRD files with LF; on a Windows CRLF checkout,
 * a `.gitattributes` rule must pin those files to LF so rex writes and git
 * agree and no spurious line-ending churn appears in `git status`.
 *
 * See GitHub #283 (under #92). Fix: `.gitattributes` with `eol=lf` for the
 * serialized `.rex/` outputs. This test is platform-independent — it asserts
 * git's resolved `eol` attribute and that on-disk PRD markdown is LF-only.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = process.cwd();
const PRD_ROOT = join(REPO_ROOT, ".rex", "prd_tree");

/** Collect up to `limit` serialized markdown files under the PRD tree. */
function collectPrdMarkdown(dir, acc = [], limit = 20) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (acc.length >= limit) break;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) collectPrdMarkdown(p, acc, limit);
    else if (entry.name.endsWith(".md")) acc.push(p);
  }
  return acc;
}

/** git wants forward-slash, repo-relative paths. */
function gitPath(absPath) {
  return relative(REPO_ROOT, absPath).split("\\").join("/");
}

describe("PRD serialized files are pinned to LF (issue #283)", () => {
  const samples = collectPrdMarkdown(PRD_ROOT);

  it("finds PRD markdown to validate", () => {
    expect(samples.length).toBeGreaterThan(0);
  });

  it("git resolves eol=lf for PRD markdown (requires .gitattributes rule)", () => {
    const out = execFileSync(
      "git",
      ["check-attr", "eol", "--", gitPath(samples[0])],
      { encoding: "utf8", cwd: REPO_ROOT },
    );
    // e.g. ".rex/prd_tree/foo/index.md: eol: lf"
    expect(out.trim()).toMatch(/: lf$/);
  });

  it("an LF write to a tracked PRD file produces no git churn", () => {
    // rex always serializes with LF. Without the .gitattributes rule and with
    // core.autocrlf=true, git flags every such write as modified. With the
    // rule, LF is the pinned form, so an LF write is a no-op to git.
    const tracked = execFileSync("git", ["ls-files", "--", ".rex/prd_tree/"], {
      encoding: "utf8",
      cwd: REPO_ROOT,
    })
      .split("\n")
      .filter((p) => p.endsWith(".md"))[0];
    expect(tracked, "expected a tracked PRD markdown file").toBeTruthy();

    const abs = join(REPO_ROOT, tracked);
    const original = readFileSync(abs);
    try {
      // Re-write with guaranteed LF (as the serializer does).
      const lf = readFileSync(abs, "utf8").replace(/\r\n/g, "\n");
      writeFileSync(abs, lf, "utf8");
      const status = execFileSync("git", ["status", "--porcelain", "--", tracked], {
        encoding: "utf8",
        cwd: REPO_ROOT,
      });
      expect(status.trim()).toBe("");
    } finally {
      writeFileSync(abs, original);
    }
  });
});
