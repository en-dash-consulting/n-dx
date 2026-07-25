import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for runReviewGate's rollback gating (issue #303).
 *
 * When a reviewer rejects the agent's changes, the gate must honor
 * `rollbackOnFailure` / `--no-rollback`: previously it reverted
 * unconditionally, ignoring the flag. These tests lock the behavior:
 *   - rollbackOnFailure: false  → NO revert (changes left in place)
 *   - rollbackOnFailure default → revert runs (when the tree is dirty)
 */

// Mock the review analysis module so promptReview rejects and revertChanges
// is an observable spy (never touches real git).
vi.mock("../../../src/agent/analysis/review.js", () => ({
  collectReviewDiff: vi.fn(async () => ({ diff: "some diff", stat: "1 file changed" })),
  promptReview: vi.fn(async () => ({ approved: false, reason: "rejected by test" })),
  revertChanges: vi.fn(async () => ({ removedUntracked: [], keptUntracked: [] })),
  listUntrackedPaths: vi.fn(async () => []),
}));

// Mock the rex tools so status/log writes are no-ops (no real store needed).
vi.mock("../../../src/tools/rex.js", () => ({
  toolRexUpdateStatus: vi.fn(async () => "ok"),
  toolRexAppendLog: vi.fn(async () => undefined),
}));

// Mock the process/exec layer so listDirtyPaths (used by the rollback path)
// reports a dirty tree without shelling out to git.
vi.mock("../../../src/process/exec.js", () => ({
  execStdout: vi.fn(async (_cmd: string, args: string[]) =>
    args?.includes("--porcelain") ? "?? scratch.ts\n" : "",
  ),
  getCurrentHead: vi.fn(() => "abc123"),
  execShellCmd: vi.fn(async () => ({ stdout: "", stderr: "", code: 0 })),
}));

// Suppress console-style output.
vi.mock("../../../src/types/output.js", () => ({
  section: vi.fn(),
  subsection: vi.fn(),
  stream: vi.fn(),
  detail: vi.fn(),
  info: vi.fn(),
  getCapturedLines: vi.fn(() => []),
  resetCapturedLines: vi.fn(),
}));

function buildRun() {
  return {
    id: "run-1",
    taskId: "task-1",
    taskTitle: "Test task",
    startedAt: new Date().toISOString(),
    status: "completed",
    turns: 1,
    tokenUsage: { input: 1, output: 1 },
    turnTokenUsage: [],
    toolCalls: [],
    model: "test-model",
  } as unknown as import("../../../src/schema/index.js").RunRecord;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runReviewGate — rollback gating (#303)", () => {
  it("does NOT revert on rejection when rollbackOnFailure is false (--no-rollback)", async () => {
    const { runReviewGate } = await import("../../../src/agent/lifecycle/shared.js");
    const { revertChanges } = await import("../../../src/agent/analysis/review.js");

    const run = buildRun();
    const result = await runReviewGate("/project", {} as never, "task-1", run, {
      rollbackOnFailure: false,
    });

    expect(result.rejected).toBe(true);
    expect(run.status).toBe("failed");
    // The core assertion: --no-rollback leaves the rejected changes in place.
    expect(revertChanges).not.toHaveBeenCalled();
  });

  it("reverts on rejection when rollbackOnFailure is not suppressed (dirty tree)", async () => {
    const { runReviewGate } = await import("../../../src/agent/lifecycle/shared.js");
    const { revertChanges } = await import("../../../src/agent/analysis/review.js");

    const run = buildRun();
    const result = await runReviewGate("/project", {} as never, "task-1", run, {
      // rollbackOnFailure omitted → defaults to reverting
      baselineUntracked: [],
    });

    expect(result.rejected).toBe(true);
    expect(run.status).toBe("failed");
    // The rollback path ran and scoped the revert with the provided baseline.
    expect(revertChanges).toHaveBeenCalledTimes(1);
    expect(revertChanges).toHaveBeenCalledWith(
      "/project",
      expect.objectContaining({ baselineUntracked: [] }),
    );
  });
});
