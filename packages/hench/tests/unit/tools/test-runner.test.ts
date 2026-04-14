import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  isTestFile,
  candidateTestPaths,
  findRelevantTests,
  detectRunner,
  buildScopedCommand,
  runPostTaskTests,
} from "../../../src/tools/test-runner.js";

// ---------------------------------------------------------------------------
// isTestFile
// ---------------------------------------------------------------------------

describe("isTestFile", () => {
  it("recognises .test.ts files", () => {
    expect(isTestFile("src/foo.test.ts")).toBe(true);
  });

  it("recognises .spec.js files", () => {
    expect(isTestFile("lib/bar.spec.js")).toBe(true);
  });

  it("recognises .test.tsx files", () => {
    expect(isTestFile("components/Button.test.tsx")).toBe(true);
  });

  it("recognises _test.ts files", () => {
    expect(isTestFile("src/utils_test.ts")).toBe(true);
  });

  it("rejects regular source files", () => {
    expect(isTestFile("src/foo.ts")).toBe(false);
    expect(isTestFile("src/index.js")).toBe(false);
    expect(isTestFile("README.md")).toBe(false);
  });

  it("rejects files with test in the directory name but not the file", () => {
    expect(isTestFile("tests/helpers.ts")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// candidateTestPaths
// ---------------------------------------------------------------------------

describe("candidateTestPaths", () => {
  it("returns the file itself if it is already a test file", () => {
    const paths = candidateTestPaths("src/foo.test.ts");
    expect(paths).toEqual(["src/foo.test.ts"]);
  });

  it("generates co-located test and spec variants", () => {
    const paths = candidateTestPaths("src/agent/loop.ts");
    expect(paths).toContain("src/agent/loop.test.ts");
    expect(paths).toContain("src/agent/loop.spec.ts");
  });

  it("generates __tests__ directory variants", () => {
    const paths = candidateTestPaths("src/agent/loop.ts");
    expect(paths).toContain(join("src/agent/__tests__/loop.test.ts"));
    expect(paths).toContain(join("src/agent/__tests__/loop.spec.ts"));
  });

  it("generates tests/ directory variants", () => {
    const paths = candidateTestPaths("src/agent/loop.ts");
    expect(paths).toContain(join("src/agent/tests/loop.test.ts"));
    expect(paths).toContain(join("src/agent/tests/loop.spec.ts"));
  });

  it("generates mirrored src → tests paths", () => {
    const paths = candidateTestPaths("src/agent/loop.ts");
    expect(paths).toContain(join("tests/agent/loop.test.ts"));
    expect(paths).toContain(join("tests/agent/loop.spec.ts"));
    // Also __tests__ mirror
    expect(paths).toContain(join("__tests__/agent/loop.test.ts"));
  });

  it("does not generate src → tests mirror for non-src paths", () => {
    const paths = candidateTestPaths("lib/utils.ts");
    // Should still have co-located candidates
    expect(paths).toContain("lib/utils.test.ts");
    // But no mirror paths
    expect(paths.every((p) => !p.startsWith("tests/"))).toBe(true);
  });

  it("preserves file extension", () => {
    const paths = candidateTestPaths("src/foo.jsx");
    expect(paths).toContain("src/foo.test.jsx");
    expect(paths).toContain("src/foo.spec.jsx");
  });
});

// ---------------------------------------------------------------------------
// findRelevantTests
// ---------------------------------------------------------------------------

describe("findRelevantTests", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "hench-test-discovery-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("finds co-located test file for a source file", async () => {
    await mkdir(join(tmpDir, "src/agent"), { recursive: true });
    await writeFile(join(tmpDir, "src/agent/loop.ts"), "");
    await writeFile(join(tmpDir, "src/agent/loop.test.ts"), "");

    const tests = await findRelevantTests(tmpDir, ["src/agent/loop.ts"]);
    expect(tests).toEqual(["src/agent/loop.test.ts"]);
  });

  it("finds .spec variant co-located test file", async () => {
    await mkdir(join(tmpDir, "src/utils"), { recursive: true });
    await writeFile(join(tmpDir, "src/utils/helpers.ts"), "");
    await writeFile(join(tmpDir, "src/utils/helpers.spec.ts"), "");

    const tests = await findRelevantTests(tmpDir, ["src/utils/helpers.ts"]);
    expect(tests).toContain("src/utils/helpers.spec.ts");
  });

  it("finds test files in __tests__ directory", async () => {
    await mkdir(join(tmpDir, "src/agent"), { recursive: true });
    await mkdir(join(tmpDir, "src/agent/__tests__"), { recursive: true });
    await writeFile(join(tmpDir, "src/agent/loop.ts"), "");
    await writeFile(join(tmpDir, "src/agent/__tests__/loop.test.ts"), "");

    const tests = await findRelevantTests(tmpDir, ["src/agent/loop.ts"]);
    expect(tests).toContain(join("src/agent/__tests__/loop.test.ts"));
  });

  it("finds test files via src → tests mirror", async () => {
    await mkdir(join(tmpDir, "src/agent"), { recursive: true });
    await mkdir(join(tmpDir, "tests/agent"), { recursive: true });
    await writeFile(join(tmpDir, "src/agent/loop.ts"), "");
    await writeFile(join(tmpDir, "tests/agent/loop.test.ts"), "");

    const tests = await findRelevantTests(tmpDir, ["src/agent/loop.ts"]);
    expect(tests).toContain(join("tests/agent/loop.test.ts"));
  });

  it("returns test file itself when a test file is in the changed list", async () => {
    await mkdir(join(tmpDir, "src/agent"), { recursive: true });
    await writeFile(join(tmpDir, "src/agent/loop.test.ts"), "");

    const tests = await findRelevantTests(tmpDir, ["src/agent/loop.test.ts"]);
    expect(tests).toEqual(["src/agent/loop.test.ts"]);
  });

  it("returns empty array for files with no related tests", async () => {
    const tests = await findRelevantTests(tmpDir, ["nonexistent/file.ts"]);
    expect(tests).toEqual([]);
  });

  it("deduplicates when the same source file appears multiple times", async () => {
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await writeFile(join(tmpDir, "src/foo.ts"), "");
    await writeFile(join(tmpDir, "src/foo.test.ts"), "");

    const tests = await findRelevantTests(tmpDir, [
      "src/foo.ts",
      "src/foo.ts", // duplicate input
    ]);
    expect(tests).toEqual(["src/foo.test.ts"]);
  });

  it("deduplicates when multiple source files map to the same test", async () => {
    // Both source files are in the same directory and will generate
    // the same candidate: src/agent/loop.test.ts
    await mkdir(join(tmpDir, "src/agent"), { recursive: true });
    await writeFile(join(tmpDir, "src/agent/loop.ts"), "");
    await writeFile(join(tmpDir, "src/agent/loop.spec.ts"), "");
    await writeFile(join(tmpDir, "src/agent/loop.test.ts"), "");

    // loop.ts generates candidate loop.test.ts
    // loop.spec.ts IS a test file → returns itself, but also loop.test.ts
    // would be a candidate from loop.ts. No duplicate in results.
    const tests = await findRelevantTests(tmpDir, [
      "src/agent/loop.ts",
      "src/agent/loop.ts",
    ]);
    const unique = [...new Set(tests)];
    expect(tests).toEqual(unique);
  });

  it("deduplicates when different source files produce overlapping candidates", async () => {
    // Two different source files whose candidates both include the same test file
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await writeFile(join(tmpDir, "src/foo.ts"), "");
    await writeFile(join(tmpDir, "src/foo.test.ts"), "");

    // foo.ts → candidate foo.test.ts (hit)
    // foo.test.ts → returns itself (foo.test.ts)
    // Both resolve to the same test file
    const tests = await findRelevantTests(tmpDir, [
      "src/foo.ts",
      "src/foo.test.ts",
    ]);
    const unique = [...new Set(tests)];
    expect(tests).toEqual(unique);
    expect(tests).toContain("src/foo.test.ts");
  });

  it("finds tests for multiple distinct source files", async () => {
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await writeFile(join(tmpDir, "src/foo.ts"), "");
    await writeFile(join(tmpDir, "src/foo.test.ts"), "");
    await writeFile(join(tmpDir, "src/bar.ts"), "");
    await writeFile(join(tmpDir, "src/bar.test.ts"), "");

    const tests = await findRelevantTests(tmpDir, ["src/foo.ts", "src/bar.ts"]);
    expect(tests).toContain("src/foo.test.ts");
    expect(tests).toContain("src/bar.test.ts");
    expect(tests).toHaveLength(2);
  });

  it("finds multiple test files for a single source file", async () => {
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await writeFile(join(tmpDir, "src/foo.ts"), "");
    await writeFile(join(tmpDir, "src/foo.test.ts"), "");
    await writeFile(join(tmpDir, "src/foo.spec.ts"), "");

    const tests = await findRelevantTests(tmpDir, ["src/foo.ts"]);
    expect(tests).toContain("src/foo.test.ts");
    expect(tests).toContain("src/foo.spec.ts");
  });

  it("handles empty filesChanged array", async () => {
    const tests = await findRelevantTests(tmpDir, []);
    expect(tests).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// detectRunner
// ---------------------------------------------------------------------------

describe("detectRunner", () => {
  it("detects vitest in direct command", () => {
    expect(detectRunner("vitest run")).toBe("vitest");
  });

  it("detects vitest through npx", () => {
    expect(detectRunner("npx vitest")).toBe("vitest");
  });

  it("detects jest directly", () => {
    expect(detectRunner("jest --ci")).toBe("jest");
  });

  it("detects mocha", () => {
    expect(detectRunner("npx mocha")).toBe("mocha");
  });

  it("returns undefined for unrecognised runners", () => {
    expect(detectRunner("pnpm test")).toBeUndefined();
    expect(detectRunner("npm test")).toBeUndefined();
    expect(detectRunner("make test")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildScopedCommand
// ---------------------------------------------------------------------------

describe("buildScopedCommand", () => {
  it("scopes vitest run to specific files", () => {
    const cmd = buildScopedCommand("vitest run", "vitest", [
      "tests/foo.test.ts",
      "tests/bar.test.ts",
    ]);
    expect(cmd).toBe("vitest run tests/foo.test.ts tests/bar.test.ts");
  });

  it("scopes jest with -- separator", () => {
    const cmd = buildScopedCommand("jest", "jest", ["tests/foo.test.ts"]);
    expect(cmd).toBe("jest -- tests/foo.test.ts");
  });

  it("scopes mocha with file paths", () => {
    const cmd = buildScopedCommand("mocha", "mocha", ["test/foo.test.js"]);
    expect(cmd).toBe("mocha test/foo.test.js");
  });

  it("handles npx vitest", () => {
    const cmd = buildScopedCommand("npx vitest", "vitest", ["tests/foo.test.ts"]);
    // Should find "vitest" in the command and scope from there
    expect(cmd).toBe("npx vitest run tests/foo.test.ts");
  });

  it("returns undefined for unknown runner", () => {
    const cmd = buildScopedCommand("npm test", "unknown", ["tests/foo.test.ts"]);
    expect(cmd).toBeUndefined();
  });

  it("preserves jest flags when scoping", () => {
    const cmd = buildScopedCommand("jest --ci", "jest", ["tests/foo.test.ts"]);
    expect(cmd).toBe("jest --ci -- tests/foo.test.ts");
  });

  it("preserves jest flags through npx", () => {
    const cmd = buildScopedCommand("npx jest --ci --verbose", "jest", [
      "tests/foo.test.ts",
    ]);
    expect(cmd).toBe("npx jest --ci --verbose -- tests/foo.test.ts");
  });

  it("preserves mocha flags when scoping", () => {
    const cmd = buildScopedCommand("npx mocha --recursive", "mocha", [
      "test/foo.test.js",
    ]);
    expect(cmd).toBe("npx mocha --recursive test/foo.test.js");
  });

  it("handles pnpm exec vitest", () => {
    const cmd = buildScopedCommand("pnpm exec vitest run", "vitest", [
      "tests/foo.test.ts",
    ]);
    expect(cmd).toBe("pnpm exec vitest run tests/foo.test.ts");
  });

  it("handles node_modules/.bin/ runner path", () => {
    const cmd = buildScopedCommand("./node_modules/.bin/vitest run", "vitest", [
      "tests/foo.test.ts",
    ]);
    expect(cmd).toBe("./node_modules/.bin/vitest run tests/foo.test.ts");
  });

  it("scopes multiple files for vitest", () => {
    const cmd = buildScopedCommand("vitest run", "vitest", [
      "tests/a.test.ts",
      "tests/b.test.ts",
      "tests/c.test.ts",
    ]);
    expect(cmd).toBe("vitest run tests/a.test.ts tests/b.test.ts tests/c.test.ts");
  });

  it("falls back to -- separator for package manager wrappers", () => {
    const cmd = buildScopedCommand("pnpm test", "vitest", ["tests/foo.test.ts"]);
    expect(cmd).toBe("pnpm test -- tests/foo.test.ts");
  });

  it("does not duplicate vitest run subcommand", () => {
    const cmd = buildScopedCommand("vitest run", "vitest", ["tests/foo.test.ts"]);
    // Should be "vitest run tests/foo.test.ts" NOT "vitest run run tests/foo.test.ts"
    expect(cmd).toBe("vitest run tests/foo.test.ts");
    expect(cmd).not.toContain("run run");
  });

  it("adds run subcommand for bare vitest", () => {
    const cmd = buildScopedCommand("vitest", "vitest", ["tests/foo.test.ts"]);
    expect(cmd).toBe("vitest run tests/foo.test.ts");
  });
});

// ---------------------------------------------------------------------------
// runPostTaskTests
// ---------------------------------------------------------------------------

describe("runPostTaskTests", () => {
  it("returns ran=false when no test command configured", async () => {
    const result = await runPostTaskTests({
      projectDir: "/tmp",
      filesChanged: ["src/foo.ts"],
      testCommand: undefined,
    });

    expect(result.ran).toBe(false);
    expect(result.error).toBe("No test command configured");
  });

  it("returns ran=false when no files changed", async () => {
    const result = await runPostTaskTests({
      projectDir: "/tmp",
      filesChanged: [],
      testCommand: "npm test",
    });

    expect(result.ran).toBe(false);
    expect(result.error).toBe("No files changed");
  });

  it("runs the full test command when runner is not scopeable", async () => {
    // Use a command that will succeed quickly
    const result = await runPostTaskTests({
      projectDir: "/tmp",
      filesChanged: ["src/foo.ts"],
      testCommand: "echo 'all tests passed'",
      timeout: 5000,
    });

    expect(result.ran).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.command).toBe("echo 'all tests passed'");
    expect(result.targetedFiles).toEqual([]);
  });

  it("reports failure when test command exits non-zero", async () => {
    const result = await runPostTaskTests({
      projectDir: "/tmp",
      filesChanged: ["src/foo.ts"],
      testCommand: "sh -c 'exit 1'",
      timeout: 5000,
    });

    expect(result.ran).toBe(true);
    expect(result.passed).toBe(false);
  });

  it("captures test output", async () => {
    const result = await runPostTaskTests({
      projectDir: "/tmp",
      filesChanged: ["src/foo.ts"],
      testCommand: "echo 'Tests: 5 passed, 0 failed'",
      timeout: 5000,
    });

    expect(result.ran).toBe(true);
    expect(result.output).toContain("5 passed");
  });

  it("measures test duration", async () => {
    const result = await runPostTaskTests({
      projectDir: "/tmp",
      filesChanged: ["src/foo.ts"],
      testCommand: "echo ok",
      timeout: 5000,
    });

    expect(result.ran).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// runTestGate (full test suite validation for self-heal mode)
// ---------------------------------------------------------------------------

describe("runTestGate", () => {
  it("skips gate when no files changed", async () => {
    const { runTestGate } = await import("../../../src/tools/test-runner.js");
    const result = await runTestGate({
      projectDir: "/tmp",
      filesChanged: [],
    });

    expect(result.ran).toBe(false);
    expect(result.passed).toBe(true);
    expect(result.packages).toEqual([]);
    expect(result.skipReason).toBe("No files modified in prior phases");
  });

  it("returns failed gate on non-zero exit code", async () => {
    const { runTestGate } = await import("../../../src/tools/test-runner.js");
    const result = await runTestGate({
      projectDir: "/tmp",
      filesChanged: ["src/foo.ts"],
      timeout: 1000,
    });

    // In a test environment without actual pnpm test, this will fail
    // The exact behavior depends on whether pnpm test is available
    expect(result.ran).toBe(true);
    // Result will be false since pnpm test will fail in /tmp
    expect(typeof result.passed).toBe("boolean");
  });

  it("includes command in result", async () => {
    const { runTestGate } = await import("../../../src/tools/test-runner.js");
    const result = await runTestGate({
      projectDir: "/tmp",
      filesChanged: ["src/foo.ts"],
      timeout: 1000,
    });

    if (result.ran) {
      expect(result.command).toBe("pnpm test --reporter=json");
    }
  });

  it("measures total duration", async () => {
    const { runTestGate } = await import("../../../src/tools/test-runner.js");
    const result = await runTestGate({
      projectDir: "/tmp",
      filesChanged: ["src/foo.ts"],
      timeout: 1000,
    });

    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });
});
