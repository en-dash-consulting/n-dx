import { describe, it, expect } from "vitest";
import { firstFailureForSuite } from "../../../src/tools/test-runner.js";

const OUTPUT = [
  "test-gate: selected-suites=hench,rex,root",
  "──────── @n-dx/hench ────────",
  " FAIL  tests/unit/hench-only.test.ts > h",
  "──────── @n-dx/rex ────────",
  " ✓ tests/unit/ok.test.ts",
  "\u001b[31m FAIL  tests/unit/store.test.ts > store > saves\u001b[39m",
  " FAIL  tests/unit/store.test.ts > store > loads",
  "──────── root (tests/**) ────────",
  " × scheduler-startup > starts",
  "──────── summary ────────",
  "  FAIL  @n-dx/rex",
  "test-gate: failed-suites=hench,rex,root",
].join("\n");

describe("firstFailureForSuite", () => {
  it("takes the first FAIL line in the suite's own section", () => {
    expect(firstFailureForSuite(OUTPUT, "rex", undefined)).toBe("FAIL  tests/unit/store.test.ts > store > saves");
    expect(firstFailureForSuite(OUTPUT, "hench", undefined)).toBe("FAIL  tests/unit/hench-only.test.ts > h");
  });

  it("matches root's long label", () => {
    expect(firstFailureForSuite(OUTPUT, "root", undefined)).toBe("× scheduler-startup > starts");
  });

  it("falls back to the digest line naming the suite, then the digest's first", () => {
    const digest = "Failing tests:\n  FAIL  web > a\n  FAIL  @n-dx/sourcevision";
    expect(firstFailureForSuite("no sections", "sourcevision", digest)).toBe("FAIL  @n-dx/sourcevision");
    expect(firstFailureForSuite("no sections", "llm-client", digest)).toBe("FAIL  web > a");
  });

  it("says so when nothing names a failure", () => {
    expect(firstFailureForSuite("", "rex", undefined)).toBe("failed (the output named no failing test)");
  });

  it("caps the line at 200 chars", () => {
    const long = ` FAIL  ${"x".repeat(400)}`;
    const out = firstFailureForSuite(`──────── rex ────────\n${long}`, "rex", undefined);
    expect(out).toHaveLength(200);
    expect(out.endsWith("…")).toBe(true);
  });
});
