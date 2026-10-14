/**
 * Every vitest config has to hide the spawns its tests make.
 *
 * On Windows a child process that gets its own console gets its own window,
 * and that window takes focus. The suite spawns from ~790 sites across ~250
 * files, so a run takes the machine for its whole duration, and watch mode
 * becomes unusable. The default therefore lives in the module
 * (`tests/hidden-child-process.js`) and each config aliases
 * `node:child_process` to it.
 *
 * A config that drops the alias gets its windows back silently: nothing fails,
 * the machine just becomes unusable for the length of the run. That is the
 * failure this guard exists to catch, and it is why the assertion is on the
 * configs rather than on any behaviour.
 *
 * @see tests/hidden-child-process.js
 */

import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = join(import.meta.dirname, "../..");

describe("vitest configs hide the spawns their tests make", () => {
  const configs = ["vitest.config.js"];
  for (const pkg of readdirSync(join(ROOT, "packages"))) {
    const rel = `packages/${pkg}/vitest.config.ts`;
    if (existsSync(join(ROOT, rel))) configs.push(rel);
  }

  it("finds the configs it is meant to check", () => {
    // Otherwise the assertion below passes by checking nothing.
    expect(configs.length).toBeGreaterThan(4);
    expect(configs).toContain("vitest.config.js");
  });

  it("every config spreads hiddenChildProcessAlias into resolve.alias", () => {
    const missing = configs.filter(
      (rel) => !readFileSync(join(ROOT, rel), "utf-8").includes("hiddenChildProcessAlias"),
    );
    expect(
      missing,
      "These vitest configs do not spread `hiddenChildProcessAlias` into " +
        "resolve.alias, so a spawn in their tests opens a console window on " +
        "Windows and takes focus. See tests/hidden-child-process.js.",
    ).toEqual([]);
  });
});
