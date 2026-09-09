/**
 * Wall-clock assertion inventory completeness — every test file that decides a
 * verdict from a clock reading must be accounted for in
 * tests/wall-clock-assertion-inventory.md.
 *
 * Why: an assertion whose result is a function of `(code, machine load)` rather
 * than `(code)` fails on a busy machine with the code unchanged. `ndx work` runs
 * the full suite as its post-task gate, so each one of these can mark a run
 * failed after the work has already committed — which teaches operators to
 * disbelieve red, and then hides a real regression behind "probably flaky".
 *
 * Two of these were found by hand and two more only after a full sweep, so a
 * hand audit demonstrably misses sites. This scan makes the next new one a test
 * failure at the moment it is written instead of a mystery months later.
 *
 * Detection requires both:
 *   1. The file reads a clock — `performance.now()`, `Date.now()`, or
 *      `process.hrtime`.
 *   2. An `expect(...)` whose subject names a duration is bounded by a
 *      comparison matcher.
 *
 * Both halves are needed. Condition 2 alone catches fixture timestamps compared
 * for other reasons; condition 1 alone catches every file that stamps a fixture
 * with `Date.now()`, which is most of them.
 *
 * A flagged file satisfies the policy by being mentioned anywhere in the
 * inventory. The inventory itself records whether the mention is a conversion, a
 * justification, or an acknowledged open item — this scan only guarantees the
 * site was looked at.
 *
 * ### What this scan cannot see
 *
 * Assertions on *ordering* or *counts* produced by real timers — a 10ms interval
 * observed over a 50ms window, say — are equally load-sensitive and carry no
 * duration identifier to match on. The inventory lists the known ones by hand
 * under "Not clock-derived, but load-sensitive for a different reason". Do not
 * read a green run here as proof the suite is load-independent.
 *
 * @see tests/wall-clock-assertion-inventory.md
 * @see TESTING.md — Flake Resistance, Family 2
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const INVENTORY_PATH = join(ROOT, "tests", "wall-clock-assertion-inventory.md");
const SELF = "tests/e2e/wall-clock-inventory-policy.test.js";

/** The file reads a real clock somewhere. */
const CLOCK_READ = /performance\.now\(\)|process\.hrtime|Date\.now\(\)/;

/**
 * Identifier fragments that name a measured duration.
 *
 * `[a-z]Time\b` rather than `Time` so `startTime`/`renderTime` match while
 * `Timeout`/`Timer`/`Timestamp` do not — a timeout option is a hang guardrail,
 * not a verdict, and TESTING.md is explicit that those are legitimate.
 */
const DURATION_WORD =
  "(?:elapsed|Elapsed|duration|Duration|latency|Latency|median|Median" +
  "|uptime|Uptime|[Rr]enderTime|avgMs|totalMs|runningMs|stuckSince|[a-z]Time\\b|Ms\\b)";

/**
 * An `expect()` whose subject names a duration, bounded by a comparison
 * matcher. The `[^;{}]` runs keep a match inside one statement so an unrelated
 * `expect` further down the test cannot be paired with a duration above it.
 */
const CLOCK_BOUNDED_ASSERTION = new RegExp(
  String.raw`expect\(\s*[^;{}]{0,120}?\w*${DURATION_WORD}\w*[^;{}]{0,400}?` +
    String.raw`\.toBe(?:Less|Greater)Than(?:OrEqual)?\(`,
  "gs",
);

function walkTestFiles(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTestFiles(full, files);
    } else if (/\.test\.(?:ts|js|tsx|jsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function collectScanRoots() {
  const roots = [join(ROOT, "tests")];
  const packagesDir = join(ROOT, "packages");
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    // `src` as well as `tests`: one package keeps a test suite under src/.
    for (const sub of ["tests", "src"]) {
      const dir = join(packagesDir, entry.name, sub);
      if (existsSync(dir)) roots.push(dir);
    }
  }
  return roots;
}

function toPosixRelative(file) {
  return relative(ROOT, file).split(sep).join("/");
}

function findClockDecidedTestFiles() {
  const flagged = [];
  for (const root of collectScanRoots()) {
    for (const file of walkTestFiles(root)) {
      const relPath = toPosixRelative(file);
      if (relPath === SELF) continue;
      const content = readFileSync(file, "utf8");
      if (!CLOCK_READ.test(content)) continue;
      if (!CLOCK_BOUNDED_ASSERTION.test(content)) continue;
      flagged.push(relPath);
    }
  }
  return [...new Set(flagged)].sort();
}

describe("wall-clock assertion inventory completeness", () => {
  it("flags the known clock-decided suites (detector self-test)", () => {
    const flagged = findClockDecidedTestFiles();
    // If the detector regresses to flagging nothing, the inventory check below
    // turns vacuously green. These three are open items in the inventory, so
    // they are expected to keep matching until they are converted.
    expect(flagged).toContain("packages/rex/tests/integration/prd-tree-atomic-writes.test.ts");
    expect(flagged).toContain("packages/web/tests/unit/server/search-index.test.ts");
    expect(flagged).toContain("packages/rex/tests/unit/core/tree-hardened.test.ts");
  });

  it("does not flag the two viewer performance suites that were converted to counters", () => {
    const flagged = findClockDecidedTestFiles();
    // These held 25 of the elapsed-time assertions in the repo and now hold
    // none. If a clock reappears in either, it should arrive with a row in the
    // inventory explaining why counting was not enough — this assertion is what
    // makes that a conversation rather than a silent regression.
    expect(flagged).not.toContain("packages/web/tests/unit/viewer/large-tree-performance.test.ts");
    expect(flagged).not.toContain("packages/web/tests/unit/viewer/prd-tree-live-tick-perf.test.ts");
  });

  it("every test file that decides a verdict from a clock is in the inventory", () => {
    const inventory = readFileSync(INVENTORY_PATH, "utf8");
    const missing = findClockDecidedTestFiles().filter((relPath) => !inventory.includes(relPath));

    expect(
      missing,
      `Test file(s) bound a clock reading but have no entry in ` +
        `tests/wall-clock-assertion-inventory.md:\n` +
        missing.map((f) => `  - ${f}`).join("\n") +
        `\nPrefer counting the work instead (TESTING.md, Family 2, technique 1). ` +
        `If a clock is genuinely required, derive the bound by measuring both a ` +
        `clean run and an injected regression, record both numbers beside the ` +
        `constant, and add a row to the inventory.`,
    ).toEqual([]);
  });
});
