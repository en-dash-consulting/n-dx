import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runTestGate } from "../../src/tools/test-runner.js";
import type { TestGateResult } from "../../src/schema/v1.js";

describe("Test Suite Gate Integration", () => {
  let projectDir: string;

  beforeEach(async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "hench-test-gate-"));
    projectDir = tmpDir;

    // Create a minimal project structure with a test file
    await mkdir(join(projectDir, "src"));
    await mkdir(join(projectDir, "tests"));
    await writeFile(
      join(projectDir, "package.json"),
      JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        scripts: {
          test: "vitest --reporter=json",
        },
      }),
    );
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("skips gate when no files changed", async () => {
    const result = await runTestGate({
      projectDir,
      filesChanged: [],
    });

    expect(result.ran).toBe(false);
    expect(result.passed).toBe(true);
    expect(result.packages).toHaveLength(0);
    expect(result.skipReason).toBe("No files modified in prior phases");
  });

  it("returns gate result with metadata", async () => {
    const result = await runTestGate({
      projectDir,
      filesChanged: ["src/app.ts"],
      timeout: 5000,
    });

    expect(result).toHaveProperty("ran");
    expect(result).toHaveProperty("passed");
    expect(result).toHaveProperty("packages");
    expect(result).toHaveProperty("totalDurationMs");
    expect(typeof result.totalDurationMs).toBe("number");
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("includes command in result when gate runs", async () => {
    const result = await runTestGate({
      projectDir,
      filesChanged: ["src/foo.ts"],
      timeout: 5000,
    });

    // Only check if pnpm test is available on the system
    if (result.ran || result.error) {
      expect(result.command).toBe("pnpm test --reporter=json");
    }
  });

  it("returns structured gate result", async () => {
    const result: TestGateResult = await runTestGate({
      projectDir,
      filesChanged: ["src/index.ts"],
      timeout: 3000,
    });

    // Validate structure
    expect(typeof result.ran).toBe("boolean");
    expect(typeof result.passed).toBe("boolean");
    expect(Array.isArray(result.packages)).toBe(true);

    // If gate ran, packages should be an array
    if (result.ran) {
      for (const pkg of result.packages) {
        expect(typeof pkg.name).toBe("string");
        expect(typeof pkg.passed).toBe("boolean");
      }
    }
  });

  // Regression: a gate failure that no package accounts for used to be reported
  // as "0/0 package(s) failed" with an empty `Test gate failed: ` reason, which
  // is how a Windows run whose shell never launched aborted a good task without
  // saying why. A non-zero exit must always name something and explain itself.
  describe("failure with no attributable test output", () => {
    it("attributes the failure and records why", async () => {
      const result = await runTestGate({
        projectDir,
        filesChanged: ["src/index.ts"],
        // Exits non-zero, prints nothing — the shape of an unlaunchable shell,
        // a missing script, or a runner that died before reporting.
        testCommand: `node -e "process.exit(3)"`,
        timeout: 20_000,
      });

      expect(result.ran).toBe(true);
      expect(result.passed).toBe(false);
      expect(result.packages.filter((p) => !p.passed)).toHaveLength(1);
      // The parser never returns an empty package list for a run that exited
      // non-zero: the fabricated workspace entry carries the diagnosis.
      expect(result.packages[0]!.failureOutput).toContain("produced no output");
    });

    // The gate runs a command STRING, so it needs a shell — and `sh` is not on
    // a stock Windows PATH. Proves the platform's shell is actually reached.
    it("runs the command through a shell that exists on this platform", async () => {
      const result = await runTestGate({
        projectDir,
        filesChanged: ["src/index.ts"],
        testCommand: `node -e "process.stdout.write('shell-ok')"`,
        timeout: 20_000,
      });

      expect(result.ran).toBe(true);
      expect(result.passed).toBe(true);
    });
  });

  describe("timeout", () => {
    it("kills a command that overruns the configured limit and says which knob moves it", async () => {
      const result = await runTestGate({
        projectDir,
        filesChanged: ["src/index.ts"],
        // Sleeps well past the limit; the gate must cut it off, not wait.
        testCommand: `node -e "setTimeout(() => {}, 60000)"`,
        timeout: 1_500,
      });

      expect(result.ran).toBe(true);
      expect(result.passed).toBe(false);
      // Attributable, like every other gate failure — not "0/0 package(s)".
      expect(result.packages.filter((p) => !p.passed)).toHaveLength(1);
      expect(result.error).toContain("did not finish within 2s");
      expect(result.error).toContain("hench.fullTestTimeoutMs");
      // failureOutput carries whatever the suite printed before the kill — the
      // hang's location when there is one; here the command printed nothing.
      expect(result.packages[0]!.failureOutput).toBe(
        "No output was produced before the timeout.",
      );
    });

    it("honours a raised limit for a command that finishes inside it", async () => {
      const result = await runTestGate({
        projectDir,
        filesChanged: ["src/index.ts"],
        // Longer than the tight limit above, so a stale 1.5s ceiling would fail it.
        testCommand: `node -e "setTimeout(() => process.stdout.write('slow-ok'), 2500)"`,
        timeout: 30_000,
      });

      expect(result.ran).toBe(true);
      expect(result.passed).toBe(true);
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(2_000);
    });

    it("treats 0 as no limit rather than as an instant timeout", async () => {
      const result = await runTestGate({
        projectDir,
        filesChanged: ["src/index.ts"],
        testCommand: `node -e "setTimeout(() => process.stdout.write('ok'), 1200)"`,
        timeout: 0,
      });

      expect(result.ran).toBe(true);
      expect(result.passed).toBe(true);
    });
  });
});
