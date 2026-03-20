import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RunRecord } from "../../../../src/schema/index.js";
import { saveRun } from "../../../../src/store/runs.js";
import { initConfig } from "../../../../src/store/config.js";

describe("show command with deleted tasks", () => {
  let projectDir: string;
  let henchDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  const makeRun = (overrides?: Partial<RunRecord>): RunRecord => ({
    id: "run-001",
    taskId: "deleted-task-id",
    taskTitle: "A task that was deleted",
    startedAt: "2025-01-01T00:00:00.000Z",
    finishedAt: "2025-01-01T00:01:00.000Z",
    status: "completed",
    turns: 5,
    tokenUsage: { input: 1000, output: 500 },
    toolCalls: [],
    model: "sonnet",
    ...overrides,
  });

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-test-show-"));
    henchDir = join(projectDir, ".n-dx/hench");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("displays run with deleted task using stored title", async () => {
    const run = makeRun();
    await saveRun(henchDir, run);

    const { cmdShow } = await import("../../../../src/cli/commands/show.js");
    await cmdShow(projectDir, "run-001", {});

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    // Should still show the task title from stored metadata
    expect(allOutput).toContain("A task that was deleted");
    expect(allOutput).toContain("deleted-task-id");
  });

  it("does not crash when task ID references a non-existent task", async () => {
    const run = makeRun({ taskId: "nonexistent-id-12345" });
    await saveRun(henchDir, run);

    const { cmdShow } = await import("../../../../src/cli/commands/show.js");
    // Should not throw
    await expect(cmdShow(projectDir, "run-001", {})).resolves.not.toThrow();
  });

  it("shows run in JSON format with deleted task", async () => {
    const run = makeRun();
    await saveRun(henchDir, run);

    const { cmdShow } = await import("../../../../src/cli/commands/show.js");
    await cmdShow(projectDir, "run-001", { format: "json" });

    const jsonOutput = logSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(jsonOutput);
    expect(parsed.taskId).toBe("deleted-task-id");
    expect(parsed.taskTitle).toBe("A task that was deleted");
  });
});

describe("status command with deleted tasks", () => {
  let projectDir: string;
  let henchDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-test-status-"));
    henchDir = join(projectDir, ".n-dx/hench");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("lists runs with deleted tasks without crashing", async () => {
    const run: RunRecord = {
      id: "run-002",
      taskId: "gone-task",
      taskTitle: "Previously existing task",
      startedAt: "2025-01-01T00:00:00.000Z",
      finishedAt: "2025-01-01T00:01:00.000Z",
      status: "completed",
      turns: 3,
      tokenUsage: { input: 500, output: 200 },
      toolCalls: [],
      model: "sonnet",
    };
    await saveRun(henchDir, run);

    const { cmdStatus } = await import("../../../../src/cli/commands/status.js");
    await expect(cmdStatus(projectDir, {})).resolves.not.toThrow();

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("Previously existing task");
  });

  it("historical run records remain accessible", async () => {
    // Save multiple runs with various task states
    const runs: RunRecord[] = [
      {
        id: "run-old",
        taskId: "deleted-task",
        taskTitle: "Old deleted task",
        startedAt: "2025-01-01T00:00:00.000Z",
        finishedAt: "2025-01-01T00:01:00.000Z",
        status: "completed",
        turns: 3,
        tokenUsage: { input: 500, output: 200 },
        toolCalls: [],
        model: "sonnet",
      },
      {
        id: "run-new",
        taskId: "active-task",
        taskTitle: "Active task",
        startedAt: "2025-01-02T00:00:00.000Z",
        finishedAt: "2025-01-02T00:01:00.000Z",
        status: "completed",
        turns: 5,
        tokenUsage: { input: 1000, output: 400 },
        toolCalls: [],
        model: "sonnet",
      },
    ];

    for (const run of runs) {
      await saveRun(henchDir, run);
    }

    const { cmdStatus } = await import("../../../../src/cli/commands/status.js");
    await cmdStatus(projectDir, {});

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("Old deleted task");
    expect(allOutput).toContain("Active task");
  });
});
