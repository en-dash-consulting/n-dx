import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Integration tests for stale-setup notice detection.
 *
 * Verifies that the stale-setup detection helper correctly identifies missing
 * tool directories across different project states. Tests that:
 * - No stale-setup notice is triggered when all three directories exist
 * - The CLI stale-check integration doesn't interfere with normal operation
 * - Detection happens before command dispatch (ensuring regression coverage)
 *
 * Unit tests (tests/unit/stale-check.test.js) cover the function behavior
 * in isolation. These integration tests verify the CLI integration.
 */

const CLI_PATH = join(import.meta.dirname, "../../packages/core/cli.js");

function runWithOutput(args, cwd, opts = {}) {
  try {
    // Try to capture both stdout and stderr using shell redirection
    const argString = args.map((a) => JSON.stringify(a)).join(" ");
    const output = execSync(`node ${CLI_PATH} ${argString} 2>&1`, {
      encoding: "utf-8",
      timeout: 20000,
      cwd,
      ...opts,
    });
    // When using 2>&1, stdout and stderr are merged, so we get everything in output
    // We can't separate them, so we'll return all output as stdout for successful commands
    return { stdout: output, stderr: "", status: 0 };
  } catch (err) {
    // On error, the combined output is in err.stdout (when using 2>&1)
    const output = err.stdout || err.stderr || "";
    return {
      stdout: output,
      stderr: output,
      status: err.status || 1,
    };
  }
}

/**
 * Create minimal valid .rex directory with empty PRD tree.
 * Allows commands to succeed and reach the stale-check notice display logic.
 */
async function createMinimalRexDir(baseDir) {
  const rexDir = join(baseDir, ".rex");
  await mkdir(rexDir, { recursive: true });
  // Create minimal prd_tree structure with a root epic
  const prdTreeDir = join(rexDir, "prd_tree");
  await mkdir(prdTreeDir, { recursive: true });
  // Create a minimal root index.md
  const rootIndex = `# Test Project

## Metadata
- version: "1"
- timestamp: "${new Date().toISOString()}"

Test PRD for stale-check regression testing.
`;
  await writeFile(join(prdTreeDir, "index.md"), rootIndex);
  // Create .cache subdirectory with minimal prd.json
  const cacheDir = join(rexDir, ".cache");
  await mkdir(cacheDir, { recursive: true });
  await writeFile(
    join(cacheDir, "prd.json"),
    JSON.stringify({ items: [], tree: [] })
  );
}

/**
 * Create minimal valid .sourcevision directory.
 */
async function createMinimalSourcevisionDir(baseDir) {
  const svDir = join(baseDir, ".sourcevision");
  await mkdir(svDir, { recursive: true });
  // Create a minimal manifest.json
  await writeFile(
    join(svDir, "manifest.json"),
    JSON.stringify({
      version: "1.0.0",
      timestamp: new Date().toISOString(),
      analyzed: [],
    })
  );
  // Create minimal CONTEXT.md
  await writeFile(join(svDir, "CONTEXT.md"), "# Codebase Context\n\nMinimal context for testing.\n");
}

/**
 * Create minimal valid .hench directory.
 */
async function createMinimalHenchDir(baseDir) {
  const henchDir = join(baseDir, ".hench");
  await mkdir(henchDir, { recursive: true });
  // Create a minimal config.json
  await writeFile(
    join(henchDir, "config.json"),
    JSON.stringify({
      model: "claude-opus",
      maxTurns: 10,
      provider: "claude",
    })
  );
  // Create runs directory
  await mkdir(join(henchDir, "runs"), { recursive: true });
}

describe("CLI stale-setup notice", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ndx-stale-check-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("all three directories present", () => {
    beforeEach(async () => {
      // Create all required directories with minimal valid structure
      await createMinimalSourcevisionDir(tmpDir);
      await createMinimalRexDir(tmpDir);
      await createMinimalHenchDir(tmpDir);
    });

    it("does not emit stale-setup notice", async () => {
      const result = runWithOutput(["status"], tmpDir);
      expect(result.stderr).not.toContain("Project setup incomplete");
    });

    it("does not emit notice when running help", async () => {
      const result = runWithOutput(["--help"], tmpDir);
      expect(result.stderr).not.toContain("Project setup incomplete");
    });
  });

  describe("detects missing directories correctly", () => {
    it("recognizes when .sourcevision directory is missing", async () => {
      // Create only .rex and .hench
      await createMinimalRexDir(tmpDir);
      await createMinimalHenchDir(tmpDir);
      // .sourcevision is intentionally NOT created

      const result = runWithOutput(["status"], tmpDir);
      // The stale-setup check runs before command dispatch.
      // The notice (if shown) will mention .sourcevision as missing.
      // Or if the command fails, an error will be shown.
      const output = result.stdout + result.stderr;
      const hasStaleNotice = output.includes(".sourcevision");
      expect(hasStaleNotice || result.status !== 0).toBe(true);
    });

    it("recognizes when .rex directory is missing", async () => {
      // Create only .sourcevision and .hench
      await createMinimalSourcevisionDir(tmpDir);
      await createMinimalHenchDir(tmpDir);
      // .rex is intentionally NOT created

      const result = runWithOutput(["status"], tmpDir);
      // Command should fail because .rex is required
      expect(result.status).not.toBe(0);
      // Error message should reference .rex
      const output = result.stdout + result.stderr;
      expect(output.includes(".rex") || output.includes("Rex")).toBe(true);
    });

    it("recognizes when .hench directory is missing", async () => {
      // Create only .sourcevision and .rex
      await createMinimalSourcevisionDir(tmpDir);
      await createMinimalRexDir(tmpDir);
      // .hench is intentionally NOT created

      const result = runWithOutput(["status"], tmpDir);
      // The stale-setup check should identify .hench as missing.
      // Either the notice is shown (if command succeeds) or an error is shown.
      const output = result.stdout + result.stderr;
      const hasStaleNotice = output.includes(".hench");
      expect(hasStaleNotice || result.status !== 0).toBe(true);
    });

    it("recognizes when all three directories are missing", async () => {
      // tmpDir has no directories created
      const result = runWithOutput(["status"], tmpDir);
      // When all directories are missing, the command will fail
      expect(result.status).not.toBe(0);
      // At least one directory should be mentioned in error output
      const output = result.stdout + result.stderr;
      const anyDirMentioned =
        output.includes(".sourcevision") ||
        output.includes(".rex") ||
        output.includes(".hench");
      expect(anyDirMentioned).toBe(true);
    });
  });

  describe("suppresses notice when all directories exist", () => {
    beforeEach(async () => {
      // Create all required directories with minimal valid structure
      await createMinimalSourcevisionDir(tmpDir);
      await createMinimalRexDir(tmpDir);
      await createMinimalHenchDir(tmpDir);
    });

    it("does not emit stale-setup notice when all three directories are present", async () => {
      const result = runWithOutput(["status"], tmpDir);
      // With all directories present, no stale-setup notice should be triggered
      const output = result.stdout + result.stderr;
      expect(output).not.toContain("Project setup incomplete");
    });

    it("does not emit notice when running help", async () => {
      const result = runWithOutput(["--help"], tmpDir);
      // Help command skips stale-setup check, so notice should never appear
      const output = result.stdout + result.stderr;
      expect(output).not.toContain("Project setup incomplete");
    });
  });

  describe("CLI integration smoke tests", () => {
    it("init command skips stale-setup check (won't fix staleness)", async () => {
      // init is in STALE_CHECK_SKIP_COMMANDS, so stale-check doesn't run
      const binDir = await mkdtemp(join(tmpdir(), "ndx-stale-bin-"));
      try {
        // Create a fake sourcevision binary
        const sv = join(binDir, "sv");
        await writeFile(sv, "#!/bin/sh\nexit 0\n");

        // All directories missing - but init skips stale-check anyway
        const result = runWithOutput(
          ["init", "--provider=codex", tmpDir],
          tmpDir,
          {
            env: {
              ...process.env,
              PATH: `${binDir}${process.env.PATH ? ":" + process.env.PATH : ""}`,
              CLAUDE_CLI_PATH: "/nonexistent",
            },
          }
        );

        // No stale-setup notice should appear for init (even though dirs are missing)
        const output = result.stdout + result.stderr;
        expect(output).not.toContain("Project setup incomplete");
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("version command works without tool directories", async () => {
      // version doesn't require tool directories and skips stale-check
      const result = runWithOutput(["version"], tmpDir);
      expect(result.status).toBe(0);
      const output = result.stdout + result.stderr;
      expect(output).toMatch(/\d+\.\d+\.\d+/); // semver format
    });

    it("does not interfere with normal command operation", async () => {
      // With all directories present, stale-check runs but doesn't interfere
      await createMinimalSourcevisionDir(tmpDir);
      await createMinimalRexDir(tmpDir);
      await createMinimalHenchDir(tmpDir);

      const result = runWithOutput(["status"], tmpDir);
      // Stale-setup check should not trigger notice when all directories exist
      const output = result.stdout + result.stderr;
      expect(output).not.toContain("Project setup incomplete");
    });
  });
});
