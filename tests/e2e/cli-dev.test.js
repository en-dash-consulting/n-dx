/**
 * REQUIRED TEST — do not skip or delete.
 *
 * This is the single point of failure for dev-mode startup coverage.
 * Without it, regressions in the `ndx dev` command path (prerequisite
 * checks, help text, dev-server boot) would go undetected.
 *
 * If refactoring changes the dev-server startup path, update this test
 * to match — do not remove it.
 *
 * CI governance: this file must not be skipped or timed out silently.
 * The explicit timeout budget below (30 s) ensures CI kills the test
 * deterministically rather than hanging until the global timeout.
 *
 * @see TESTING.md "Required Tests" section
 * @see tests/integration/scheduler-startup.test.js — analogous required test for server boot
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { run, runResult, createTmpDir, removeTmpDir } from "./e2e-helpers.js";

describe("n-dx dev", { timeout: 30_000 }, () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await createTmpDir("ndx-dev-e2e-");
  });

  afterEach(async () => {
    await removeTmpDir(tmpDir);
  });

  describe("prerequisite checks", () => {
    it("exits 1 when .sourcevision is missing", () => {
      const { stderr, code } = runResult(["dev", tmpDir]);
      expect(code).toBe(1);
      expect(stderr).toContain("Missing");
    });
  });

  describe("help text", () => {
    it("shows dev command in the main help output", () => {
      const output = run([]);
      expect(output).toContain("dev");
      expect(output).toContain("live reload");
    });
  });
});
