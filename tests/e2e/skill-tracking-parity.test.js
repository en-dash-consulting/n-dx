/**
 * Skill git-tracking parity — GitHub #284.
 *
 * The generated Codex skills (`.agents/skills/`) were committed while the
 * generated Claude skills (`.claude/skills/`) were gitignored, so a cloned
 * checkout had the Codex `ndx-*` skills but not the Claude ones until
 * `ndx init` was re-run. This test locks in the "commit both" resolution:
 *
 *   1. Repo invariant — every generated skill file is git-tracked for BOTH
 *      vendors, so clones get `/ndx-*` out of the box.
 *   2. Hint behavior — `checkSkillTracking()` warns when an enabled vendor's
 *      skill directory is gitignored (the regression that caused #284), and
 *      stays silent otherwise.
 *
 * @see packages/core/assistant-integration.js — checkSkillTracking
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getVendors,
  getVendorTarget,
  getSkillNames,
} from "../../packages/core/assistant-assets.js";
import { checkSkillTracking } from "../../packages/core/assistant-integration.js";

const ROOT = join(import.meta.dirname, "../..");
const VENDORS = Object.keys(getVendors());
const SKILLS = getSkillNames();

/** True when `relPath` is tracked by git in `cwd`. */
function isTracked(cwd, relPath) {
  const out = execFileSync("git", ["ls-files", "--", relPath], {
    cwd,
    encoding: "utf-8",
  });
  return out.trim().length > 0;
}

// ── Repo invariant: generated skills are committed for both vendors ──────────

describe("generated skills are git-tracked for every vendor (#284)", () => {
  for (const vendor of VENDORS) {
    const target = getVendorTarget(vendor);
    for (const name of SKILLS) {
      const relPath = join(target.skillDir, name, target.skillFile).replace(/\\/g, "/");
      it(`${relPath} is committed`, () => {
        expect(
          isTracked(ROOT, relPath),
          `${relPath} is not git-tracked. Generated skills must be committed for both ` +
            `assistants (#284) so cloned checkouts have /ndx-* without re-running 'ndx init'. ` +
            `Check that ${target.skillDir}/ is not gitignored.`,
        ).toBe(true);
      });
    }
  }
});

// ── Hint behavior: checkSkillTracking warns on the #284 regression ───────────

describe("checkSkillTracking()", () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "skill-tracking-"));
    execFileSync("git", ["init"], { cwd: dir });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("returns no hints when no skill directory is gitignored (healthy state)", () => {
    expect(checkSkillTracking(dir)).toEqual([]);
  });

  it("warns when the Claude skill directory is gitignored (the #284 regression)", () => {
    writeFileSync(join(dir, ".gitignore"), ".claude/skills/\n");
    const hints = checkSkillTracking(dir);
    expect(hints.length).toBe(1);
    expect(hints[0]).toContain(".claude/skills/");
    expect(hints[0]).toContain("gitignored");
  });

  it("does not warn about a vendor that is disabled", () => {
    writeFileSync(join(dir, ".gitignore"), ".claude/skills/\n");
    expect(checkSkillTracking(dir, { claude: false })).toEqual([]);
  });

  it("warns per-vendor when both skill directories are gitignored", () => {
    const dirs = VENDORS.map((v) => getVendorTarget(v).skillDir);
    writeFileSync(join(dir, ".gitignore"), dirs.map((d) => `${d}/`).join("\n") + "\n");
    expect(checkSkillTracking(dir).length).toBe(VENDORS.length);
  });

  it("is a silent no-op outside a git repository", () => {
    const nonRepo = mkdtempSync(join(tmpdir(), "non-repo-"));
    mkdirSync(join(nonRepo, ".claude"), { recursive: true });
    try {
      expect(checkSkillTracking(nonRepo)).toEqual([]);
    } finally {
      rmSync(nonRepo, { recursive: true, force: true });
    }
  });
});
