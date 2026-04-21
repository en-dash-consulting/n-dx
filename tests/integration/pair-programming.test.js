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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Import from built dist/ so we test the compiled module boundary, not source.
// The test runner is invoked after `pnpm build` (see globalSetup).
const {
  readRexTestCommand,
  resolveReviewerVendor,
  resolveVendorCliPath,
  checkReviewerAvailability,
  getChangedFiles,
  buildReviewerPrompt,
  runReviewerLlm,
  runReviewerLlmCapturing,
  runShellTestCommand,
  runCrossVendorReview,
  formatReviewBanner,
  readContextMd,
  buildPrdStatusExcerpt,
  assembleNdxContext,
  writeNdxContextFile,
  parseReviewerOutput,
  buildRemediationContext,
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

/**
 * Write an executable mock reviewer script that exits with the given code.
 * The script accepts any arguments (including a prompt string) and ignores them.
 *
 * @param {string} dir       Directory to write the script into.
 * @param {number} exitCode  Exit code the script should produce.
 * @returns {string}         Absolute path to the script.
 */
function writeMockReviewer(dir, exitCode) {
  const scriptPath = join(dir, "mock-reviewer.js");
  writeFileSync(
    scriptPath,
    // Exit 0 for --version probe (availability check); exit configured code otherwise
    `#!/usr/bin/env node\n// Mock LLM reviewer\nif (process.argv[2] === '--version') { console.log('mock 1.0.0'); process.exit(0); }\nprocess.exit(${exitCode});\n`,
    "utf-8",
  );
  chmodSync(scriptPath, 0o755);
  return scriptPath;
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
    // Claude binary deliberately set to a path that does not exist
    writeNdxConfig(tmpDir, { llm: { claude: { cli_path: "/nonexistent/claude-xxx" } } });

    const result = await runCrossVendorReview({
      dir: tmpDir,
      reviewer: "claude",
      testCommand: `${process.execPath} -e "process.exit(0)"`,
    });

    expect(result.skipped).toBe(true);
    expect(result.mode).toBe("skipped");
    expect(result.reason).toContain("claude");
  });
});

describe("runCrossVendorReview — claude primary / codex reviewer", () => {
  it("skips when reviewer CLI is unavailable", async () => {
    writeNdxConfig(tmpDir, { llm: { codex: { cli_path: "/nonexistent/codex-xxx" } } });

    const result = await runCrossVendorReview({
      dir: tmpDir,
      reviewer: "codex",
      testCommand: `${process.execPath} -e "process.exit(0)"`,
    });

    expect(result.skipped).toBe(true);
    expect(result.mode).toBe("skipped");
    expect(result.reason).toContain("codex");
  });
});

// ---------------------------------------------------------------------------
// runCrossVendorReview — LLM reviewer invocation (using mock reviewer scripts)
// ---------------------------------------------------------------------------

describe("runCrossVendorReview — LLM reviewer invocation", () => {
  it("returns mode=llm-review and passed=true when mock reviewer exits 0", async () => {
    const scriptPath = writeMockReviewer(tmpDir, 0);
    writeNdxConfig(tmpDir, { llm: { codex: { cli_path: scriptPath } } });

    const result = await runCrossVendorReview({
      dir: tmpDir,
      reviewer: "codex",
      testCommand: `${process.execPath} -e "process.exit(0)"`,
    });

    expect(result.skipped).toBe(false);
    expect(result.mode).toBe("llm-review");
    expect(result.passed).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it("returns mode=llm-review and passed=false when mock reviewer exits 1", async () => {
    const scriptPath = writeMockReviewer(tmpDir, 1);
    writeNdxConfig(tmpDir, { llm: { codex: { cli_path: scriptPath } } });

    const result = await runCrossVendorReview({
      dir: tmpDir,
      reviewer: "codex",
      testCommand: `${process.execPath} -e "process.exit(0)"`,
    });

    expect(result.skipped).toBe(false);
    expect(result.mode).toBe("llm-review");
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it("same behaviour for claude reviewer direction", async () => {
    const scriptPath = writeMockReviewer(tmpDir, 0);
    writeNdxConfig(tmpDir, { llm: { claude: { cli_path: scriptPath } } });

    const result = await runCrossVendorReview({
      dir: tmpDir,
      reviewer: "claude",
      testCommand: `${process.execPath} -e "process.exit(0)"`,
    });

    expect(result.skipped).toBe(false);
    expect(result.mode).toBe("llm-review");
    expect(result.passed).toBe(true);
  });

  it("invokes LLM even when no test command is configured", async () => {
    const scriptPath = writeMockReviewer(tmpDir, 0);
    writeNdxConfig(tmpDir, { llm: { codex: { cli_path: scriptPath } } });

    const result = await runCrossVendorReview({
      dir: tmpDir,
      reviewer: "codex",
      testCommand: undefined,
    });

    expect(result.skipped).toBe(false);
    expect(result.mode).toBe("llm-review");
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

  it("shows llm-review passed verdict", () => {
    const output = formatReviewBanner("codex", {
      mode: "llm-review",
      skipped: false,
      passed: true,
      exitCode: 0,
      changedFiles: ["src/foo.ts", "src/bar.ts"],
    });
    expect(output).toContain("Reviewer (codex)");
    expect(output).toContain("LLM review passed");
    expect(output).toContain("src/foo.ts");
    expect(output).toContain("2 file(s)");
  });

  it("shows llm-review failed verdict", () => {
    const output = formatReviewBanner("claude", {
      mode: "llm-review",
      skipped: false,
      passed: false,
      exitCode: 1,
    });
    expect(output).toContain("Reviewer (claude)");
    expect(output).toContain("LLM review");
    expect(output).toContain("issues found");
    expect(output).toContain("Exit code: 1");
  });

  it("shows shell-test-only passed verdict", () => {
    const output = formatReviewBanner("codex", {
      mode: "shell-test-only",
      skipped: false,
      passed: true,
      command: "pnpm test",
    });
    expect(output).toContain("Reviewer (codex)");
    expect(output).toContain("Tests passed");
    expect(output).toContain("shell-test-only");
    expect(output).toContain("pnpm test");
  });

  it("shows shell-test-only failed verdict with output", () => {
    const output = formatReviewBanner("claude", {
      mode: "shell-test-only",
      skipped: false,
      passed: false,
      command: "npm test",
      output: "AssertionError: expected 1 to equal 2",
      exitCode: 1,
    });
    expect(output).toContain("Reviewer (claude)");
    expect(output).toContain("Tests failed");
    expect(output).toContain("shell-test-only");
    expect(output).toContain("AssertionError");
    expect(output).toContain("npm test");
  });

  it("legacy (no mode) shows passing verdict for backward compat", () => {
    const output = formatReviewBanner("codex", {
      skipped: false,
      passed: true,
      command: "pnpm test",
    });
    expect(output).toContain("Reviewer (codex)");
    expect(output).toContain("All tests passed");
    expect(output).toContain("pnpm test");
  });

  it("legacy (no mode) shows failing verdict for backward compat", () => {
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

// ---------------------------------------------------------------------------
// readContextMd
// ---------------------------------------------------------------------------

describe("readContextMd", () => {
  it("returns null with warning when .sourcevision/CONTEXT.md does not exist", () => {
    const result = readContextMd(tmpDir);
    expect(result.content).toBeNull();
    expect(result.warning).toContain("CONTEXT.md not found");
  });

  it("returns file content when CONTEXT.md exists", () => {
    const svDir = join(tmpDir, ".sourcevision");
    mkdirSync(svDir, { recursive: true });
    writeFileSync(join(svDir, "CONTEXT.md"), "# Codebase\nSome context here.", "utf-8");
    const result = readContextMd(tmpDir);
    expect(result.content).toBe("# Codebase\nSome context here.");
    expect(result.warning).toBeUndefined();
  });

  it("returns null with warning when .sourcevision dir exists but file is absent", () => {
    mkdirSync(join(tmpDir, ".sourcevision"), { recursive: true });
    const result = readContextMd(tmpDir);
    expect(result.content).toBeNull();
    expect(result.warning).toMatch(/CONTEXT\.md not found/);
  });
});

// ---------------------------------------------------------------------------
// buildPrdStatusExcerpt
// ---------------------------------------------------------------------------

describe("buildPrdStatusExcerpt", () => {
  it("returns null with warning when .rex/prd.json does not exist", () => {
    const result = buildPrdStatusExcerpt(tmpDir);
    expect(result.content).toBeNull();
    expect(result.warning).toContain("PRD not found");
  });

  it("returns compact title tree from a valid prd.json", () => {
    const rexDir = join(tmpDir, ".rex");
    mkdirSync(rexDir, { recursive: true });
    const prd = {
      schema: "rex/v1",
      title: "My Project",
      items: [
        {
          id: "e1",
          title: "Epic One",
          status: "in_progress",
          level: "epic",
          children: [
            { id: "t1", title: "Task A", status: "pending", level: "task", children: [] },
            { id: "t2", title: "Task B", status: "completed", level: "task", children: [] },
          ],
        },
      ],
    };
    writeFileSync(join(rexDir, "prd.json"), JSON.stringify(prd), "utf-8");
    const result = buildPrdStatusExcerpt(tmpDir);
    expect(result.content).toContain("# PRD: My Project");
    expect(result.content).toContain("Epic One");
    expect(result.content).toContain("Task A");
    expect(result.content).toContain("Task B");
    // Completed tasks get [x] marker
    expect(result.content).toContain("[x] Task B");
    // Pending tasks get [ ] marker
    expect(result.content).toContain("[ ] Task A");
    expect(result.warning).toBeUndefined();
  });

  it("returns null with warning for malformed JSON", () => {
    const rexDir = join(tmpDir, ".rex");
    mkdirSync(rexDir, { recursive: true });
    writeFileSync(join(rexDir, "prd.json"), "not valid json", "utf-8");
    const result = buildPrdStatusExcerpt(tmpDir);
    expect(result.content).toBeNull();
    expect(result.warning).toContain("Could not read");
  });
});

// ---------------------------------------------------------------------------
// assembleNdxContext
// ---------------------------------------------------------------------------

describe("assembleNdxContext", () => {
  it("returns null text with two warnings when neither source exists", () => {
    const result = assembleNdxContext(tmpDir);
    expect(result.text).toBeNull();
    expect(result.warnings).toHaveLength(2);
  });

  it("returns only CONTEXT.md content when PRD is absent", () => {
    const svDir = join(tmpDir, ".sourcevision");
    mkdirSync(svDir, { recursive: true });
    writeFileSync(join(svDir, "CONTEXT.md"), "codebase summary", "utf-8");
    const result = assembleNdxContext(tmpDir);
    expect(result.text).toContain("codebase summary");
    expect(result.warnings).toHaveLength(1); // PRD warning only
  });

  it("returns only PRD excerpt when CONTEXT.md is absent", () => {
    const rexDir = join(tmpDir, ".rex");
    mkdirSync(rexDir, { recursive: true });
    const prd = { schema: "rex/v1", title: "Proj", items: [] };
    writeFileSync(join(rexDir, "prd.json"), JSON.stringify(prd), "utf-8");
    const result = assembleNdxContext(tmpDir);
    expect(result.text).toContain("# PRD: Proj");
    expect(result.warnings).toHaveLength(1); // CONTEXT.md warning only
  });

  it("combines both sources with a separator when both exist", () => {
    const svDir = join(tmpDir, ".sourcevision");
    mkdirSync(svDir, { recursive: true });
    writeFileSync(join(svDir, "CONTEXT.md"), "codebase summary", "utf-8");
    const rexDir = join(tmpDir, ".rex");
    mkdirSync(rexDir, { recursive: true });
    const prd = { schema: "rex/v1", title: "Proj", items: [] };
    writeFileSync(join(rexDir, "prd.json"), JSON.stringify(prd), "utf-8");
    const result = assembleNdxContext(tmpDir);
    expect(result.text).toContain("codebase summary");
    expect(result.text).toContain("# PRD: Proj");
    expect(result.text).toContain("---"); // separator
    expect(result.warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// writeNdxContextFile
// ---------------------------------------------------------------------------

describe("writeNdxContextFile", () => {
  it("writes text to a temp file and returns a valid path", async () => {
    const { existsSync, readFileSync, rmSync } = await import("node:fs");
    const path = writeNdxContextFile("hello context");
    try {
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, "utf-8")).toBe("hello context");
    } finally {
      try { rmSync(path, { force: true }); } catch { /* ignore */ }
    }
  });
});

// ---------------------------------------------------------------------------
// runCrossVendorReview — contextFiles forwarding
// ---------------------------------------------------------------------------

describe("runCrossVendorReview — contextFiles stored in result", () => {
  it("includes contextFiles in result when reviewer passes and contextFiles provided", async () => {
    const scriptPath = writeMockReviewer(tmpDir, 0);
    writeNdxConfig(tmpDir, { llm: { codex: { cli_path: scriptPath } } });
    const result = await runCrossVendorReview({
      dir: tmpDir,
      reviewer: "codex",
      testCommand: `${process.execPath} -e "process.exit(0)"`,
      contextFiles: ["/tmp/context.md"],
    });
    expect(result.skipped).toBe(false);
    expect(result.mode).toBe("llm-review");
    expect(result.passed).toBe(true);
    expect(result.contextFiles).toEqual(["/tmp/context.md"]);
  });

  it("does not add contextFiles property when no contextFiles provided", async () => {
    const scriptPath = writeMockReviewer(tmpDir, 0);
    writeNdxConfig(tmpDir, { llm: { codex: { cli_path: scriptPath } } });
    const result = await runCrossVendorReview({
      dir: tmpDir,
      reviewer: "codex",
      testCommand: `${process.execPath} -e "process.exit(0)"`,
    });
    expect(result.skipped).toBe(false);
    expect(result.contextFiles).toBeUndefined();
  });

  it("includes contextFiles in skipped result when reviewer CLI unavailable", async () => {
    writeNdxConfig(tmpDir, { llm: { codex: { cli_path: "/nonexistent/codex-xxx" } } });
    const result = await runCrossVendorReview({
      dir: tmpDir,
      reviewer: "codex",
      testCommand: `${process.execPath} -e "process.exit(0)"`,
      contextFiles: ["/tmp/ctx.md"],
    });
    expect(result.skipped).toBe(true);
    expect(result.contextFiles).toEqual(["/tmp/ctx.md"]);
  });
});

// ---------------------------------------------------------------------------
// getChangedFiles
// ---------------------------------------------------------------------------

describe("getChangedFiles", () => {
  it("returns empty array in a non-git directory", () => {
    // tmpDir has no .git — git commands fail silently
    const files = getChangedFiles(tmpDir);
    expect(Array.isArray(files)).toBe(true);
    expect(files).toHaveLength(0);
  });

  it("returns files from the last commit in a git repository", async () => {
    const { execFileSync: exec } = await import("node:child_process");
    // Bootstrap a minimal git repo with one commit
    exec("git", ["init"], { cwd: tmpDir, stdio: "pipe" });
    exec("git", ["config", "user.email", "test@test.com"], { cwd: tmpDir, stdio: "pipe" });
    exec("git", ["config", "user.name", "Test"], { cwd: tmpDir, stdio: "pipe" });
    writeFileSync(join(tmpDir, "hello.txt"), "hello", "utf-8");
    exec("git", ["add", "hello.txt"], { cwd: tmpDir, stdio: "pipe" });
    exec("git", ["commit", "-m", "init"], { cwd: tmpDir, stdio: "pipe" });

    const files = getChangedFiles(tmpDir);
    expect(files).toContain("hello.txt");
  });
});

// ---------------------------------------------------------------------------
// buildReviewerPrompt
// ---------------------------------------------------------------------------

describe("buildReviewerPrompt", () => {
  it("includes changed files in the prompt", () => {
    const prompt = buildReviewerPrompt({
      changedFiles: ["src/foo.ts", "src/bar.ts"],
      testCommand: "pnpm test",
    });
    expect(prompt).toContain("src/foo.ts");
    expect(prompt).toContain("src/bar.ts");
  });

  it("includes the test command when provided", () => {
    const prompt = buildReviewerPrompt({
      changedFiles: [],
      testCommand: "pnpm test",
    });
    expect(prompt).toContain("pnpm test");
  });

  it("omits test section when testCommand is absent", () => {
    const prompt = buildReviewerPrompt({
      changedFiles: ["src/foo.ts"],
      testCommand: undefined,
    });
    expect(prompt).not.toContain("Run the test command");
  });

  it("includes 20-line constraint", () => {
    const prompt = buildReviewerPrompt({ changedFiles: [], testCommand: undefined });
    expect(prompt).toContain("20 lines");
  });

  it("explicitly prohibits refactors", () => {
    const prompt = buildReviewerPrompt({ changedFiles: [], testCommand: undefined });
    expect(prompt).toMatch(/MUST NOT.*refactor/i);
  });

  it("uses fallback message when no changed files provided", () => {
    const prompt = buildReviewerPrompt({ changedFiles: [], testCommand: undefined });
    expect(prompt).toContain("no specific files identified");
  });
});

// ---------------------------------------------------------------------------
// runReviewerLlm
// ---------------------------------------------------------------------------

describe("runReviewerLlm", () => {
  it("returns exitCode 0 when mock reviewer script exits 0", async () => {
    const scriptPath = writeMockReviewer(tmpDir, 0);
    const result = await runReviewerLlm({ cliPath: scriptPath, prompt: "review this", dir: tmpDir });
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.spawnError).toBeUndefined();
  });

  it("returns exitCode 1 when mock reviewer script exits 1", async () => {
    const scriptPath = writeMockReviewer(tmpDir, 1);
    const result = await runReviewerLlm({ cliPath: scriptPath, prompt: "review this", dir: tmpDir });
    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(false);
  });

  it("returns spawnError when binary does not exist", async () => {
    const result = await runReviewerLlm({
      cliPath: "/nonexistent/binary-that-does-not-exist-xyz",
      prompt: "review",
      dir: tmpDir,
    });
    expect(result.exitCode).toBe(1);
    expect(result.spawnError).toBeDefined();
  });

  it("prepends 'review' subcommand when reviewer is codex", async () => {
    // Mock that writes argv to a file so we can inspect what args were passed
    const scriptPath = join(tmpDir, "argv-capture.js");
    const argvOutPath = join(tmpDir, "argv.json");
    writeFileSync(
      scriptPath,
      `#!/usr/bin/env node\nif (process.argv[2] === '--version') { console.log('1.0.0'); process.exit(0); }\nrequire('fs').writeFileSync(${JSON.stringify(argvOutPath)}, JSON.stringify(process.argv.slice(2)));\nprocess.exit(0);\n`,
      "utf-8",
    );
    chmodSync(scriptPath, 0o755);

    await runReviewerLlm({
      cliPath: scriptPath,
      prompt: "review this code",
      dir: tmpDir,
      reviewer: "codex",
    });

    const { readFileSync } = await import("node:fs");
    const capturedArgs = JSON.parse(readFileSync(argvOutPath, "utf-8"));
    expect(capturedArgs[0]).toBe("review");
    expect(capturedArgs[1]).toBe("review this code");
  });

  it("passes only the prompt when reviewer is claude", async () => {
    const scriptPath = join(tmpDir, "argv-capture.js");
    const argvOutPath = join(tmpDir, "argv.json");
    writeFileSync(
      scriptPath,
      `#!/usr/bin/env node\nif (process.argv[2] === '--version') { console.log('1.0.0'); process.exit(0); }\nrequire('fs').writeFileSync(${JSON.stringify(argvOutPath)}, JSON.stringify(process.argv.slice(2)));\nprocess.exit(0);\n`,
      "utf-8",
    );
    chmodSync(scriptPath, 0o755);

    await runReviewerLlm({
      cliPath: scriptPath,
      prompt: "review this code",
      dir: tmpDir,
      reviewer: "claude",
    });

    const { readFileSync } = await import("node:fs");
    const capturedArgs = JSON.parse(readFileSync(argvOutPath, "utf-8"));
    expect(capturedArgs).toEqual(["review this code"]);
  });

  it("passes only the prompt when reviewer is undefined (backward compat)", async () => {
    const scriptPath = join(tmpDir, "argv-capture.js");
    const argvOutPath = join(tmpDir, "argv.json");
    writeFileSync(
      scriptPath,
      `#!/usr/bin/env node\nif (process.argv[2] === '--version') { console.log('1.0.0'); process.exit(0); }\nrequire('fs').writeFileSync(${JSON.stringify(argvOutPath)}, JSON.stringify(process.argv.slice(2)));\nprocess.exit(0);\n`,
      "utf-8",
    );
    chmodSync(scriptPath, 0o755);

    await runReviewerLlm({
      cliPath: scriptPath,
      prompt: "review this code",
      dir: tmpDir,
    });

    const { readFileSync } = await import("node:fs");
    const capturedArgs = JSON.parse(readFileSync(argvOutPath, "utf-8"));
    expect(capturedArgs).toEqual(["review this code"]);
  });
});

// ---------------------------------------------------------------------------
// runReviewerLlmCapturing
// ---------------------------------------------------------------------------

describe("runReviewerLlmCapturing", () => {
  it("returns exitCode 0 and captures output when mock exits 0", async () => {
    const scriptPath = writeMockReviewer(tmpDir, 0);
    const result = await runReviewerLlmCapturing({
      cliPath: scriptPath,
      prompt: "review this",
      dir: tmpDir,
    });
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.spawnError).toBeUndefined();
    expect(typeof result.output).toBe("string");
  });

  it("returns exitCode 1 and captures output when mock exits 1", async () => {
    const scriptPath = writeMockReviewer(tmpDir, 1);
    const result = await runReviewerLlmCapturing({
      cliPath: scriptPath,
      prompt: "review this",
      dir: tmpDir,
    });
    expect(result.exitCode).toBe(1);
    expect(typeof result.output).toBe("string");
  });

  it("returns spawnError and empty output when binary does not exist", async () => {
    const result = await runReviewerLlmCapturing({
      cliPath: "/nonexistent/binary-that-does-not-exist-xyz",
      prompt: "review",
      dir: tmpDir,
    });
    expect(result.exitCode).toBe(1);
    expect(result.spawnError).toBeDefined();
    expect(result.output).toBe("");
  });

  it("captures stdout written by the child process", async () => {
    // Write a script that prints to stdout
    const scriptPath = join(tmpDir, "output-script.js");
    writeFileSync(
      scriptPath,
      `#!/usr/bin/env node\nif (process.argv[2] === '--version') { console.log('1.0.0'); process.exit(0); }\nprocess.stdout.write('PASS\\nAll looks good.\\n');\nprocess.exit(0);\n`,
      "utf-8",
    );
    chmodSync(scriptPath, 0o755);

    const result = await runReviewerLlmCapturing({
      cliPath: scriptPath,
      prompt: "review",
      dir: tmpDir,
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("PASS");
    expect(result.output).toContain("All looks good.");
  });

  it("prepends 'review' subcommand when reviewer is codex", async () => {
    const scriptPath = join(tmpDir, "argv-capture-cap.js");
    const argvOutPath = join(tmpDir, "argv-cap.json");
    writeFileSync(
      scriptPath,
      `#!/usr/bin/env node\nif (process.argv[2] === '--version') { console.log('1.0.0'); process.exit(0); }\nrequire('fs').writeFileSync(${JSON.stringify(argvOutPath)}, JSON.stringify(process.argv.slice(2)));\nprocess.exit(0);\n`,
      "utf-8",
    );
    chmodSync(scriptPath, 0o755);

    await runReviewerLlmCapturing({
      cliPath: scriptPath,
      prompt: "review this",
      dir: tmpDir,
      reviewer: "codex",
    });

    const { readFileSync } = await import("node:fs");
    const capturedArgs = JSON.parse(readFileSync(argvOutPath, "utf-8"));
    expect(capturedArgs[0]).toBe("review");
    expect(capturedArgs[1]).toBe("review this");
  });

  it("passes only the prompt when reviewer is claude", async () => {
    const scriptPath = join(tmpDir, "argv-capture-cap.js");
    const argvOutPath = join(tmpDir, "argv-cap.json");
    writeFileSync(
      scriptPath,
      `#!/usr/bin/env node\nif (process.argv[2] === '--version') { console.log('1.0.0'); process.exit(0); }\nrequire('fs').writeFileSync(${JSON.stringify(argvOutPath)}, JSON.stringify(process.argv.slice(2)));\nprocess.exit(0);\n`,
      "utf-8",
    );
    chmodSync(scriptPath, 0o755);

    await runReviewerLlmCapturing({
      cliPath: scriptPath,
      prompt: "review this",
      dir: tmpDir,
      reviewer: "claude",
    });

    const { readFileSync } = await import("node:fs");
    const capturedArgs = JSON.parse(readFileSync(argvOutPath, "utf-8"));
    expect(capturedArgs).toEqual(["review this"]);
  });
});

// ---------------------------------------------------------------------------
// parseReviewerOutput
// ---------------------------------------------------------------------------

describe("parseReviewerOutput", () => {
  it("returns passed=true when output contains PASS with no FAIL", () => {
    const result = parseReviewerOutput("PASS\nEverything looks correct.");
    expect(result.passed).toBe(true);
  });

  it("returns passed=false when output contains FAIL", () => {
    const result = parseReviewerOutput("FAIL\n- broken import in src/foo.ts");
    expect(result.passed).toBe(false);
  });

  it("returns passed=false when output contains both PASS and FAIL", () => {
    // Reviewer wrote PASS in one place but FAIL in another — conservative: treat as fail
    const result = parseReviewerOutput("PASS in some files.\nFAIL — broken import found.");
    expect(result.passed).toBe(false);
  });

  it("extracts bullet errors", () => {
    const output = "FAIL\n- Broken import in src/foo.ts\n- Missing semicolon in bar.ts";
    const result = parseReviewerOutput(output);
    expect(result.errors).toContain("Broken import in src/foo.ts");
    expect(result.errors).toContain("Missing semicolon in bar.ts");
  });

  it("extracts numbered list errors", () => {
    const output = "FAIL\n1. Type error in auth.ts\n2. Undefined variable in login.ts";
    const result = parseReviewerOutput(output);
    expect(result.errors).toContain("Type error in auth.ts");
    expect(result.errors).toContain("Undefined variable in login.ts");
  });

  it("extracts suggested fixes after a Suggested fixes: header", () => {
    const output = [
      "FAIL",
      "- Missing return type",
      "Suggested fixes:",
      "- Add return type annotation",
      "- Use strict null checks",
    ].join("\n");
    const result = parseReviewerOutput(output);
    expect(result.suggestedFixes).toContain("Add return type annotation");
    expect(result.suggestedFixes).toContain("Use strict null checks");
  });

  it("extracts suggested fixes after a markdown heading", () => {
    const output = [
      "FAIL",
      "- Broken import",
      "### Suggested Fixes",
      "- Import from index.ts instead",
    ].join("\n");
    const result = parseReviewerOutput(output);
    expect(result.suggestedFixes).toContain("Import from index.ts instead");
  });

  it("returns testVerdict=passed when tests passed keywords present", () => {
    const result = parseReviewerOutput("PASS\nAll tests passed. Everything is fine.");
    expect(result.testVerdict).toBe("passed");
  });

  it("returns testVerdict=failed when tests failed keywords present", () => {
    const result = parseReviewerOutput("FAIL\nTests failed with 3 errors.");
    expect(result.testVerdict).toBe("failed");
  });

  it("returns testVerdict=skipped when no test keywords present", () => {
    const result = parseReviewerOutput("PASS\nCode looks good.");
    expect(result.testVerdict).toBe("skipped");
  });

  it("returns empty arrays for errors and fixes when PASS with no issues", () => {
    const result = parseReviewerOutput("PASS\nCode looks good. No issues found.");
    expect(result.errors).toEqual([]);
    expect(result.suggestedFixes).toEqual([]);
  });

  it("handles empty string gracefully", () => {
    const result = parseReviewerOutput("");
    expect(result.passed).toBe(false);
    expect(result.errors).toEqual([]);
    expect(result.suggestedFixes).toEqual([]);
    expect(result.testVerdict).toBe("skipped");
  });
});

// ---------------------------------------------------------------------------
// buildRemediationContext
// ---------------------------------------------------------------------------

describe("buildRemediationContext", () => {
  const feedback = {
    passed: false,
    errors: ["Broken import in src/foo.ts", "Missing semicolon"],
    suggestedFixes: ["Import from index.ts", "Add semicolon on line 42"],
    testVerdict: "failed",
  };

  it("includes the original task description", () => {
    const ctx = buildRemediationContext(feedback, "fix the auth module");
    expect(ctx).toContain("fix the auth module");
  });

  it("includes all errors as bullet points", () => {
    const ctx = buildRemediationContext(feedback, "task");
    expect(ctx).toContain("- Broken import in src/foo.ts");
    expect(ctx).toContain("- Missing semicolon");
  });

  it("includes suggested fixes as bullet points", () => {
    const ctx = buildRemediationContext(feedback, "task");
    expect(ctx).toContain("- Import from index.ts");
    expect(ctx).toContain("- Add semicolon on line 42");
  });

  it("instructs to fix only reviewer-identified issues", () => {
    const ctx = buildRemediationContext(feedback, "task");
    expect(ctx).toMatch(/fix only/i);
  });

  it("includes prior context when provided", () => {
    const ctx = buildRemediationContext(feedback, "task", "# Codebase\nSome context.");
    expect(ctx).toContain("# Codebase");
    expect(ctx).toContain("Some context.");
    expect(ctx).toContain("---");
  });

  it("omits prior context section when not provided", () => {
    const ctx = buildRemediationContext(feedback, "task");
    // Should not start with a separator
    expect(ctx.trimStart()).not.toMatch(/^---/);
  });

  it("omits errors section when no errors", () => {
    const noErrors = { passed: false, errors: [], suggestedFixes: ["Add types"], testVerdict: /** @type {"skipped"} */ ("skipped") };
    const ctx = buildRemediationContext(noErrors, "task");
    expect(ctx).not.toContain("Issues to fix:");
    expect(ctx).toContain("Add types");
  });

  it("omits suggested fixes section when none", () => {
    const noFixes = { passed: false, errors: ["Type error"], suggestedFixes: [], testVerdict: /** @type {"failed"} */ ("failed") };
    const ctx = buildRemediationContext(noFixes, "task");
    expect(ctx).not.toContain("Reviewer suggested fixes:");
    expect(ctx).toContain("Type error");
  });
});

// ---------------------------------------------------------------------------
// runCrossVendorReview — feedback included in llm-review result
// ---------------------------------------------------------------------------

describe("runCrossVendorReview — feedback in llm-review result", () => {
  it("includes feedback object in llm-review result", async () => {
    const scriptPath = join(tmpDir, "feedback-reviewer.js");
    writeFileSync(
      scriptPath,
      `#!/usr/bin/env node\nif (process.argv[2] === '--version') { console.log('1.0.0'); process.exit(0); }\nprocess.stdout.write('PASS\\nAll tests passed.\\n');\nprocess.exit(0);\n`,
      "utf-8",
    );
    chmodSync(scriptPath, 0o755);
    writeNdxConfig(tmpDir, { llm: { codex: { cli_path: scriptPath } } });

    const result = await runCrossVendorReview({
      dir: tmpDir,
      reviewer: "codex",
    });

    expect(result.mode).toBe("llm-review");
    expect(result.feedback).toBeDefined();
    expect(typeof result.feedback.passed).toBe("boolean");
    expect(Array.isArray(result.feedback.errors)).toBe(true);
    expect(Array.isArray(result.feedback.suggestedFixes)).toBe(true);
    expect(["passed", "failed", "skipped"]).toContain(result.feedback.testVerdict);
  });

  it("includes reviewOutput string in llm-review result", async () => {
    const scriptPath = join(tmpDir, "output-reviewer.js");
    writeFileSync(
      scriptPath,
      `#!/usr/bin/env node\nif (process.argv[2] === '--version') { console.log('1.0.0'); process.exit(0); }\nprocess.stdout.write('PASS\\n');\nprocess.exit(0);\n`,
      "utf-8",
    );
    chmodSync(scriptPath, 0o755);
    writeNdxConfig(tmpDir, { llm: { codex: { cli_path: scriptPath } } });

    const result = await runCrossVendorReview({ dir: tmpDir, reviewer: "codex" });

    expect(result.mode).toBe("llm-review");
    expect(typeof result.reviewOutput).toBe("string");
    expect(result.reviewOutput).toContain("PASS");
  });

  it("feedback.passed is true when reviewer outputs PASS and exits 0", async () => {
    const scriptPath = join(tmpDir, "pass-reviewer.js");
    writeFileSync(
      scriptPath,
      `#!/usr/bin/env node\nif (process.argv[2] === '--version') { console.log('1.0.0'); process.exit(0); }\nprocess.stdout.write('PASS\\n');\nprocess.exit(0);\n`,
      "utf-8",
    );
    chmodSync(scriptPath, 0o755);
    writeNdxConfig(tmpDir, { llm: { claude: { cli_path: scriptPath } } });

    const result = await runCrossVendorReview({ dir: tmpDir, reviewer: "claude" });
    expect(result.feedback.passed).toBe(true);
    expect(result.feedback.errors).toEqual([]);
  });

  it("feedback.passed is false when reviewer outputs FAIL", async () => {
    const scriptPath = join(tmpDir, "fail-reviewer.js");
    writeFileSync(
      scriptPath,
      `#!/usr/bin/env node\nif (process.argv[2] === '--version') { console.log('1.0.0'); process.exit(0); }\nprocess.stdout.write('FAIL\\n- broken import\\n');\nprocess.exit(1);\n`,
      "utf-8",
    );
    chmodSync(scriptPath, 0o755);
    writeNdxConfig(tmpDir, { llm: { claude: { cli_path: scriptPath } } });

    const result = await runCrossVendorReview({ dir: tmpDir, reviewer: "claude" });
    expect(result.feedback.passed).toBe(false);
    expect(result.feedback.errors).toContain("broken import");
  });
});
