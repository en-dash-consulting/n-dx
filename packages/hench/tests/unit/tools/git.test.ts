import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { toolGit } from "../../../src/tools/git.js";

describe("toolGit", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-test-git-"));
    execSync("git init", { cwd: projectDir });
    execSync("git config user.email 'test@test.com'", { cwd: projectDir });
    execSync("git config user.name 'Test'", { cwd: projectDir });
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  describe("allowed subcommands", () => {
    it("runs git status", async () => {
      const result = await toolGit(projectDir, { subcommand: "status" });
      expect(result).toContain("branch");
    });

    it("runs git rev-parse", async () => {
      const result = await toolGit(projectDir, {
        subcommand: "rev-parse",
        args: "--git-dir",
      });
      expect(result).toContain(".git");
    });

    it("runs git branch", async () => {
      const result = await toolGit(projectDir, { subcommand: "branch" });
      // Either shows branches or nothing if no commits yet
      expect(typeof result).toBe("string");
    });

    it("runs git log on repo with commits", async () => {
      await writeFile(join(projectDir, "test.txt"), "hello");
      execSync("git add test.txt", { cwd: projectDir });
      execSync("git commit -m 'test commit'", { cwd: projectDir });

      const result = await toolGit(projectDir, { subcommand: "log" });
      expect(result).toContain("test commit");
    });

    it("runs git diff", async () => {
      await writeFile(join(projectDir, "test.txt"), "hello");
      execSync("git add test.txt", { cwd: projectDir });
      execSync("git commit -m 'initial'", { cwd: projectDir });
      await writeFile(join(projectDir, "test.txt"), "hello world");

      const result = await toolGit(projectDir, { subcommand: "diff" });
      expect(result).toContain("hello world");
    });
  });

  describe("disallowed subcommands", () => {
    it("rejects push", async () => {
      await expect(
        toolGit(projectDir, { subcommand: "push" }),
      ).rejects.toThrow("not allowed");
    });

    it("rejects reset", async () => {
      await expect(
        toolGit(projectDir, { subcommand: "reset" }),
      ).rejects.toThrow("not allowed");
    });

    it("rejects pull", async () => {
      await expect(
        toolGit(projectDir, { subcommand: "pull" }),
      ).rejects.toThrow("not allowed");
    });

    it("rejects fetch", async () => {
      await expect(
        toolGit(projectDir, { subcommand: "fetch" }),
      ).rejects.toThrow("not allowed");
    });

    it("rejects clone", async () => {
      await expect(
        toolGit(projectDir, { subcommand: "clone" }),
      ).rejects.toThrow("not allowed");
    });

    it("rejects clean", async () => {
      await expect(
        toolGit(projectDir, { subcommand: "clean" }),
      ).rejects.toThrow("not allowed");
    });

    it("rejects rebase", async () => {
      await expect(
        toolGit(projectDir, { subcommand: "rebase" }),
      ).rejects.toThrow("not allowed");
    });

    it("rejects merge", async () => {
      await expect(
        toolGit(projectDir, { subcommand: "merge" }),
      ).rejects.toThrow("not allowed");
    });
  });

  describe("command injection prevention", () => {
    it("rejects subcommand with shell injection via semicolon", async () => {
      // Attempt to inject a command via subcommand field
      await expect(
        toolGit(projectDir, { subcommand: "status; rm -rf /" }),
      ).rejects.toThrow("not allowed");
    });

    it("rejects subcommand with shell injection via &&", async () => {
      await expect(
        toolGit(projectDir, { subcommand: "status && rm -rf /" }),
      ).rejects.toThrow("not allowed");
    });

    it("rejects subcommand with backtick injection", async () => {
      await expect(
        toolGit(projectDir, { subcommand: "status`whoami`" }),
      ).rejects.toThrow("not allowed");
    });

    it("rejects subcommand with $() injection", async () => {
      await expect(
        toolGit(projectDir, { subcommand: "status$(whoami)" }),
      ).rejects.toThrow("not allowed");
    });

    it("properly handles quoted args without injection", async () => {
      const result = await toolGit(projectDir, {
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
      const result = await toolGit(projectDir, {
        subcommand: "log",
        args: "-1 --pretty=format:'%s'",
      });
      expect(typeof result).toBe("string");
    });
  });

  describe("error message clarity", () => {
    it("includes allowed subcommands in error message", async () => {
      await expect(
        toolGit(projectDir, { subcommand: "forbidden" }),
      ).rejects.toThrow(/Allowed:/);
    });

    it("includes the attempted subcommand in error message", async () => {
      await expect(
        toolGit(projectDir, { subcommand: "forbidden" }),
      ).rejects.toThrow(/forbidden/);
    });
  });

  describe("output handling", () => {
    it("returns (no output) for commands with empty output", async () => {
      // A diff with no changes returns empty output
      const result = await toolGit(projectDir, { subcommand: "diff" });
      expect(result).toBe("(no output)");
    });

    it("captures stderr output", async () => {
      // Asking for a non-existent branch should produce stderr
      const result = await toolGit(projectDir, {
        subcommand: "branch",
        args: "-d nonexistent",
      });
      expect(result).toContain("error");
    });
  });
});
