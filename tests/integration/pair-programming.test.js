/**
 * Pair-programming cross-vendor review — integration tests.
 *
 * These tests exercise the pure logic in packages/core/pair-programming.js:
 * test-command reading, reviewer resolution, shell test execution, review
 * orchestration, and output formatting. They do NOT require real vendor
 * CLIs (claude/codex) to be installed — availability-dependent paths are
 * covered by the fallback tests.
 *
 * AC coverage:
 *   • codex-primary → claude reviewer direction
 *   • claude-primary → codex reviewer direction
 *   • passing test command → result.passed === true
 *   • failing test command → result.passed === false, exits non-zero
 *   • reviewer unavailable → skipped with warning
 *   • no test command → skipped with warning
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Import from built dist/ so we test the compiled module boundary, not source.
// The test runner is invoked after `pnpm build` (see globalSetup).
const {
  readRexTestCommand,
  resolveReviewerVendor,
  resolveVendorCliPath,
  checkReviewerAvailability,
  runShellTestCommand,
  runCrossVendorReview,
  formatReviewBanner,
} = await import(
  "../../packages/core/pair-programming.js"
);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ndx-pair-prog-"));
});

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function writeRexConfig(dir, config) {
  const rexDir = join(dir, ".rex");
  mkdirSync(rexDir, { recursive: true });
  writeFileSync(join(rexDir, "config.json"), JSON.stringify(config), "utf-8");
}

function writeNdxConfig(dir, config) {
  writeFileSync(join(dir, ".n-dx.json"), JSON.stringify(config), "utf-8");
}

// ---------------------------------------------------------------------------
// readRexTestCommand
// ---------------------------------------------------------------------------

describe("readRexTestCommand", () => {
  it("returns undefined when .rex/config.json does not exist", () => {
    expect(readRexTestCommand(tmpDir)).toBeUndefined();
  });

  it("returns undefined when test field is absent", () => {
    writeRexConfig(tmpDir, { schema: "rex/v1", project: "test" });
    expect(readRexTestCommand(tmpDir)).toBeUndefined();
  });

  it("returns the configured test command", () => {
    writeRexConfig(tmpDir, { schema: "rex/v1", project: "test", test: "pnpm test" });
    expect(readRexTestCommand(tmpDir)).toBe("pnpm test");
  });

  it("trims whitespace", () => {
    writeRexConfig(tmpDir, { schema: "rex/v1", project: "test", test: "  npm test  " });
    expect(readRexTestCommand(tmpDir)).toBe("npm test");
  });

  it("returns undefined for empty string", () => {
    writeRexConfig(tmpDir, { schema: "rex/v1", project: "test", test: "   " });
    expect(readRexTestCommand(tmpDir)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// resolveReviewerVendor — both directions
// ---------------------------------------------------------------------------

describe("resolveReviewerVendor", () => {
  it("codex primary → claude reviewer", () => {
    expect(resolveReviewerVendor("codex")).toBe("claude");
  });

  it("claude primary → codex reviewer", () => {
    expect(resolveReviewerVendor("claude")).toBe("codex");
  });
});

// ---------------------------------------------------------------------------
// resolveVendorCliPath
// ---------------------------------------------------------------------------

describe("resolveVendorCliPath", () => {
  it("falls back to vendor name when no config exists", () => {
    expect(resolveVendorCliPath(tmpDir, "claude")).toBe("claude");
    expect(resolveVendorCliPath(tmpDir, "codex")).toBe("codex");
  });

  it("uses llm.<vendor>.cli_path from .n-dx.json", () => {
    writeNdxConfig(tmpDir, { llm: { claude: { cli_path: "/custom/claude" } } });
    expect(resolveVendorCliPath(tmpDir, "claude")).toBe("/custom/claude");
  });

  it("uses legacy claude.cli_path for claude vendor", () => {
    writeNdxConfig(tmpDir, { claude: { cli_path: "/legacy/claude" } });
    expect(resolveVendorCliPath(tmpDir, "claude")).toBe("/legacy/claude");
  });

  it("prefers llm.<vendor>.cli_path over legacy key", () => {
    writeNdxConfig(tmpDir, {
      llm: { claude: { cli_path: "/new/claude" } },
      claude: { cli_path: "/old/claude" },
    });
    expect(resolveVendorCliPath(tmpDir, "claude")).toBe("/new/claude");
  });
});

// ---------------------------------------------------------------------------
// runShellTestCommand — with mock test commands
// ---------------------------------------------------------------------------

describe("runShellTestCommand", () => {
  it("returns exitCode 0 for a passing command", async () => {
    const result = await runShellTestCommand("node -e \"process.exit(0)\"", tmpDir);
    expect(result.exitCode).toBe(0);
  });

  it("returns exitCode 1 for a failing command", async () => {
    const result = await runShellTestCommand("node -e \"process.exit(1)\"", tmpDir);
    expect(result.exitCode).toBe(1);
  });

  it("captures stdout output", async () => {
    const result = await runShellTestCommand(
      "node -e \"process.stdout.write('tests passed\\n')\"",
      tmpDir,
    );
    expect(result.output).toContain("tests passed");
    expect(result.exitCode).toBe(0);
  });

  it("captures stderr output", async () => {
    const result = await runShellTestCommand(
      "node -e \"process.stderr.write('test failure\\n'); process.exit(1)\"",
      tmpDir,
    );
    expect(result.output).toContain("test failure");
    expect(result.exitCode).toBe(1);
  });

  it("handles command not found gracefully (exits non-zero)", async () => {
    const result = await runShellTestCommand(
      "__ndx_nonexistent_command_xyz__",
      tmpDir,
    );
    // Shell returns 127 for command-not-found; our wrapper treats any non-zero as failure.
    expect(result.exitCode).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// runCrossVendorReview — both vendor directions with mock test commands
// ---------------------------------------------------------------------------

describe("runCrossVendorReview — codex primary / claude reviewer", () => {
  it("skips when reviewer CLI is unavailable", async () => {
    writeRexConfig(tmpDir, { test: "node -e \"process.exit(0)\"" });
    // Claude binary deliberately set to a path that does not exist
    writeNdxConfig(tmpDir, { llm: { claude: { cli_path: "/nonexistent/claude-xxx" } } });

    const result = await runCrossVendorReview({
      dir: tmpDir,
      reviewer: "claude",
      testCommand: "node -e \"process.exit(0)\"",
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toContain("claude");
  });

  it("skips when no test command is provided", async () => {
    // Even if claude were available, no testCommand → skip
    const result = await runCrossVendorReview({
      dir: tmpDir,
      reviewer: "claude",
      testCommand: undefined,
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toContain("test command");
  });
});

describe("runCrossVendorReview — claude primary / codex reviewer", () => {
  it("skips when reviewer CLI is unavailable", async () => {
    writeNdxConfig(tmpDir, { llm: { codex: { cli_path: "/nonexistent/codex-xxx" } } });

    const result = await runCrossVendorReview({
      dir: tmpDir,
      reviewer: "codex",
      testCommand: "node -e \"process.exit(0)\"",
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toContain("codex");
  });

  it("skips when no test command is provided", async () => {
    const result = await runCrossVendorReview({
      dir: tmpDir,
      reviewer: "codex",
      testCommand: undefined,
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toContain("test command");
  });
});

// ---------------------------------------------------------------------------
// runCrossVendorReview — real test execution (using 'node' as proxy binary)
// ---------------------------------------------------------------------------

describe("runCrossVendorReview — real test execution when reviewer is available", () => {
  it("returns passed=true when test command succeeds", async () => {
    // Override reviewer CLI path to 'node --version' which succeeds
    // and the test command is a passing node script.
    // We use 'node' as the mock reviewer binary (it responds to --version).
    writeNdxConfig(tmpDir, { llm: { codex: { cli_path: process.execPath } } });

    const result = await runCrossVendorReview({
      dir: tmpDir,
      reviewer: "codex",
      testCommand: `${process.execPath} -e "process.exit(0)"`,
    });

    expect(result.skipped).toBe(false);
    expect(result.passed).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it("returns passed=false when test command fails", async () => {
    writeNdxConfig(tmpDir, { llm: { codex: { cli_path: process.execPath } } });

    const result = await runCrossVendorReview({
      dir: tmpDir,
      reviewer: "codex",
      testCommand: `${process.execPath} -e "process.stderr.write('FAIL: 2 tests failed\\n'); process.exit(1)"`,
    });

    expect(result.skipped).toBe(false);
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("FAIL");
  });

  it("same behaviour for claude reviewer direction", async () => {
    writeNdxConfig(tmpDir, { llm: { claude: { cli_path: process.execPath } } });

    const result = await runCrossVendorReview({
      dir: tmpDir,
      reviewer: "claude",
      testCommand: `${process.execPath} -e "process.exit(0)"`,
    });

    expect(result.skipped).toBe(false);
    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatReviewBanner
// ---------------------------------------------------------------------------

describe("formatReviewBanner", () => {
  it("shows skipped message with reason", () => {
    const output = formatReviewBanner("claude", { skipped: true, reason: "CLI not found" });
    expect(output).toContain("Reviewer (claude)");
    expect(output).toContain("Review skipped");
    expect(output).toContain("CLI not found");
  });

  it("shows passing verdict", () => {
    const output = formatReviewBanner("codex", {
      skipped: false,
      passed: true,
      command: "pnpm test",
    });
    expect(output).toContain("Reviewer (codex)");
    expect(output).toContain("All tests passed");
    expect(output).toContain("pnpm test");
  });

  it("shows failing verdict with output", () => {
    const output = formatReviewBanner("claude", {
      skipped: false,
      passed: false,
      command: "npm test",
      output: "AssertionError: expected 1 to equal 2",
      exitCode: 1,
    });
    expect(output).toContain("Reviewer (claude)");
    expect(output).toContain("Tests failed");
    expect(output).toContain("AssertionError");
    expect(output).toContain("npm test");
  });

  it("codex primary uses claude reviewer label", () => {
    const reviewer = resolveReviewerVendor("codex");
    const output = formatReviewBanner(reviewer, { skipped: true, reason: "x" });
    expect(output).toContain("Reviewer (claude)");
  });

  it("claude primary uses codex reviewer label", () => {
    const reviewer = resolveReviewerVendor("claude");
    const output = formatReviewBanner(reviewer, { skipped: true, reason: "x" });
    expect(output).toContain("Reviewer (codex)");
  });
});
