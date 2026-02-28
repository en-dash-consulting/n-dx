import { describe, it, expect, vi } from "vitest";
import { dispatchTool } from "../../../src/tools/dispatch.js";
import { SystemMemoryMonitor } from "../../../src/process/memory-monitor.js";
import type { ToolContext } from "../../../src/tools/contracts.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GB = 1024 * 1024 * 1024;

/** Create a minimal ToolContext with a memory monitor at the given usage. */
function makeCtx(
  usagePercent: number,
  opts?: { enabled?: boolean; spawnThreshold?: number },
): ToolContext {
  const total = 16 * GB;
  const free = total * (1 - usagePercent / 100);

  const monitor = new SystemMemoryMonitor(
    {
      enabled: opts?.enabled ?? true,
      spawnThreshold: opts?.spawnThreshold ?? 90,
    },
    {
      platform: "darwin",
      freemem: () => free,
      totalmem: () => total,
      readLinuxAvailable: async () => undefined,
      readDarwinAvailable: async () => undefined,
    },
  );

  return {
    guard: {
      checkPath: (p: string) => p,
      checkCommand: () => {},
      checkGitSubcommand: () => {},
      recordFileRead: () => {},
      recordFileWrite: () => {},
      maxFileSize: 1024 * 1024,
      commandTimeout: 30000,
    },
    projectDir: "/tmp/test-project",
    store: {} as ToolContext["store"],
    taskId: "test-task-id",
    memoryMonitor: monitor,
  };
}

// ---------------------------------------------------------------------------
// Pre-spawn memory check integration
// ---------------------------------------------------------------------------

describe("dispatchTool — memory check integration", () => {
  it("blocks run_command when memory exceeds spawn threshold", async () => {
    const ctx = makeCtx(95, { spawnThreshold: 90 });
    const result = await dispatchTool(
      ctx,
      "run_command",
      { command: "echo hello" },
    );

    expect(result).toContain("[MEMORY]");
    expect(result).toContain("exceeds spawn threshold");
  });

  it("blocks git when memory exceeds spawn threshold", async () => {
    const ctx = makeCtx(95, { spawnThreshold: 90 });
    const result = await dispatchTool(
      ctx,
      "git",
      { subcommand: "status" },
    );

    expect(result).toContain("[MEMORY]");
    expect(result).toContain("exceeds spawn threshold");
  });

  it("does not block non-process-spawning tools", async () => {
    const ctx = makeCtx(95, { spawnThreshold: 90 });

    // read_file should still proceed (returns error because path doesn't exist,
    // but NOT a [MEMORY] error)
    const result = await dispatchTool(
      ctx,
      "read_file",
      { path: "/nonexistent" },
    );

    expect(result).not.toContain("[MEMORY]");
  });

  it("allows run_command when memory is below threshold", async () => {
    const ctx = makeCtx(50, { spawnThreshold: 90 });

    // The command should proceed (may succeed or fail for other reasons,
    // but should NOT be memory-blocked)
    const result = await dispatchTool(
      ctx,
      "run_command",
      { command: "echo allowed" },
    );

    expect(result).not.toContain("[MEMORY]");
  });

  it("allows spawning when monitor is disabled", async () => {
    const ctx = makeCtx(99, { enabled: false, spawnThreshold: 50 });

    const result = await dispatchTool(
      ctx,
      "run_command",
      { command: "echo allowed" },
    );

    expect(result).not.toContain("[MEMORY]");
  });

  it("works when no memory monitor is configured", async () => {
    const ctx: ToolContext = {
      guard: {
        checkPath: (p: string) => p,
        checkCommand: () => {},
        checkGitSubcommand: () => {},
        recordFileRead: () => {},
        recordFileWrite: () => {},
        maxFileSize: 1024 * 1024,
        commandTimeout: 30000,
      },
      projectDir: "/tmp/test-project",
      store: {} as ToolContext["store"],
      taskId: "test-task-id",
      // No memoryMonitor
    };

    // Should proceed without memory check
    const result = await dispatchTool(
      ctx,
      "run_command",
      { command: "echo no-monitor" },
    );

    expect(result).not.toContain("[MEMORY]");
  });
});
