/**
 * Guards the color-env neutralization in tests/setup-color-env.js.
 *
 * Without that setupFile, a developer whose shell exports FORCE_COLOR=3 saw 24
 * failures across 8 files — CLI output arriving with ANSI escapes while
 * assertions compared plain strings. CI never caught it because GitHub runners
 * do not set FORCE_COLOR.
 *
 * These assertions fail loudly (and in one obvious place) if the setupFile is
 * removed from vitest.config.js or stops doing its job, instead of the breakage
 * reappearing as two dozen confusing output-contract failures.
 */
import { describe, expect, it } from "vitest";

describe("ambient color env is neutralized for the test process", () => {
  it("clears FORCE_COLOR, which outranks both NO_COLOR and isTTY", () => {
    // supportsColor() checks FORCE_COLOR first, so any non-"0" value here would
    // colorize every CLI invocation in the suite.
    expect(process.env.FORCE_COLOR).toBeUndefined();
  });

  it("clears COLORTERM", () => {
    expect(process.env.COLORTERM).toBeUndefined();
  });

  it("sets NO_COLOR so the outcome does not depend on how vitest wires stdio", () => {
    expect(process.env.NO_COLOR).toBe("1");
  });

  it("propagates the neutralized values to spawned children", async () => {
    // The e2e suites spawn real CLI processes that inherit process.env. If the
    // parent were not neutralized, those children would colorize their output.
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync(
      process.execPath,
      ["-e", "process.stdout.write(JSON.stringify({f: process.env.FORCE_COLOR ?? null, n: process.env.NO_COLOR ?? null}))"],
      { encoding: "utf-8" },
    );

    expect(JSON.parse(out)).toEqual({ f: null, n: "1" });
  });
});
