/**
 * An architecture gate that cannot run must say so, not report success.
 *
 * `architecture-policy.test.js` opened ten of its cases with
 * `if (!existsSync(x)) return;`. A bare `return` inside `it()` is a **pass** —
 * so the zone cohesion gate reported green in CI while checking nothing:
 * `.sourcevision/*` is gitignored (only `.gitignore` and `hints.md` are
 * tracked) and no CI step runs `ndx analyze`, so its input never exists there.
 * It only ever failed on a developer machine that had analysed locally, which
 * is how a `hench-agent` zone at cohesion 0.25 sat unnoticed.
 *
 * The two kinds of missing input need opposite treatment, and lumping them
 * together is what hid the problem:
 *
 *   - A **gitignored analysis artifact** is legitimately absent. The gate
 *     cannot run, and must be reported skipped.
 *   - A **committed source path** is not legitimately absent. If
 *     `packages/rex/src/core` or a file named in a boundary declaration has
 *     gone missing, the gate silently stopping is itself the bug — the
 *     declaration is stale. That must fail.
 *
 * This guard pins both, because the failure mode it protects against is
 * invisible by construction: nothing goes red when a gate quietly stops
 * checking.
 *
 * @see tests/e2e/architecture-policy.test.js
 * @see TESTING.md — "Assume the vacuous pass is there too"
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const GATE_FILE = join(import.meta.dirname, "../e2e/architecture-policy.test.js");
const SRC = readFileSync(GATE_FILE, "utf-8");

/**
 * Line numbers (1-based) of every early `return` guarded by `existsSync`.
 *
 * Both spellings count. The braced form —
 *
 *     if (!existsSync(zonesPath)) {
 *       // Skip if sourcevision hasn't been run yet
 *       return;
 *     }
 *
 * — is the one that hid longest, because its comment claims a skip while the
 * `return` reports a pass. A single-line matcher misses it.
 */
function silentReturns() {
  const hits = [];
  const lines = SRC.split("\n");
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!/if\s*\(!existsSync\(/.test(t)) return;
    // Same line: `if (!existsSync(x)) return;` with an optional comment.
    if (/\)\s*return\s*;?\s*(\/\/.*)?$/.test(t)) {
      hits.push(i + 1);
      return;
    }
    // Braced: scan the block for a bare `return`.
    if (t.endsWith("{")) {
      for (let j = i + 1; j < lines.length && !lines[j].trim().startsWith("}"); j++) {
        if (/^return\s*;?$/.test(lines[j].trim())) {
          hits.push(i + 1);
          break;
        }
      }
    }
  });
  return hits;
}

describe("architecture gates report honestly when they cannot run", () => {
  it("no gate returns silently on a missing input", () => {
    const hits = silentReturns();
    expect(
      hits,
      `architecture-policy.test.js returns early — which vitest counts as a ` +
        `pass — at line(s) ${hits.join(", ")}. A gate that cannot run must ` +
        `call ctx.skip(reason); a gate whose input should exist must fail.`,
    ).toEqual([]);
  });

  it("gates over gitignored analysis artifacts skip with a reason", () => {
    // One per .sourcevision-dependent gate: zones.json x2, zones/ x2.
    const skips = SRC.match(/ctx\.skip\(/g) ?? [];
    expect(
      skips.length,
      "expected each .sourcevision-dependent gate to call ctx.skip(reason)",
    ).toBeGreaterThanOrEqual(4);
  });

  it("has a skip for every guarded analysis artifact", () => {
    // The paths reach existsSync through a local, so match the assignment and
    // then confirm that variable is what gets guarded. Counting the literals
    // directly would find nothing and pass vacuously.
    const guarded = [];
    for (const m of SRC.matchAll(/const\s+(\w+)\s*=\s*join\(ROOT,\s*"\.sourcevision\/[^"]*"\)/g)) {
      const [, name] = m;
      if (new RegExp(`existsSync\\(${name}\\)`).test(SRC)) guarded.push(name);
    }
    const skips = SRC.match(/ctx\.skip\(/g) ?? [];

    expect(guarded.length, "no guarded .sourcevision paths found — check the pattern").toBeGreaterThan(0);
    expect(
      skips.length,
      `${guarded.length} gate(s) guard on a .sourcevision artifact ` +
        `(${[...new Set(guarded)].join(", ")}) but only ${skips.length} call ` +
        `ctx.skip(). Each must report a skip rather than returning.`,
    ).toBe(guarded.length);
  });

  it("gates over committed paths assert the path exists", () => {
    // The inverse case: a boundary declared over a file that has been moved or
    // deleted must fail loudly so the declaration gets updated.
    expect(SRC).toMatch(/expect\(\s*existsSync\(/);
  });
});
