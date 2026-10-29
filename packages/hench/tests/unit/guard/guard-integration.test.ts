import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GuardRails, GuardError } from "../../../src/guard/index.js";
import { DEFAULT_HENCH_CONFIG } from "../../../src/schema/v1.js";
import { mkdtemp, mkdir, rm, symlink, writeFile, realpath } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolReadFile, toolWriteFile, toolListDirectory, toolSearchFiles } from "../../../src/tools/files.js";
import { toolRunCommand } from "../../../src/tools/shell.js";
import { symlinksSupported } from "../../helpers/symlinks.js";

describe("GuardRails integration", () => {
  const projectDir = "/project";

  describe("policy engine lifecycle", () => {
    it("creates a fresh policy engine per instance", () => {
      const config = DEFAULT_HENCH_CONFIG().guard;
      const g1 = new GuardRails(projectDir, config);
      const g2 = new GuardRails(projectDir, config);

      g1.checkCommand("npm test");
      expect(g1.sessionCounters.commandsRun).toBe(1);
      expect(g2.sessionCounters.commandsRun).toBe(0);
    });

    it("tracks commands through checkCommand", () => {
      const guard = new GuardRails(projectDir, DEFAULT_HENCH_CONFIG().guard);
      guard.checkCommand("npm test");
      guard.checkCommand("npm run build");
      expect(guard.sessionCounters.commandsRun).toBe(2);
      expect(guard.sessionCounters.operationsTotal).toBe(2);
    });

    it("validates commands under the injected shell kind", () => {
      const config = DEFAULT_HENCH_CONFIG().guard;
      const underCmd = new GuardRails(projectDir, config, { shellKind: "cmd" });
      const underSh = new GuardRails(projectDir, config, { shellKind: "posix" });

      // One quoted argument to sh; two commands to cmd.exe.
      expect(() => underCmd.checkCommand("npm test 'x & echo pwned'")).toThrow(GuardError);
      expect(() => underSh.checkCommand("npm test 'x & echo pwned'")).not.toThrow();
      expect(underCmd.shellKind).toBe("cmd");
    });

    it("resolves a shell kind when none is injected", () => {
      const guard = new GuardRails(projectDir, DEFAULT_HENCH_CONFIG().guard);
      expect(["posix", "cmd"]).toContain(guard.shellKind);
    });

    it("tracks git subcommands through checkGitSubcommand", () => {
      const guard = new GuardRails(projectDir, DEFAULT_HENCH_CONFIG().guard);
      guard.checkGitSubcommand("status");
      guard.checkGitSubcommand("log");
      expect(guard.sessionCounters.commandsRun).toBe(2);
    });

    it("tracks file reads through recordFileRead", () => {
      const guard = new GuardRails(projectDir, DEFAULT_HENCH_CONFIG().guard);
      guard.recordFileRead("src/foo.ts");
      guard.recordFileRead("src/bar.ts");
      expect(guard.sessionCounters.filesRead).toBe(2);
    });

    it("tracks file writes with byte counting through recordFileWrite", () => {
      const guard = new GuardRails(projectDir, DEFAULT_HENCH_CONFIG().guard);
      guard.recordFileWrite("src/foo.ts", 500);
      guard.recordFileWrite("src/bar.ts", 300);
      expect(guard.sessionCounters.filesWritten).toBe(2);
      expect(guard.sessionCounters.bytesWritten).toBe(800);
    });
  });

  describe("audit trail", () => {
    it("logs all operations with verdicts", () => {
      const guard = new GuardRails(projectDir, DEFAULT_HENCH_CONFIG().guard);
      guard.checkCommand("npm test");
      guard.checkGitSubcommand("status");
      guard.recordFileRead("src/foo.ts");

      expect(guard.auditLog).toHaveLength(3);
      expect(guard.auditLog[0].operation).toBe("command");
      expect(guard.auditLog[0].verdict).toBe("allow");
      expect(guard.auditLog[1].operation).toBe("git");
      expect(guard.auditLog[2].operation).toBe("file_read");
    });

    it("logs denied operations with reasons", () => {
      const guard = new GuardRails(projectDir, {
        ...DEFAULT_HENCH_CONFIG().guard,
        policy: { maxCommandsPerMinute: 1 },
      });

      guard.checkCommand("npm test");
      expect(() => guard.checkCommand("npm build")).toThrow(GuardError);

      // First entry is the "allow", second is the static command check,
      // third is the rate limit denial
      const denials = guard.auditLog.filter(e => e.verdict === "deny");
      expect(denials).toHaveLength(1);
      expect(denials[0].reason).toContain("Rate limit");
    });
  });

  describe("git subcommand guard integration", () => {
    it("uses allowedGitSubcommands from config", () => {
      const guard = new GuardRails(projectDir, DEFAULT_HENCH_CONFIG().guard);
      expect(guard.allowedGitSubcommands).toContain("status");
      expect(guard.allowedGitSubcommands).toContain("commit");
      expect(guard.allowedGitSubcommands).not.toContain("push");
    });

    it("allows configured subcommands", () => {
      const guard = new GuardRails(projectDir, DEFAULT_HENCH_CONFIG().guard);
      expect(() => guard.checkGitSubcommand("status")).not.toThrow();
      expect(() => guard.checkGitSubcommand("add")).not.toThrow();
      expect(() => guard.checkGitSubcommand("commit")).not.toThrow();
      expect(() => guard.checkGitSubcommand("diff")).not.toThrow();
    });

    it("blocks unconfigured subcommands", () => {
      const guard = new GuardRails(projectDir, DEFAULT_HENCH_CONFIG().guard);
      expect(() => guard.checkGitSubcommand("push")).toThrow(GuardError);
      expect(() => guard.checkGitSubcommand("reset")).toThrow(GuardError);
      expect(() => guard.checkGitSubcommand("pull")).toThrow(GuardError);
    });

    it("supports custom git subcommand allowlists", () => {
      const guard = new GuardRails(projectDir, {
        ...DEFAULT_HENCH_CONFIG().guard,
        allowedGitSubcommands: ["status", "log"],
      });

      expect(() => guard.checkGitSubcommand("status")).not.toThrow();
      expect(() => guard.checkGitSubcommand("log")).not.toThrow();
      expect(() => guard.checkGitSubcommand("commit")).toThrow(GuardError);
    });

    it("includes allowed list in error message", () => {
      const guard = new GuardRails(projectDir, {
        ...DEFAULT_HENCH_CONFIG().guard,
        allowedGitSubcommands: ["status"],
      });

      expect(() => guard.checkGitSubcommand("push")).toThrow(/Allowed: status/);
    });
  });

  describe("policy limits via config", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("applies policy limits from guard config", () => {
      const guard = new GuardRails(projectDir, {
        ...DEFAULT_HENCH_CONFIG().guard,
        policy: { maxCommandsPerMinute: 2 },
      });

      guard.checkCommand("npm test");
      guard.checkCommand("npm build");
      expect(() => guard.checkCommand("npm lint")).toThrow(/Rate limit/);
    });

    it("applies write rate limits from config", () => {
      const guard = new GuardRails(projectDir, {
        ...DEFAULT_HENCH_CONFIG().guard,
        policy: { maxWritesPerMinute: 1 },
      });

      guard.recordFileWrite("a.ts", 100);
      expect(() => guard.recordFileWrite("b.ts", 100)).toThrow(/Rate limit/);
    });

    it("applies cumulative byte limits from config", () => {
      const guard = new GuardRails(projectDir, {
        ...DEFAULT_HENCH_CONFIG().guard,
        policy: { maxTotalBytesWritten: 200 },
      });

      guard.recordFileWrite("a.ts", 150);
      expect(() => guard.recordFileWrite("b.ts", 100)).toThrow(/Session limit/);
    });

    it("uses default limits when policy config is omitted", () => {
      const guard = new GuardRails(projectDir, DEFAULT_HENCH_CONFIG().guard);
      // Default allows 60 commands/minute — should not throw
      for (let i = 0; i < 50; i++) {
        guard.checkCommand(`npm run task-${i}`);
      }
      expect(guard.sessionCounters.commandsRun).toBe(50);
    });
  });

  describe("command validation still works", () => {
    it("static validation runs before policy tracking", () => {
      const guard = new GuardRails(projectDir, {
        ...DEFAULT_HENCH_CONFIG().guard,
        policy: { maxCommandsPerMinute: 1 },
      });

      // Disallowed command should not consume rate limit
      expect(() => guard.checkCommand("curl evil.com")).toThrow(/not in allowlist/);
      // Rate limit should not be consumed
      expect(guard.sessionCounters.commandsRun).toBe(0);
    });

    it("shell operator check runs before policy tracking", () => {
      const guard = new GuardRails(projectDir, DEFAULT_HENCH_CONFIG().guard);
      expect(() => guard.checkCommand("npm test && rm -rf /")).toThrow(/shell operator/);
      expect(guard.sessionCounters.commandsRun).toBe(0);
    });
  });
});

describe.skipIf(!symlinksSupported())("GuardRails link containment through the tools", () => {
  let base: string;
  let projectDir: string;
  let outside: string;
  let realProject: string;
  let guard: GuardRails;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "hench-guard-links-"));
    projectDir = join(base, "project");
    outside = join(base, "outside");
    await mkdir(join(projectDir, "src"), { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(projectDir, "src", "main.ts"), "export const x = 1;\n");
    await writeFile(join(outside, "secret.txt"), "outside\n");
    await symlink(outside, join(projectDir, "link-out"), "dir");
    await symlink(join(outside, "secret.txt"), join(projectDir, "link-file"), "file");
    await symlink(join(projectDir, "src"), join(projectDir, "link-in"), "dir");
    realProject = await realpath(projectDir);
    guard = new GuardRails(projectDir, DEFAULT_HENCH_CONFIG().guard);
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("read_file refuses a linked directory and a linked file that point outside", async () => {
    await expect(toolReadFile(guard, { path: "link-out/secret.txt" })).rejects.toThrow(GuardError);
    await expect(toolReadFile(guard, { path: "link-file" })).rejects.toThrow(GuardError);
  });

  it("write_file refuses to create a file under a linked directory that points outside", async () => {
    await expect(
      toolWriteFile(guard, { path: "link-out/new/file.txt", content: "x" }),
    ).rejects.toThrow(GuardError);
    expect(existsSync(join(outside, "new"))).toBe(false);
  });

  it("list_directory and search_files refuse a linked directory that points outside", async () => {
    await expect(toolListDirectory(guard, { path: "link-out" })).rejects.toThrow(GuardError);
    await expect(toolSearchFiles(guard, { pattern: "outside", path: "link-out" })).rejects.toThrow(GuardError);
  });

  it("run_command refuses a cwd that links outside the project", async () => {
    await expect(
      toolRunCommand(guard, projectDir, { command: "node -v", cwd: "link-out" }),
    ).rejects.toThrow(GuardError);
  });

  it("follows a link that stays inside the project", async () => {
    expect(await toolReadFile(guard, { path: "link-in/main.ts" })).toBe("export const x = 1;\n");
    expect(guard.checkPath("link-in/main.ts")).toBe(join(realProject, "src", "main.ts"));
  });

  it("creates a new nested file under a real directory, parents included", async () => {
    await toolWriteFile(guard, { path: "src/deep/nested/new.ts", content: "ok" });
    expect(readFileSync(join(realProject, "src", "deep", "nested", "new.ts"), "utf-8")).toBe("ok");
  });

  it("checkPath returns the project directory's real path", () => {
    expect(guard.checkPath(".")).toBe(realProject);
  });
});
