/**
 * No tracked source file may contain a NUL byte.
 *
 * A NUL inside a string literal is legal JavaScript and runs correctly — it is
 * a reasonable separator for a composite map key, since it cannot occur in an
 * identifier. What it costs is review: git's binary heuristic keys on NUL, so
 * a file holding one is classified binary, `git diff` and `git show` print
 * "Bin 19681 bytes", and GitHub renders "Binary file not shown". Roughly a
 * thousand lines of new analysis code reached a pull request that way before
 * this guard existed, and nothing caught it — not the type checker, not the
 * 1,928 tests over those same modules, because the program is correct. The only
 * symptom is a reviewer seeing nothing.
 *
 * The escape is the identical string at runtime and leaves the file text, so
 * the fix never changes behaviour.
 *
 * Deliberately NUL only. Other control bytes do not trigger the heuristic and
 * have legitimate uses here: `merge-history.ts` splits git output on the ASCII
 * record and field separators, and `setup-color-env.js` carries ANSI escapes
 * because colour is what it tests. Widening this to all control characters
 * flags those and teaches people to ignore it.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = join(import.meta.dirname, "../..");

/** Extensions worth scanning: text we author, not fixtures or binaries. */
const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/**
 * Files allowed to hold a NUL byte. Empty, and meant to stay that way.
 *
 * It held four entries when this guard shipped — each a separator in a
 * template literal or a `split()`, each correct at runtime, each in a package
 * other than the one that added the guard. All four are now written as the
 * escape and the set is empty, so a new entry is not a grandfathered case: it
 * is a decision to make a file unreviewable, and needs saying out loud.
 */
const KNOWN = new Set([]);

/** Everything git tracks, which is narrower and faster than walking the tree. */
function trackedSourceFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf-8" });
  return out.split("\0").filter((p) => p && SOURCE.test(p));
}

const hasNul = (rel) => readFileSync(join(ROOT, rel)).includes(0);

describe("tracked source holds no NUL byte", () => {
  const files = trackedSourceFiles();

  it("scans a plausible number of files, so the assertion is not vacuous", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("finds no NUL outside the known list", () => {
    const offenders = files.filter((rel) => !KNOWN.has(rel) && hasNul(rel));
    expect(
      offenders,
      "These files hold a NUL byte, so git treats them as binary and their " +
        "diffs cannot be reviewed. Write the character as an escape instead — " +
        "it is the same string at runtime.",
    ).toEqual([]);
  });

  it("keeps the known list accurate, so it cannot outlive the defect", () => {
    expect(
      [...KNOWN].filter((rel) => !files.includes(rel)),
      "Allowlisted paths that are no longer tracked — drop them from KNOWN.",
    ).toEqual([]);
    expect(
      [...KNOWN].filter((rel) => files.includes(rel) && !hasNul(rel)),
      "Allowlisted files that no longer hold a NUL — drop them from KNOWN.",
    ).toEqual([]);
  });
});
