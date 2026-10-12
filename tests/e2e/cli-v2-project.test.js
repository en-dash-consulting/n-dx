/**
 * E2E: `ndx status` and `ndx ci` (its rex validate and status steps) pass on a
 * project whose PRD is a v2 tree. Both only spawn rex, so this holds because
 * rex serves the tree; the test keeps it that way.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  run,
  runResult,
  createTmpDir,
  removeTmpDir,
  setupSourcevisionDir,
} from "./e2e-helpers.js";

const V2_FIXTURE = join(import.meta.dirname, "../../packages/rex/tests/fixtures/v2-tree");

describe("ndx on a v2 project", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await createTmpDir("ndx-v2-project-");
    await setupSourcevisionDir(tmpDir);
    await cp(V2_FIXTURE, join(tmpDir, ".rex"), { recursive: true });
    // `ndx init` writes the config; the fixture is the tree alone.
    await writeFile(
      join(tmpDir, ".rex", "config.json"),
      JSON.stringify({ schema: "rex/v1", project: "v2-project", adapter: "file", sourcevision: "auto" }, null, 2) + "\n",
    );
    await writeFile(join(tmpDir, "CODE_OF_CONDUCT.md"), "# Code of Conduct\nBe kind.\n");
  });

  afterEach(async () => {
    await removeTmpDir(tmpDir);
  });

  it("ndx status shows the change", () => {
    const out = run(["status", tmpDir]);
    expect(out).toContain("Add Apple Pay");
  });

  it("ndx ci passes its rex validate and rex status steps", () => {
    const { stdout, code } = runResult(["ci", "--format=json", tmpDir]);
    const report = JSON.parse(stdout);
    const steps = report.steps ?? [];
    const named = (pattern) => steps.find((s) => pattern.test(s.name ?? ""));
    expect(named(/^validate$/)?.ok, stdout).toBe(true);
    expect(named(/^status$/)?.ok, stdout).toBe(true);
    // The whole pipeline is not asserted: sourcevision steps depend on the host.
    expect(typeof code).toBe("number");
  });
});
