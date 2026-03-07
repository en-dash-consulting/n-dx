import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ensureHenchDir,
  loadConfig,
  saveConfig,
  configExists,
  initConfig,
} from "../../src/store/config.js";
import { saveRun, loadRun, listRuns } from "../../src/store/runs.js";
import { DEFAULT_HENCH_CONFIG } from "../../src/schema/v1.js";
import type { RunRecord } from "../../src/schema/v1.js";

describe("config store roundtrip", () => {
  let henchDir: string;

  beforeEach(async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "hench-test-store-"));
    henchDir = join(tmpDir, ".hench");
  });

  afterEach(async () => {
    await rm(henchDir, { recursive: true, force: true });
  });

  it("creates directory structure", async () => {
    await ensureHenchDir(henchDir);
    // Should not throw
  });

  it("initializes config", async () => {
    expect(await configExists(henchDir)).toBe(false);
    const config = await initConfig(henchDir);
    expect(await configExists(henchDir)).toBe(true);
    expect(config.schema).toBe("hench/v1");
  });

  it("round-trips config", async () => {
    await ensureHenchDir(henchDir);
    const config = DEFAULT_HENCH_CONFIG();
    config.model = "claude-opus-4-20250514";
    config.maxTurns = 100;

    await saveConfig(henchDir, config);
    const loaded = await loadConfig(henchDir);

    expect(loaded.model).toBe("claude-opus-4-20250514");
    expect(loaded.maxTurns).toBe(100);
    expect(loaded.guard.blockedPaths).toEqual(config.guard.blockedPaths);
  });
});

describe("runs store roundtrip", () => {
  let henchDir: string;

  beforeEach(async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "hench-test-runs-"));
    henchDir = join(tmpDir, ".hench");
    await ensureHenchDir(henchDir);
  });

  afterEach(async () => {
    await rm(henchDir, { recursive: true, force: true });
  });

  function makeRun(overrides: Partial<RunRecord> & { id: string }): RunRecord {
    return {
      taskId: "task-1",
      taskTitle: "Test task",
      startedAt: "2025-01-01T00:00:00Z",
      status: "completed",
      turns: 1,
      tokenUsage: { input: 100, output: 50 },
      toolCalls: [],
      model: "claude-sonnet-4-6",
      ...overrides,
    };
  }

  it("round-trips a run record", async () => {
    const run = makeRun({ id: "run-1" });
    await saveRun(henchDir, run);
    const loaded = await loadRun(henchDir, "run-1");
    expect(loaded.id).toBe("run-1");
    expect(loaded.taskTitle).toBe("Test task");
  });

  it("lists runs sorted by date", async () => {
    await saveRun(henchDir, makeRun({ id: "run-a", startedAt: "2025-01-01T00:00:00Z" }));
    await saveRun(henchDir, makeRun({ id: "run-b", startedAt: "2025-01-02T00:00:00Z" }));
    await saveRun(henchDir, makeRun({ id: "run-c", startedAt: "2025-01-03T00:00:00Z" }));

    const runs = await listRuns(henchDir);
    expect(runs.length).toBe(3);
    expect(runs[0].id).toBe("run-c");
    expect(runs[2].id).toBe("run-a");
  });

  it("limits run list", async () => {
    await saveRun(henchDir, makeRun({ id: "run-a", startedAt: "2025-01-01T00:00:00Z" }));
    await saveRun(henchDir, makeRun({ id: "run-b", startedAt: "2025-01-02T00:00:00Z" }));

    const runs = await listRuns(henchDir, 1);
    expect(runs.length).toBe(1);
  });

  it("returns empty array when no runs", async () => {
    const runs = await listRuns(henchDir);
    expect(runs).toEqual([]);
  });

  it("saves run with tool calls", async () => {
    const run = makeRun({
      id: "run-tools",
      toolCalls: [
        { turn: 1, tool: "read_file", input: { path: "test.ts" }, output: "content", durationMs: 5 },
      ],
    });
    await saveRun(henchDir, run);
    const loaded = await loadRun(henchDir, "run-tools");
    expect(loaded.toolCalls.length).toBe(1);
    expect(loaded.toolCalls[0].tool).toBe("read_file");
  });
});
