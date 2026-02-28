import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { toolGit } from "../../../src/tools/git.js";
import type { ToolGuard } from "../../../src/tools/contracts.js";

function createGitGuard(allowedGitSubcommands: string[]): ToolGuard {
  return {
    checkPath(filepath: string): string {
      return filepath;
    },
    checkCommand(): void {},
    checkGitSubcommand(subcommand: string): void {
      if (!allowedGitSubcommands.includes(subcommand)) {
        throw new Error(`Git subcommand "${subcommand}" not allowed. Allowed: ${allowedGitSubcommands.join(", ")}`);
      }
      this.__commandsRun += 1;
      this.__auditLog.push({ operation: "git" });
    },
    recordFileRead(): void {},
    recordFileWrite(): void {},
    maxFileSize: 1024 * 1024,
    commandTimeout: 30_000,
    __commandsRun: 0,
    __auditLog: [] as Array<{ operation: string }>,
  } as ToolGuard & { __commandsRun: number; __auditLog: Array<{ operation: string }> };
}

const DEFAULT_ALLOWED_GIT_SUBCOMMANDS = [
  "status", "add", "commit", "diff", "log",
  "branch", "checkout", "stash", "show", "rev-parse",
];

describe("toolGit", () => {
  let projectDir: string;
  let guard: ToolGuard & { __commandsRun: number; __auditLog: Array<{ operation: string }> };

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-test-git-"));
    guard = createGitGuard(DEFAULT_ALLOWED_GIT_SUBCOMMANDS);
    execSync("git init", { cwd: projectDir });
    execSync("git config user.email 'test@test.com'", { cwd: projectDir });
    execSync("git config user.name 'Test'", { cwd: projectDir });
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  describe("allowed subcommands", () => {
    it("runs git status", async () => {
      const result = await toolGit(guard, projectDir, { subcommand: "status" });
      expect(result).toContain("branch");
    });

    it("runs git rev-parse", async () => {
      const result = await toolGit(guard, projectDir, {
        subcommand: "rev-parse",
        args: "--git-dir",
      });
      expect(result).toContain(".git");
    });

    it("runs git branch", async () => {
      const result = await toolGit(guard, projectDir, { subcommand: "branch" });
      // Either shows branches or nothing if no commits yet
      expect(typeof result).toBe("string");
    });

    it("runs git log on repo with commits", async () => {
      await writeFile(join(projectDir, "test.txt"), "hello");
      execSync("git add test.txt", { cwd: projectDir });
      execSync("git commit -m 'test commit'", { cwd: projectDir });

      const result = await toolGit(guard, projectDir, { subcommand: "log" });
      expect(result).toContain("test commit");
    });

    it("runs git diff", async () => {
      await writeFile(join(projectDir, "test.txt"), "hello");
      execSync("git add test.txt", { cwd: projectDir });
      execSync("git commit -m 'initial'", { cwd: projectDir });
      await writeFile(join(projectDir, "test.txt"), "hello world");

      const result = await toolGit(guard, projectDir, { subcommand: "diff" });
      expect(result).toContain("hello world");
    });
  });

  describe("disallowed subcommands", () => {
    it("rejects push", async () => {
      await expect(
        toolGit(guard, projectDir, { subcommand: "push" }),
      ).rejects.toThrow("not allowed");
    });

    it("rejects reset", async () => {
      await expect(
        toolGit(guard, projectDir, { subcommand: "reset" }),
      ).rejects.toThrow("not allowed");
    });

    it("rejects pull", async () => {
      await expect(
        toolGit(guard, projectDir, { subcommand: "pull" }),
      ).rejects.toThrow("not allowed");
    });

    it("rejects fetch", async () => {
      await expect(
        toolGit(guard, projectDir, { subcommand: "fetch" }),
      ).rejects.toThrow("not allowed");
    });

    it("rejects clone", async () => {
      await expect(
        toolGit(guard, projectDir, { subcommand: "clone" }),
      ).rejects.toThrow("not allowed");
    });

    it("rejects clean", async () => {
      await expect(
        toolGit(guard, projectDir, { subcommand: "clean" }),
      ).rejects.toThrow("not allowed");
    });

    it("rejects rebase", async () => {
      await expect(
        toolGit(guard, projectDir, { subcommand: "rebase" }),
      ).rejects.toThrow("not allowed");
    });

    it("rejects merge", async () => {
      await expect(
        toolGit(guard, projectDir, { subcommand: "merge" }),
      ).rejects.toThrow("not allowed");
    });
  });

  describe("command injection prevention", () => {
    it("rejects subcommand with shell injection via semicolon", async () => {
      // Attempt to inject a command via subcommand field
      await expect(
        toolGit(guard, projectDir, { subcommand: "status; rm -rf /" }),
      ).rejects.toThrow("not allowed");
    });

    it("rejects subcommand with shell injection via &&", async () => {
      await expect(
        toolGit(guard, projectDir, { subcommand: "status && rm -rf /" }),
      ).rejects.toThrow("not allowed");
    });

    it("rejects subcommand with backtick injection", async () => {
      await expect(
        toolGit(guard, projectDir, { subcommand: "status`whoami`" }),
      ).rejects.toThrow("not allowed");
    });

    it("rejects subcommand with $() injection", async () => {
      await expect(
        toolGit(guard, projectDir, { subcommand: "status$(whoami)" }),
      ).rejects.toThrow("not allowed");
    });

    it("properly handles quoted args without injection", async () => {
      const result = await toolGit(guard, projectDir, {
        subcommand: "log",
        args: '--oneline -n 1 --format="%H"',
      });
      // Should return something (empty or hash) without error
      expect(typeof result).toBe("string");
    });

    it("handles args with special characters safely", async () => {
      await writeFile(join(projectDir, "test.txt"), "hello");
      execSync("git add test.txt", { cwd: projectDir });
      execSync("git commit -m 'test commit'", { cwd: projectDir });

      // Args with special chars should be handled safely
      const result = await toolGit(guard, projectDir, {
        subcommand: "log",
        args: "-1 --pretty=format:'%s'",
      });
      expect(typeof result).toBe("string");
    });
  });

  describe("guard integration", () => {
    it("uses guard allowlist instead of hardcoded list", async () => {
      // Create a guard with custom git subcommand allowlist
      const customGuard = createGitGuard(["status", "log"]);

      // status should work
      const result = await toolGit(customGuard, projectDir, { subcommand: "status" });
      expect(result).toContain("branch");

      // checkout should be blocked (not in custom list)
      await expect(
        toolGit(customGuard, projectDir, { subcommand: "checkout" }),
      ).rejects.toThrow("not allowed");
    });

    it("records git operations in policy audit log", async () => {
      await toolGit(guard, projectDir, { subcommand: "status" });
      expect(guard.__commandsRun).toBe(1);

      const entries = guard.__auditLog;
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries.some(e => e.operation === "git")).toBe(true);
    });
  });

  describe("error message clarity", () => {
    it("includes allowed subcommands in error message", async () => {
      await expect(
        toolGit(guard, projectDir, { subcommand: "forbidden" }),
      ).rejects.toThrow(/Allowed:/);
    });

    it("includes the attempted subcommand in error message", async () => {
      await expect(
        toolGit(guard, projectDir, { subcommand: "forbidden" }),
      ).rejects.toThrow(/forbidden/);
    });
  });

  describe("output handling", () => {
    it("returns (no output) for commands with empty output", async () => {
      // A diff with no changes returns empty output
      const result = await toolGit(guard, projectDir, { subcommand: "diff" });
      expect(result).toBe("(no output)");
    });

    it("captures stderr output", async () => {
      // Asking for a non-existent branch should produce stderr
      const result = await toolGit(guard, projectDir, {
        subcommand: "branch",
        args: "-d nonexistent",
      });
      expect(result).toContain("error");
    });
  });
});
