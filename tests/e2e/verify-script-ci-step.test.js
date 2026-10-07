/**
 * `pnpm verify` must actually run the CI gate.
 *
 * Its last step used to be `node packages/core/ci.js .` — but ci.js is a
 * library (it exports runCI and has no main entry), so that step exited 0
 * having checked nothing, and verify reported green for a gate that never ran.
 *
 * This test takes the CI step straight from the root package.json, points it
 * at a project with a deliberate violation, and requires a failing CI report.
 * A step that runs no CI phase produces no report and fails here.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  createTmpDir,
  removeTmpDir,
  setupRexDir,
  setupSourcevisionDir,
  DEFAULT_TIMEOUT,
} from "./e2e-helpers.js";

const ROOT = join(import.meta.dirname, "../..");

/** The `verify` script's CI step, as argv, with its trailing `.` target removed. */
function verifyCiStep() {
  const { scripts } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
  const steps = scripts.verify.split("&&").map((s) => s.trim());
  const ciStep = steps.find((s) => /\bci(\.js)?\b/.test(s) && s.startsWith("node "));
  expect(ciStep, `no CI step in verify: ${scripts.verify}`).toBeDefined();
  const argv = ciStep.split(/\s+/);
  expect(argv.at(-1), "CI step must target the repo root (`.`)").toBe(".");
  return argv.slice(1, -1);
}

describe("pnpm verify CI step", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await createTmpDir("ndx-verify-ci-");
    await setupSourcevisionDir(tmpDir);
    await setupRexDir(tmpDir, { project: "verify-ci-step" });
    await writeFile(join(tmpDir, "CODE_OF_CONDUCT.md"), "# Code of Conduct\n");
  });

  afterEach(async () => {
    await removeTmpDir(tmpDir);
  });

  it("runs the CI pipeline and fails on a deliberate violation", async () => {
    // The violation: a required community file is missing.
    await rm(join(tmpDir, "CODE_OF_CONDUCT.md"));

    const result = spawnSync(process.execPath, [...verifyCiStep(), tmpDir, "--format=json"], {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: DEFAULT_TIMEOUT,
    });

    expect(result.stdout.trim(), "CI step printed no report — it ran no CI phase").not.toBe("");
    const report = JSON.parse(result.stdout);
    expect(report.ok).toBe(false);
    expect(report.steps.find((s) => s.name === "community-files")).toMatchObject({ ok: false });
    expect(result.status).not.toBe(0);
  });
});
