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
});
