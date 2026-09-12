import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startHeartbeat, HEARTBEAT_INTERVAL_MS } from "../../../src/agent/lifecycle/heartbeat.js";
import type { RunRecord } from "../../../src/schema/v1.js";

// Mock saveRun
vi.mock("../../../src/store/runs.js", () => ({
  saveRun: vi.fn().mockResolvedValue(undefined),
}));

import { saveRun } from "../../../src/store/runs.js";
const mockSaveRun = vi.mocked(saveRun);

function makeRunRecord(overrides?: Partial<RunRecord>): RunRecord {
  return {
    id: "test-run-id",
    taskId: "test-task-id",
    taskTitle: "Test Task",
    startedAt: new Date().toISOString(),
    status: "running",
    turns: 0,
    tokenUsage: { input: 0, output: 0 },
    toolCalls: [],
    model: "sonnet",
    ...overrides,
  };
}

describe("heartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSaveRun.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exports HEARTBEAT_INTERVAL_MS as 30 seconds", () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(30_000);
  });

  it("updates lastActivityAt and saves run after interval", async () => {
    const run = makeRunRecord();
    const hb = startHeartbeat("/tmp/hench", run, 100);

    await vi.advanceTimersByTimeAsync(100);

    expect(run.lastActivityAt).toBeDefined();
    expect(mockSaveRun).toHaveBeenCalledTimes(1);
    expect(mockSaveRun).toHaveBeenCalledWith("/tmp/hench", run);

    hb.stop();
  });

  it("fires multiple times over multiple intervals", async () => {
    const run = makeRunRecord();
    const hb = startHeartbeat("/tmp/hench", run, 50);

    await vi.advanceTimersByTimeAsync(150);

    expect(mockSaveRun).toHaveBeenCalledTimes(3);

    hb.stop();
  });

  it("stops firing after stop() is called", async () => {
    const run = makeRunRecord();
    const hb = startHeartbeat("/tmp/hench", run, 50);

    await vi.advanceTimersByTimeAsync(50);
    expect(mockSaveRun).toHaveBeenCalledTimes(1);

    hb.stop();

    await vi.advanceTimersByTimeAsync(200);
    // Should not have fired again after stop
    expect(mockSaveRun).toHaveBeenCalledTimes(1);
  });

  it("stops automatically when run status is no longer running", async () => {
    const run = makeRunRecord();
    const hb = startHeartbeat("/tmp/hench", run, 50);

    await vi.advanceTimersByTimeAsync(50);
    expect(mockSaveRun).toHaveBeenCalledTimes(1);

    // Simulate run completion
    run.status = "completed";

    await vi.advanceTimersByTimeAsync(50);
    // Should not save since status !== "running"
    expect(mockSaveRun).toHaveBeenCalledTimes(1);

    hb.stop();
  });

  it("does not crash on saveRun failure", async () => {
    const run = makeRunRecord();
    mockSaveRun.mockRejectedValueOnce(new Error("disk error"));

    const hb = startHeartbeat("/tmp/hench", run, 50);

    await vi.advanceTimersByTimeAsync(50);

    // Should have tried and failed silently
    expect(mockSaveRun).toHaveBeenCalledTimes(1);

    // Next interval should still work
    mockSaveRun.mockResolvedValueOnce(undefined);
    await vi.advanceTimersByTimeAsync(50);
    expect(mockSaveRun).toHaveBeenCalledTimes(2);

    hb.stop();
  });

  it("persists counters the beforeSave hook writes (GH #362)", async () => {
    // The hook exists because the CLI loop's turns and tokens live in the
    // in-flight spawn: without it the heartbeat saves a fresh timestamp on a
    // record still reporting 0/0, and the dashboard reads a busy run as idle.
    const run = makeRunRecord();
    const hb = startHeartbeat("/tmp/hench", run, 50, () => {
      run.turns = 40;
      run.tokenUsage = { input: 1200, output: 300 };
    });

    await vi.advanceTimersByTimeAsync(50);

    expect(mockSaveRun).toHaveBeenCalledTimes(1);
    const saved = mockSaveRun.mock.calls[0][1];
    expect(saved.turns).toBe(40);
    expect(saved.tokenUsage).toEqual({ input: 1200, output: 300 });

    hb.stop();
  });

  it("still saves the beat when the beforeSave hook throws", async () => {
    const run = makeRunRecord();
    const hb = startHeartbeat("/tmp/hench", run, 50, () => {
      throw new Error("counter read failed");
    });

    await vi.advanceTimersByTimeAsync(50);

    // Stale counters are better than a missing heartbeat: a run whose
    // timestamp stops advancing is reaped as orphaned.
    expect(run.lastActivityAt).toBeDefined();
    expect(mockSaveRun).toHaveBeenCalledTimes(1);

    hb.stop();
  });

  it("sets lastActivityAt to a valid ISO timestamp", async () => {
    const run = makeRunRecord();
    const hb = startHeartbeat("/tmp/hench", run, 50);

    await vi.advanceTimersByTimeAsync(50);

    expect(run.lastActivityAt).toBeDefined();
    // The timestamp should be a valid ISO string
    expect(() => new Date(run.lastActivityAt!)).not.toThrow();
    expect(new Date(run.lastActivityAt!).toISOString()).toBe(run.lastActivityAt);

    hb.stop();
  });
});
