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
import { closeSync, openSync, readdirSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { GITATTRIBUTES_EOL_RULES } from "../../packages/core/gitattributes-pins.js";

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

describe("other n-dx-serialized tracked files are pinned to LF", () => {
  // Representative file per tool-written surface. Every one of these is
  // rewritten by an n-dx command (hench run, sourcevision analyze, ndx
  // config, ndx init) with LF, so each needs the same eol=lf pin as .rex/.
  const surfaces = [
    ".hench/config.json",
    ".sourcevision/hints.md",
    ".sourcevision/llms.txt",
    ".n-dx.json",
    "AGENTS.md",
    "CLAUDE.md",
    ".agents/skills/ndx-work/SKILL.md",
    ".claude/skills/ndx-work/SKILL.md",
    ".codex/config.toml",
  ];

  it.each(surfaces)("git resolves eol=lf for %s", (path) => {
    const out = execFileSync("git", ["check-attr", "eol", "--", path], {
      encoding: "utf8",
      cwd: REPO_ROOT,
    });
    expect(out.trim()).toMatch(/: lf$/);
  });
});

// ── Sync guard: the injector list and the repo's own .gitattributes must not
// drift apart. The pins originally shipped incomplete precisely because these
// two sources diverged (one was updated, the other wasn't), so a per-pattern
// check isn't enough — assert the FULL pattern sets are equal.
describe("GITATTRIBUTES_EOL_RULES stays in sync with n-dx's own .gitattributes", () => {
  /**
   * Marker that ends the injector-managed region of .gitattributes. Pins below
   * it are specific to this repo's layout (shebang scripts, bin entries) and are
   * deliberately absent from GITATTRIBUTES_EOL_RULES, which `ndx init` writes
   * into consumer projects that have no such files.
   */
  const REPO_ONLY_MARKER = "# repo-only eol pins (not injected by ndx init)";

  /**
   * First-token glob pattern of each `eol=lf` line in a .gitattributes body,
   * limited to the injector-managed region above {@link REPO_ONLY_MARKER}.
   */
  function eolPatternsFromGitattributes(body) {
    const injectorRegion = body.split(REPO_ONLY_MARKER)[0];
    return injectorRegion
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("eol=lf"))
      .map((line) => line.split(/\s+/)[0]);
  }

  it("the repo-only marker is present so the guard scopes the right region", () => {
    const repoBody = readFileSync(join(REPO_ROOT, ".gitattributes"), "utf-8");
    // If the marker is renamed or dropped, eolPatternsFromGitattributes silently
    // widens to the whole file and this suite starts failing for the wrong
    // reason. Assert it explicitly so the cause is obvious.
    expect(repoBody).toContain(REPO_ONLY_MARKER);
  });

  it("the injected rule set equals the repo .gitattributes eol=lf pattern set", () => {
    const injectorPatterns = GITATTRIBUTES_EOL_RULES.map((r) => r.trim().split(/\s+/)[0]);
    const repoBody = readFileSync(join(REPO_ROOT, ".gitattributes"), "utf-8");
    const repoPatterns = eolPatternsFromGitattributes(repoBody);

    // Equality of sets — any pattern present in one source but not the other is
    // the drift this guard exists to catch. Sorted arrays give a readable diff.
    expect([...new Set(injectorPatterns)].sort()).toEqual(
      [...new Set(repoPatterns)].sort(),
    );
  });

  it("neither source has duplicate eol=lf patterns", () => {
    const injectorPatterns = GITATTRIBUTES_EOL_RULES.map((r) => r.trim().split(/\s+/)[0]);
    expect(injectorPatterns.length).toBe(new Set(injectorPatterns).size);

    const repoPatterns = eolPatternsFromGitattributes(
      readFileSync(join(REPO_ROOT, ".gitattributes"), "utf-8"),
    );
    expect(repoPatterns.length).toBe(new Set(repoPatterns).size);
  });
});

// ── Shebang files must be LF ────────────────────────────────────────────────
// A `#!...\r\n` shebang is broken two ways: Unix refuses to execute the file
// ("bad interpreter: /usr/bin/env node^M"), and vitest's module transform emits
// unparseable code for it, so any test importing such a script dies at
// collection with a locationless `SyntaxError: Invalid or unexpected token`.
// Linux CI never sees this — the index is LF — so only Windows checkouts
// (core.autocrlf=true) hit it. These assertions are platform-independent: they
// read git's resolved attribute, not the working-tree bytes.
describe("hashbang-bearing tracked files are pinned to LF", () => {
  /** Tracked files whose first two bytes are `#!`. */
  function trackedShebangFiles() {
    const tracked = execFileSync("git", ["ls-files"], {
      encoding: "utf8",
      cwd: REPO_ROOT,
      maxBuffer: 32 * 1024 * 1024,
    })
      .split("\n")
      .filter(Boolean);

    return tracked.filter((rel) => {
      try {
        // Read the first two bytes only — cheaper than loading every file, and
        // avoids one git process per file (which is too slow for a test).
        const fd = openSync(join(REPO_ROOT, rel), "r");
        try {
          const buf = Buffer.alloc(2);
          readSync(fd, buf, 0, 2, 0);
          return buf[0] === 0x23 && buf[1] === 0x21; // "#!"
        } finally {
          closeSync(fd);
        }
      } catch {
        return false; // unreadable or deleted in the working tree
      }
    });
  }

  const shebangFiles = trackedShebangFiles();

  it("finds hashbang files to validate", () => {
    expect(shebangFiles.length).toBeGreaterThan(0);
  });

  it("git resolves eol=lf for every hashbang file", () => {
    // One batched check-attr call: `--stdin` reads the whole path list at once.
    const out = execFileSync("git", ["check-attr", "eol", "--stdin"], {
      encoding: "utf8",
      cwd: REPO_ROOT,
      input: shebangFiles.join("\n"),
      maxBuffer: 32 * 1024 * 1024,
    });

    const unpinned = out
      .split("\n")
      .filter((line) => line.trim() && !line.endsWith(": lf"))
      .map((line) => line.split(":")[0]);

    expect(
      unpinned,
      "add an eol=lf pin in .gitattributes for these shebang files — a CRLF " +
        "shebang breaks Unix execution and vitest's transform",
    ).toEqual([]);
  });
});
