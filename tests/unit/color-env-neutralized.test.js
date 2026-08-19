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

describe("no test stubs an NDX_* variable onto the shared worker env", () => {
  /**
   * Static scan, not a runtime probe, because the leak this guards is CONCURRENT.
   *
   * `vi.stubEnv` mutates the vitest worker's real `process.env`, and the comment on
   * setup-color-env.js above spells out why that reaches further than the stubbing
   * file: e2e siblings in the same worker spawn CLIs with `{ ...process.env }`, so a
   * child inherits whatever is set at the moment it spawns. That is how
   * child-lifecycle.test.js's `NDX_DEBUG_LIFECYCLE` stub made an unrelated e2e file
   * print `[child-lifecycle] …` — a notice the debug gate existed to suppress.
   * `vi.unstubAllEnvs()` in afterEach cannot close a window that is open during the
   * test rather than after it.
   *
   * Asserting on live `process.env` would be racy for exactly that reason: whether a
   * leak is visible depends on which files share a worker and how they interleave. So
   * this checks the source instead, which is deterministic.
   *
   * NDX_* only, deliberately. The point is variables that change how the CLI under
   * test BEHAVES. Stubbing a third-party API key is a different (and much smaller)
   * risk, and two such stubs exist in package suites; widening this to all variables
   * would fail them without having thought that through.
   */
  it("uses an injected env argument instead", async () => {
    const { readdir, readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    const root = join(import.meta.dirname, "..");
    /** @type {string[]} */
    const offenders = [];

    /** @param {string} dir */
    async function scan(dir) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await scan(full);
        } else if (entry.name.endsWith(".test.js")) {
          const src = await readFile(full, "utf-8");
          // Match the call, not the word: the prose in child-lifecycle.test.js
          // explains this hazard by name and must not trip its own guard.
          if (/vi\.stubEnv\(\s*["'`]NDX_/.test(src)) offenders.push(full);
        }
      }
    }

    await scan(root);

    expect(
      offenders,
      "these tests stub an NDX_* variable onto the worker env; thread an env argument " +
      "through to the code under test instead (see isLifecycleDebugEnabled's env param)",
    ).toEqual([]);
  });
});
