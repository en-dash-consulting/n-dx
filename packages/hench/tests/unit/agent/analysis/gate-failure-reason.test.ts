import { describe, it, expect } from "vitest";
import {
  buildGateFailureReason,
  isChangedTestFile,
  parseGateFailures,
  FALLBACK_TAIL_LINES,
  MAX_REASON_CHARS,
  MAX_REASON_FAILURES,
  NEW_TEST_HINT,
} from "../../../../src/agent/analysis/gate-failure-reason.js";

/** What vitest prints for a run with an assertion failure and a setup TypeError. */
const VITEST_OUTPUT = [
  "\u001b[31m ❯ tests/unit/scan.test.ts (3 tests | 1 failed) 14ms\u001b[39m",
  "   × scan > lists every configured repo 6ms",
  "     → Cannot read properties of undefined (reading 'repos')",
  " ✓ tests/unit/format.test.ts (4 tests) 3ms",
  "",
  "⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯",
  "",
  " FAIL  tests/unit/scan.test.ts > scan > lists every configured repo",
  "TypeError: Cannot read properties of undefined (reading 'repos')",
  " ❯ tests/unit/scan.test.ts:12:30",
  "⎯⎯⎯⎯⎯⎯⎯[1/2]⎯",
  "",
  " FAIL  src/total.test.ts > total > adds tax",
  "AssertionError: expected 110 to be 111 // Object.is equality",
  "",
  "- Expected",
  "+ Received",
  "⎯⎯⎯⎯⎯⎯⎯[2/2]⎯",
  "",
  " Test Files  2 failed | 1 passed (3)",
  "      Tests  2 failed | 6 passed (8)",
].join("\n");

const NODE_TAP_OUTPUT = [
  "TAP version 13",
  "# Subtest: parses a config",
  "ok 1 - parses a config",
  "# Subtest: loads the fixture",
  "not ok 2 - loads the fixture",
  "  ---",
  "  duration_ms: 1.2",
  "  location: '/work/repo/test/fixture.test.js:8:1'",
  "  failureType: 'testCodeFailure'",
  "  error: 'ENOENT: no such file or directory, open fixtures/a.json'",
  "  code: 'ENOENT'",
  "  ...",
  "1..2",
].join("\n");

const NODE_SPEC_OUTPUT = [
  "✔ parses a config (0.8ms)",
  "✖ rejects a bad port (1.1ms)",
  "  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:",
  "",
  "  1 !== 2",
  "ℹ tests 2",
  "ℹ fail 1",
  "✖ failing tests:",
  "",
  "test at test/port.test.js:4:1",
  "✖ rejects a bad port (1.1ms)",
  "  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:",
].join("\n");

describe("parseGateFailures", () => {
  it("reads vitest FAIL lines with their first AssertionError or TypeError line", () => {
    const failures = parseGateFailures(VITEST_OUTPUT);
    expect(failures).toHaveLength(2);
    expect(failures[0]).toMatchObject({
      file: "tests/unit/scan.test.ts",
      name: "scan > lists every configured repo",
    });
    expect(failures[0].detail).toMatch(/Cannot read properties of undefined \(reading 'repos'\)/);
    expect(failures[1]).toEqual({
      file: "src/total.test.ts",
      name: "total > adds tax",
      detail: "AssertionError: expected 110 to be 111 // Object.is equality",
    });
  });

  it("reads jest's FAIL file and ● headings", () => {
    const failures = parseGateFailures([
      "FAIL src/cart.test.js",
      "  ● Cart › totals the items",
      "",
      "    expect(received).toBe(expected) // Object.is equality",
      "",
      "    Expected: 3",
      "PASS src/other.test.js",
    ].join("\n"));
    expect(failures).toEqual([
      {
        file: "src/cart.test.js",
        name: "Cart › totals the items",
        detail: "expect(received).toBe(expected) // Object.is equality",
      },
    ]);
  });

  it("reads node:test TAP output, taking the file from location:", () => {
    expect(parseGateFailures(NODE_TAP_OUTPUT)).toEqual([
      {
        file: "/work/repo/test/fixture.test.js",
        name: "loads the fixture",
        detail: "error: 'ENOENT: no such file or directory, open fixtures/a.json'",
      },
    ]);
  });

  it("reads node:test's spec reporter once, ignoring its failing-tests heading", () => {
    const failures = parseGateFailures(NODE_SPEC_OUTPUT);
    expect(failures).toHaveLength(1);
    expect(failures[0].name).toBe("rejects a bad port");
    expect(failures[0].detail).toMatch(/^AssertionError \[ERR_ASSERTION\]: Expected values/);
  });

  it("drops run-all package summaries, which name no test", () => {
    expect(parseGateFailures("  FAIL  @n-dx/web\n5/6 suites passed — failed: @n-dx/web")).toEqual([]);
  });

  it("returns nothing for output it cannot read", () => {
    expect(parseGateFailures("Error: spawn pnpm ENOENT\n    at ChildProcess._handle")).toEqual([]);
  });
});

describe("buildGateFailureReason", () => {
  it("names each failing test and its first error line under the headline", () => {
    const reason = buildGateFailureReason({
      output: VITEST_OUTPUT,
      headline: "Test gate failed [command: pnpm test]: workspace",
    });
    expect(reason.split("\n")).toEqual([
      "Test gate failed [command: pnpm test]: workspace",
      "Failing tests (2):",
      "- tests/unit/scan.test.ts > scan > lists every configured repo",
      expect.stringMatching(/Cannot read properties of undefined/),
      "- src/total.test.ts > total > adds tax",
      "  AssertionError: expected 110 to be 111 // Object.is equality",
    ]);
    expect(reason).not.toContain(NEW_TEST_HINT);
  });

  it("falls back to the last lines of the output when no failure is recognisable", () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`);
    const reason = buildGateFailureReason({ output: lines.join("\n"), headline: "Test gate failed: timed out after 15m" });
    const out = reason.split("\n");
    expect(out[0]).toBe("Test gate failed: timed out after 15m");
    expect(out[1]).toBe(`Last ${FALLBACK_TAIL_LINES} lines of the test gate output:`);
    expect(out.slice(2)).toEqual(lines.slice(-FALLBACK_TAIL_LINES));
  });

  it("caps the number of failures and the total size", () => {
    const many = Array.from(
      { length: 30 },
      (_, i) => ` FAIL  tests/t${i}.test.ts > case ${i}\nAssertionError: ${"x".repeat(400)}`,
    ).join("\n");
    const reason = buildGateFailureReason({ output: many });
    expect(reason.length).toBeLessThanOrEqual(MAX_REASON_CHARS);
    expect(reason).toContain("Failing tests (30):");
    expect(reason).toContain(`… and ${30 - MAX_REASON_FAILURES} more`);
    expect(reason).not.toContain("tests/t8.test.ts");
  });

  it("applies the redaction it is given before the reason is clipped", () => {
    const reason = buildGateFailureReason({
      output: " FAIL  tests/a.test.ts > auth\nError: request failed with key sk-secret-123",
      redact: (text) => text.replace(/sk-[\w-]+/g, "[REDACTED]"),
    });
    expect(reason).toContain("[REDACTED]");
    expect(reason).not.toContain("sk-secret-123");
  });
});

describe("the new-or-changed test hint", () => {
  it("marks a failing test in a file the run changed, matching a package-relative path", () => {
    const reason = buildGateFailureReason({
      output: VITEST_OUTPUT,
      filesChanged: ["packages/scanner/tests/unit/scan.test.ts", "packages/scanner/src/scan.ts"],
    });
    const lines = reason.split("\n");
    const scan = lines.indexOf("- tests/unit/scan.test.ts > scan > lists every configured repo");
    expect(lines[scan + 2]).toBe(`  ${NEW_TEST_HINT}`);
    // The other failure is in a file the run did not touch.
    const total = lines.indexOf("- src/total.test.ts > total > adds tax");
    expect(lines.slice(total)).not.toContain(`  ${NEW_TEST_HINT}`);
  });

  it("matches absolute paths the runner printed against repo-relative changed files", () => {
    expect(isChangedTestFile("/work/repo/test/fixture.test.js", ["test/fixture.test.js"])).toBe(true);
    expect(isChangedTestFile("C:\\work\\repo\\test\\fixture.test.js", ["test/fixture.test.js"])).toBe(true);
    expect(isChangedTestFile("test/fixture.test.js", ["test/other.test.js"])).toBe(false);
    // A suffix must start at a path boundary.
    expect(isChangedTestFile("a.test.js", ["src/data.test.js"])).toBe(false);
  });

  it("is left off when the run changed no files", () => {
    expect(buildGateFailureReason({ output: NODE_TAP_OUTPUT })).not.toContain(NEW_TEST_HINT);
  });
});
