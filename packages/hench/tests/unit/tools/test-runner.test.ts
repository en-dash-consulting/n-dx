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
// runPostTaskTests reaches `exec("sh", ["-c", cmd])` on every platform, so the
// cases that actually run a command need a POSIX shell. The early-return cases
// (no test command, no files changed) do not, and stay unguarded.
import { itNeedsPosixShell } from "../../helpers/posix-shell.js";
import { osPath, osPrefix } from "../../helpers/index.js";

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
    // NOT osPath(): this is the early-return path (test-runner.ts:101), which
    // echoes the input verbatim rather than constructing a path with join(). So
    // the separators are whatever the caller passed — unlike every other case
    // below, where production builds the path and therefore uses the OS
    // separator. Wrapping this one would assert the wrong contract.
    const paths = candidateTestPaths("src/foo.test.ts");
    expect(paths).toEqual(["src/foo.test.ts"]);
  });

  it("generates co-located test and spec variants", () => {
    const paths = candidateTestPaths("src/agent/loop.ts");
    expect(paths).toContain(osPath("src/agent/loop.test.ts"));
    expect(paths).toContain(osPath("src/agent/loop.spec.ts"));
  });

  it("generates __tests__ directory variants", () => {
    const paths = candidateTestPaths("src/agent/loop.ts");
    expect(paths).toContain(osPath("src/agent/__tests__/loop.test.ts"));
    expect(paths).toContain(osPath("src/agent/__tests__/loop.spec.ts"));
  });

  it("generates tests/ directory variants", () => {
    const paths = candidateTestPaths("src/agent/loop.ts");
    expect(paths).toContain(osPath("src/agent/tests/loop.test.ts"));
    expect(paths).toContain(osPath("src/agent/tests/loop.spec.ts"));
  });

  it("generates mirrored src → tests paths", () => {
    const paths = candidateTestPaths("src/agent/loop.ts");
    expect(paths).toContain(osPath("tests/agent/loop.test.ts"));
    expect(paths).toContain(osPath("tests/agent/loop.spec.ts"));
    // Also __tests__ mirror
    expect(paths).toContain(osPath("__tests__/agent/loop.test.ts"));
  });

  it("does not generate src → tests mirror for non-src paths", () => {
    const paths = candidateTestPaths("lib/utils.ts");
    // Should still have co-located candidates
    expect(paths).toContain(osPath("lib/utils.test.ts"));
    // But no mirror paths
    expect(paths.every((p) => !p.startsWith(osPrefix("tests/")))).toBe(true);
  });

  it("preserves file extension", () => {
    const paths = candidateTestPaths("src/foo.jsx");
    expect(paths).toContain(osPath("src/foo.test.jsx"));
    expect(paths).toContain(osPath("src/foo.spec.jsx"));
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
    expect(tests).toEqual([osPath("src/agent/loop.test.ts")]);
  });

  it("finds .spec variant co-located test file", async () => {
    await mkdir(join(tmpDir, "src/utils"), { recursive: true });
    await writeFile(join(tmpDir, "src/utils/helpers.ts"), "");
    await writeFile(join(tmpDir, "src/utils/helpers.spec.ts"), "");

    const tests = await findRelevantTests(tmpDir, ["src/utils/helpers.ts"]);
    expect(tests).toContain(osPath("src/utils/helpers.spec.ts"));
  });

  it("finds test files in __tests__ directory", async () => {
    await mkdir(join(tmpDir, "src/agent"), { recursive: true });
    await mkdir(join(tmpDir, "src/agent/__tests__"), { recursive: true });
    await writeFile(join(tmpDir, "src/agent/loop.ts"), "");
    await writeFile(join(tmpDir, "src/agent/__tests__/loop.test.ts"), "");

    const tests = await findRelevantTests(tmpDir, ["src/agent/loop.ts"]);
    expect(tests).toContain(osPath("src/agent/__tests__/loop.test.ts"));
  });

  it("finds test files via src → tests mirror", async () => {
    await mkdir(join(tmpDir, "src/agent"), { recursive: true });
    await mkdir(join(tmpDir, "tests/agent"), { recursive: true });
    await writeFile(join(tmpDir, "src/agent/loop.ts"), "");
    await writeFile(join(tmpDir, "tests/agent/loop.test.ts"), "");

    const tests = await findRelevantTests(tmpDir, ["src/agent/loop.ts"]);
    expect(tests).toContain(osPath("tests/agent/loop.test.ts"));
  });

  it("returns test file itself when a test file is in the changed list", async () => {
    await mkdir(join(tmpDir, "src/agent"), { recursive: true });
    await writeFile(join(tmpDir, "src/agent/loop.test.ts"), "");

    const tests = await findRelevantTests(tmpDir, ["src/agent/loop.test.ts"]);
    expect(tests).toEqual([osPath("src/agent/loop.test.ts")]);
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
    expect(tests).toEqual([osPath("src/foo.test.ts")]);
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
    expect(tests).toContain(osPath("src/foo.test.ts"));
  });

  it("finds tests for multiple distinct source files", async () => {
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await writeFile(join(tmpDir, "src/foo.ts"), "");
    await writeFile(join(tmpDir, "src/foo.test.ts"), "");
    await writeFile(join(tmpDir, "src/bar.ts"), "");
    await writeFile(join(tmpDir, "src/bar.test.ts"), "");

    const tests = await findRelevantTests(tmpDir, ["src/foo.ts", "src/bar.ts"]);
    expect(tests).toContain(osPath("src/foo.test.ts"));
    expect(tests).toContain(osPath("src/bar.test.ts"));
    expect(tests).toHaveLength(2);
  });

  it("finds multiple test files for a single source file", async () => {
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await writeFile(join(tmpDir, "src/foo.ts"), "");
    await writeFile(join(tmpDir, "src/foo.test.ts"), "");
    await writeFile(join(tmpDir, "src/foo.spec.ts"), "");

    const tests = await findRelevantTests(tmpDir, ["src/foo.ts"]);
    expect(tests).toContain(osPath("src/foo.test.ts"));
    expect(tests).toContain(osPath("src/foo.spec.ts"));
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

  // ── Shell-safety of embedded paths ──────────────────────────────────────
  //
  // The command produced here is executed via execShellCmd, i.e.
  // `exec("sh", ["-c", cmd])` on EVERY platform. A POSIX shell reads each
  // backslash as an escape, so an OS-native Windows path embedded in this string
  // arrives at the runner as "srcagentloop.test.ts", the filter matches nothing,
  // and vitest exits 1 — every scoped post-task run on Windows reported failure
  // regardless of the code.
  //
  // The INPUT is built with osPath() rather than hardcoded backslashes.
  // toCommandPath splits on `sep`, which is deliberately the identity on POSIX —
  // a backslash is a legal character in a POSIX filename — so hardcoded
  // backslashes assert Windows behaviour and fail on a Linux host. That is
  // exactly how these passed locally and broke ubuntu CI. osPath gives each
  // platform the path its own path.join would produce, while the OUTPUT
  // assertion stays forward-slashed on both, which is the actual contract.

  it("emits forward slashes even when given OS-native paths", () => {
    const cmd = buildScopedCommand("vitest run", "vitest", [
      osPath("src/agent/loop.test.ts"),
      osPath("src/utils/helpers.test.ts"),
    ]);

    expect(cmd).toBe("vitest run src/agent/loop.test.ts src/utils/helpers.test.ts");
    // The specific failure mode: a backslash surviving into the command string.
    expect(cmd).not.toContain("\\");
  });

  it("emits forward slashes for the package-manager wrapper form too", () => {
    const cmd = buildScopedCommand("pnpm test", "vitest", [osPath("src/agent/loop.test.ts")]);

    // No "run" here: that subcommand is only injected when the runner appears
    // explicitly in the command. The wrapper branch appends files after "--".
    expect(cmd).toBe("pnpm test -- src/agent/loop.test.ts");
    expect(cmd).not.toContain("\\");
  });

  it("emits forward-slash Go package patterns from OS-native paths", () => {
    // Go package patterns REQUIRE forward slashes — "./internal\handler/..." is
    // not merely shell-fragile, it is invalid Go syntax.
    const cmd = buildScopedCommand("go test ./...", "go", [
      osPath("internal/handler/user_test.go"),
    ]);

    expect(cmd).toBe("go test ./internal/handler/...");
    expect(cmd).not.toContain("\\");
  });

  it("leaves already-POSIX paths untouched", () => {
    const cmd = buildScopedCommand("vitest run", "vitest", ["src/agent/loop.test.ts"]);
    expect(cmd).toBe("vitest run src/agent/loop.test.ts");
  });
});

// ---------------------------------------------------------------------------
// runPostTaskTests
// ---------------------------------------------------------------------------

describe("runPostTaskTests", () => {
  // A REAL directory, not "/tmp": path.resolve("/tmp") is "C:\tmp" on Windows
  // and does not exist, so every spawn here failed on a nonexistent cwd. That
  // broke the two output-asserting tests and, worse, let the others pass for the
  // wrong reason — a spawn that never ran looks like a command that failed.
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-post-task-tests-"));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("returns ran=false when no test command configured", async () => {
    const result = await runPostTaskTests({
      projectDir,
      filesChanged: ["src/foo.ts"],
      testCommand: undefined,
    });

    expect(result.ran).toBe(false);
    expect(result.error).toBe("No test command configured");
  });

  it("returns ran=false when no files changed", async () => {
    const result = await runPostTaskTests({
      projectDir,
      filesChanged: [],
      testCommand: "npm test",
    });

    expect(result.ran).toBe(false);
    expect(result.error).toBe("No files changed");
  });

  itNeedsPosixShell("runs the full test command when runner is not scopeable", async () => {
    // Use a command that will succeed quickly
    const result = await runPostTaskTests({
      projectDir,
      filesChanged: ["src/foo.ts"],
      testCommand: "echo all tests passed",
      timeout: 5000,
    });

    expect(result.ran).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.command).toBe("echo all tests passed");
    expect(result.targetedFiles).toEqual([]);
  });

  // Guarded despite passing without a shell: `sh -c 'exit 1'` failing to spawn
  // also yields passed=false, so the assertion held for the wrong reason.
  itNeedsPosixShell("reports failure when test command exits non-zero", async () => {
    const result = await runPostTaskTests({
      projectDir,
      filesChanged: ["src/foo.ts"],
      testCommand: "sh -c 'exit 1'",
      timeout: 5000,
    });

    expect(result.ran).toBe(true);
    expect(result.passed).toBe(false);
  });

  itNeedsPosixShell("captures test output", async () => {
    const result = await runPostTaskTests({
      projectDir,
      filesChanged: ["src/foo.ts"],
      testCommand: "echo Tests: 5 passed, 0 failed",
      timeout: 5000,
    });

    expect(result.ran).toBe(true);
    expect(result.output).toContain("5 passed");
  });

  itNeedsPosixShell("measures test duration", async () => {
    const result = await runPostTaskTests({
      projectDir,
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
  // Same reason as runPostTaskTests above: these previously passed
  // projectDir: "/tmp", which is the nonexistent "C:\tmp" on Windows.
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-test-gate-"));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("skips gate when no files changed", async () => {
    const { runTestGate } = await import("../../../src/tools/test-runner.js");
    const result = await runTestGate({
      projectDir,
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
      projectDir,
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
      projectDir,
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
      projectDir,
      filesChanged: ["src/foo.ts"],
      timeout: 1000,
    });

    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });
});

/**
 * A suite that never started is not a suite that failed.
 *
 * `exec` reports a spawn failure as exitCode 1 with empty stdout/stderr — byte
 * for byte what a real failing exit looks like — so the only thing separating
 * the two is `ExecResult.launched`. Reading exitCode alone reported "your tests
 * failed" for a command that never ran, and in autonomous mode that aborted the
 * run, suppressing the PRD completion write and the commit for work that was
 * already finished. On Windows without a POSIX shell it fired on every task.
 *
 * These drive `launched` directly rather than trying to arrange a real spawn
 * failure, because the interesting input is exactly the field under test and a
 * genuine ENOENT is not reproducible across platforms.
 */
describe("runTestGate — launched vs failed", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-gate-launched-"));
    vi.resetModules();
  });

  afterEach(async () => {
    vi.doUnmock("../../../src/process/exec.js");
    vi.resetModules();
    await rm(projectDir, { recursive: true, force: true });
  });

  /** Load runTestGate with execShellCmd stubbed to a fixed ExecResult. */
  async function withExecResult(result: {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    error: Error | null;
    launched: boolean;
  }) {
    vi.doMock("../../../src/process/exec.js", () => ({
      execShellCmd: async () => result,
    }));
    return (await import("../../../src/tools/test-runner.js")).runTestGate;
  }

  it("reports a suite that never launched as inconclusive, not as failing tests", async () => {
    const runTestGate = await withExecResult({
      stdout: "",
      stderr: "",
      exitCode: 1,
      error: new Error("spawn sh ENOENT"),
      launched: false,
    });

    const result = await runTestGate({
      projectDir,
      filesChanged: ["src/foo.ts"],
      testCommand: "npm run test",
    });

    // `ran: false` is the whole point — it is what stops the lifecycle treating
    // this as a verdict and failing the run.
    expect(result.ran).toBe(false);

    // Not a deliberate skip. A skipReason would make the lifecycle report this
    // as "Skipped: …" and say nothing was wrong.
    expect(result.skipReason).toBeUndefined();

    // The reason must name the underlying spawn failure — including the shell,
    // which is what "spawn sh ENOENT" carries — so an operator can act on it.
    expect(result.error).toContain("never launched");
    expect(result.error).toContain("spawn sh ENOENT");
  });

  it("still reports a genuine non-zero exit as a test failure", async () => {
    const runTestGate = await withExecResult({
      stdout: "",
      stderr: "1 test failed in packages/rex",
      exitCode: 1,
      error: new Error("Command failed"),
      launched: true,
    });

    const result = await runTestGate({
      projectDir,
      filesChanged: ["src/foo.ts"],
      testCommand: "npm run test",
    });

    // The regression guard for the fix above: a command that DID run and exited
    // non-zero must keep failing the gate. `launched: true` with a non-zero exit
    // is a real result, not an infrastructure problem.
    expect(result.ran).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.packages.length).toBeGreaterThan(0);
  });

  /**
   * The real `npm run test` summary from this repo, which is what
   * autoDetectTestCommand selects. Not vitest JSON, and the summary is on
   * STDOUT — the two facts that together produced an empty package list.
   */
  const RUN_ALL_TESTS_OUTPUT = [
    "──────── summary ────────",
    "",
    "  PASS  root (tests/**)",
    "  PASS  @n-dx/hench",
    "  PASS  @n-dx/llm-client",
    "  FAIL  @n-dx/rex",
    "  PASS  @n-dx/sourcevision",
    "  PASS  @n-dx/web",
    "",
    "5/6 suites passed — failed: @n-dx/rex",
  ].join("\n");

  it("surfaces raw output when the runner is not vitest JSON", async () => {
    const runTestGate = await withExecResult({
      stdout: RUN_ALL_TESTS_OUTPUT,
      stderr: "",
      exitCode: 1,
      error: new Error("Command failed"),
      launched: true,
    });

    const result = await runTestGate({
      projectDir,
      filesChanged: ["src/foo.ts"],
      testCommand: "npm run test",
    });

    expect(result.ran).toBe(true);
    expect(result.passed).toBe(false);

    // The defect: this was `[]`, which rendered as `0/0 package(s) failed`.
    expect(result.packages.length).toBeGreaterThan(0);

    // The operator has to be able to see what actually broke.
    const output = result.packages.map((p) => p.failureOutput ?? "").join("\n");
    expect(output).toContain("FAIL  @n-dx/rex");
    expect(output).toContain("5/6 suites passed");
  });

  it("names only the failing package, not every package in the summary", async () => {
    const runTestGate = await withExecResult({
      stdout: RUN_ALL_TESTS_OUTPUT,
      stderr: "",
      exitCode: 1,
      error: new Error("Command failed"),
      launched: true,
    });

    const result = await runTestGate({
      projectDir,
      filesChanged: ["src/foo.ts"],
      testCommand: "npm run test",
    });

    // Scanning the whole output for package names would collect all six, and
    // report five passing packages as failures.
    expect(result.packages.map((p) => p.name)).toEqual(["rex"]);
  });

  it("keeps the assertion message when the runner splits output across streams", async () => {
    // Vitest does exactly this: `×` markers and progress on stdout, the
    // AssertionError block on stderr. `truncateOutput(stdout, stderr, n)` takes
    // `stdout || stderr`, so a non-empty stdout dropped stderr and the operator
    // was told WHICH test failed but never WHY. Caught by running the real gate
    // against a deliberately failing test, not by this test — which exists so it
    // cannot come back.
    const runTestGate = await withExecResult({
      stdout: " ❯ tests/unit/x.test.ts (1 test | 1 failed)\n     × adds correctly",
      stderr: "AssertionError: expected 42 to be 43 // Object.is equality",
      exitCode: 1,
      error: new Error("Command failed"),
      launched: true,
    });

    const result = await runTestGate({
      projectDir,
      filesChanged: ["src/foo.ts"],
      testCommand: "npx vitest run",
    });

    const output = result.packages[0].failureOutput ?? "";
    expect(output).toContain("× adds correctly");
    expect(output).toContain("expected 42 to be 43");
  });

  it("reports a passing non-JSON run as passing, without attaching output", async () => {
    const runTestGate = await withExecResult({
      stdout: "6/6 suites passed",
      stderr: "",
      exitCode: 0,
      error: null,
      launched: true,
    });

    const result = await runTestGate({
      projectDir,
      filesChanged: ["src/foo.ts"],
      testCommand: "npm run test",
    });

    expect(result.passed).toBe(true);
    // Never `0/0`, even on the happy path — the count has to be honest.
    expect(result.packages.length).toBeGreaterThan(0);
    expect(result.packages.every((p) => p.passed)).toBe(true);
    expect(result.packages[0].failureOutput).toBeUndefined();
  });

  it("reports a silent failing command rather than returning nothing", async () => {
    const runTestGate = await withExecResult({
      stdout: "",
      stderr: "",
      exitCode: 1,
      error: new Error("Command failed"),
      launched: true,
    });

    const result = await runTestGate({
      projectDir,
      filesChanged: ["src/foo.ts"],
      testCommand: "npm run test",
    });

    expect(result.packages.length).toBeGreaterThan(0);
    expect(result.packages[0].failureOutput).toContain("no output");
  });

  it("reports a timeout distinctly, with the partial output and both durations", async () => {
    const runTestGate = await withExecResult({
      stdout: "running packages/rex…",
      stderr: "",
      exitCode: null,
      error: new Error("ETIMEDOUT"),
      launched: true,
    });

    const result = await runTestGate({
      projectDir,
      filesChanged: ["src/foo.ts"],
      testCommand: "npm run test",
      timeout: 90_000,
    });

    // A timeout still fails the run — a gate that cannot finish on freshly
    // changed code is a reason to stop — but says so in its own words.
    expect(result.ran).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.error).toContain("timed out");
    expect(result.error).toContain("1m 30s");

    // Distinct from a never-launched suite, which reports `ran: false`.
    expect(result.packages.length).toBeGreaterThan(0);
    expect(result.packages[0].failureOutput).toContain("running packages/rex");
  });

  it("still reports a genuine zero exit as a pass", async () => {
    const runTestGate = await withExecResult({
      stdout: JSON.stringify({
        numTotalTests: 1,
        numPassedTests: 1,
        numFailedTests: 0,
        testResults: [{ filepath: "packages/rex/x.test.ts", numFailingTests: 0 }],
      }),
      stderr: "",
      exitCode: 0,
      error: null,
      launched: true,
    });

    const result = await runTestGate({
      projectDir,
      filesChanged: ["src/foo.ts"],
      testCommand: "npm run test",
    });

    expect(result.ran).toBe(true);
    expect(result.passed).toBe(true);
  });
});
