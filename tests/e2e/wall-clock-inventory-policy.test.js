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
 * There are two detectors, because there are two shapes.
 *
 * **Detector 1 — the clock decides a bound.** Requires both:
 *   1. The file reads a clock — `performance.now()`, `Date.now()`, or
 *      `process.hrtime`.
 *   2. An `expect(...)` whose subject names a duration is bounded by a
 *      comparison matcher.
 *
 * Both halves are needed. Condition 2 alone catches fixture timestamps compared
 * for other reasons; condition 1 alone catches every file that stamps a fixture
 * with `Date.now()`, which is most of them.
 *
 * **Detector 2 — a real sleep is the barrier before the assertion.** An awaited
 * non-zero `setTimeout`/`sleep`, followed by an `expect(` with no `await` in
 * between. Here nothing names a duration — the verdict is an ordering or a
 * count produced by real timers, and the sleep is the bet that the event will
 * have happened by the time it elapses. On a machine busy enough, it has not,
 * and the assertion fails with the code unchanged. These were listed by hand in
 * the inventory until 0.8.0, which is exactly the arrangement that goes stale.
 *
 * The `await`-free run between sleep and assertion is what separates this from
 * the legitimate idiom. A sleep that only widens the window for a *bug* to
 * appear — `concurrent-write-lost-update.test.ts`, where the sleep gives an
 * unlocked reader every chance to slip past and an explicit promise gate then
 * decides the verdict — has that gate's `await` in between and is not flagged.
 *
 * A flagged file satisfies the policy by being mentioned anywhere in the
 * inventory. The inventory itself records whether the mention is a conversion, a
 * justification, or an acknowledged open item — this scan only guarantees the
 * site was looked at.
 *
 * ### What these scans still cannot see
 *
 * A real sleep separated from its assertion by an unrelated `await`, and any
 * load-sensitivity that is not expressed as either a bounded duration or a
 * sleep — a fixed retry count, say. Do not read a green run here as proof the
 * suite is load-independent.
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

/**
 * An awaited real-timer sleep of non-zero length: the `setTimeout`-in-a-Promise
 * idiom, a helper named `sleep`/`delay`, or `setTimeout` from
 * `node:timers/promises`.
 *
 * Zero is deliberately excluded. `setTimeout(resolve, 0)` names no duration —
 * it is a macrotask yield, the "let the current turn finish" barrier that
 * flushing a Preact state update needs, and it cannot be too short for a
 * loaded machine because it was never long to begin with.
 */
const NONZERO_DELAY = String.raw`(?:[1-9]\d*|[A-Za-z_$][\w$.]*)`;
/**
 * The delay argument, allowing an expression rather than only a bare literal
 * or identifier: `setTimeout(r, 10 * MULT)` and `setTimeout(r, base + 5)` are
 * the same barrier as `setTimeout(r, 50)`. Stops at the closing paren of the
 * setTimeout call, and refuses a bare `0` via {@link NONZERO_DELAY} leading it.
 */
const DELAY_EXPR = String.raw`${NONZERO_DELAY}[^;)]*`;
const REAL_SLEEP =
  String.raw`await\s+(?:` +
  // await new Promise((r) => setTimeout(r, 50)) / (r, SETTLE_MS) / (r, 10 * MULT)
  // and the brace form `await new Promise((r) => { setTimeout(r, 50); })`.
  //
  // Only the TAIL needed widening for the brace form: its semicolon falls
  // after the setTimeout call, not before it, so the body still must not cross
  // a `;`. Letting the body span statements instead matched a different thing
  // entirely — a promise that resolves on a real event and arms
  // `setTimeout(() => reject(...), 3000)` as a hang guard is not a sleep, and
  // `[\s\S]*?` reached across its statements to flag it.
  String.raw`new\s+Promise\s*(?:<[^>]*>)?\s*\([^;]*?setTimeout\s*\([^;,]*,\s*${DELAY_EXPR}\)\s*;?\s*\}?\s*\)` +
  // await sleep(150) / await delay(150)
  String.raw`|(?:sleep|delay)\s*\(\s*[1-9][^;]*?\)` +
  // await setTimeout(50) — node:timers/promises
  String.raw`|setTimeout\s*\(\s*[1-9]\d*\s*\)` +
  String.raw`)\s*;`;

/**
 * A real sleep used as the barrier before an assertion — "wait a while, then
 * check it happened". This is the second family, and the one the duration
 * detector above is blind to: the verdict is an ordering or a count produced
 * by real timers, so no identifier in it names a duration.
 *
 * The tempered run rejects any `await` between the sleep and the `expect`,
 * which is what separates the two idioms. A sleep followed by a *gate* — the
 * `concurrent-write-lost-update.test.ts` pattern, where the sleep only widens
 * the window for a bug to show itself and correctness is decided by an
 * explicit promise — has that promise's `await` in between, and is not
 * flagged. A sleep followed directly by `expect` has nothing in between, which
 * is exactly the case where the sleep's length is the verdict.
 */
const SLEEP_THEN_ASSERT = new RegExp(
  REAL_SLEEP + String.raw`(?:(?!\bawait\b)[\s\S]){0,600}?\bexpect\s*\(`,
  "g",
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

function findSleepDecidedTestFiles() {
  const flagged = [];
  for (const root of collectScanRoots()) {
    for (const file of walkTestFiles(root)) {
      const relPath = toPosixRelative(file);
      if (relPath === SELF) continue;
      SLEEP_THEN_ASSERT.lastIndex = 0;
      if (!SLEEP_THEN_ASSERT.test(readFileSync(file, "utf8"))) continue;
      flagged.push(relPath);
    }
  }
  return [...new Set(flagged)].sort();
}

describe("wall-clock assertion inventory completeness", () => {
  it("flags the known clock-decided suites (detector self-test)", () => {
    const flagged = findClockDecidedTestFiles();
    // If the detector regresses to flagging nothing, the inventory check below
    // turns vacuously green. All three still read a clock — the two search
    // suites keep a multiplier-scaled hang guardrail beside the assertions that
    // were converted, and tree-hardened is an open scaled budget — so they are
    // expected to keep matching.
    expect(flagged).toContain("packages/web/tests/unit/server/routes-search.test.ts");
    expect(flagged).toContain("packages/web/tests/unit/server/search-index.test.ts");
    expect(flagged).toContain("packages/rex/tests/unit/core/tree-hardened.test.ts");
  });

  it("does not flag the suites that were converted to counters", () => {
    const flagged = findClockDecidedTestFiles();
    // These held 25 of the elapsed-time assertions in the repo and now hold
    // none. If a clock reappears in either, it should arrive with a row in the
    // inventory explaining why counting was not enough — this assertion is what
    // makes that a conversation rather than a silent regression.
    expect(flagged).not.toContain("packages/web/tests/unit/viewer/large-tree-performance.test.ts");
    expect(flagged).not.toContain("packages/web/tests/unit/viewer/prd-tree-live-tick-perf.test.ts");
    // Two `< 500ms` budgets and an `addTime <= reserializeTime` comparison of
    // adjacent micro-spans, now counts of files written.
    expect(flagged).not.toContain("packages/rex/tests/integration/prd-tree-atomic-writes.test.ts");
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

  it("flags the known sleep-decided suites (detector self-test)", () => {
    const flagged = findSleepDecidedTestFiles();
    // Same guard as above, for the second detector: if it regresses to matching
    // nothing, the inventory check below goes vacuously green. These three
    // sleep for a spawned CLI, a websocket handshake and a DOM effect
    // respectively — three different reasons, so a narrowing that breaks one
    // idiom is unlikely to break all three at once.
    expect(flagged).toContain("tests/e2e/cli-start.test.js");
    expect(flagged).toContain("packages/web/tests/unit/server/websocket.test.ts");
    expect(flagged).toContain("packages/web/tests/unit/viewer/workspaces-view.test.ts");
  });

  it("does not flag the suites converted to gates or fake timers", () => {
    const flagged = findSleepDecidedTestFiles();
    // The six sites the inventory's "Not clock-derived, but load-sensitive for
    // a different reason" section listed by hand. Each now waits for the event
    // it is asserting about — a promise gate, or a fake clock advanced by a
    // named number of milliseconds — rather than for a window the event was
    // expected to fall inside. A real sleep reappearing in front of an
    // assertion in any of them is a regression to the shape this whole scan
    // exists to stop.
    expect(flagged).not.toContain("packages/web/tests/unit/server/register-scheduler.test.ts");
    expect(flagged).not.toContain("packages/web/tests/integration/seam-register-scheduler.test.ts");
    expect(flagged).not.toContain("packages/hench/tests/unit/store/run-retention-scheduler.test.ts");
    expect(flagged).not.toContain("packages/rex/tests/unit/store/file-lock.test.ts");
    expect(flagged).not.toContain("packages/hench/tests/unit/queue/execution-queue.test.ts");
    expect(flagged).not.toContain("packages/web/tests/unit/viewer/elapsed-time-memoization.test.ts");
  });

  it("every test file that asserts straight after a real sleep is in the inventory", () => {
    const inventory = readFileSync(INVENTORY_PATH, "utf8");
    const missing = findSleepDecidedTestFiles().filter((relPath) => !inventory.includes(relPath));

    expect(
      missing,
      `Test file(s) assert immediately after a real-timer sleep but have no ` +
        `entry in tests/wall-clock-assertion-inventory.md:\n` +
        missing.map((f) => `  - ${f}`).join("\n") +
        `\nThe sleep is the barrier deciding the verdict: if the event has not ` +
        `happened by the time it elapses, the assertion fails with the code ` +
        `unchanged. Prefer waiting for the event itself — a promise the ` +
        `production code resolves, or fake timers advanced by a named ` +
        `interval. If the sleep must stay, add a row to the inventory saying ` +
        `why load cannot flip the result.`,
    ).toEqual([]);
  });
});
