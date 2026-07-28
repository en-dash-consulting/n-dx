import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for runReviewGate's rollback gating (issue #303).
 *
 * When a reviewer rejects the agent's changes, the gate must honor
 * `rollbackOnFailure` / `--no-rollback`, and the revert itself is
 * prompt-only (never unattended). These tests lock the behavior:
 *   - rollbackOnFailure: false      → NO revert (changes left in place)
 *   - non-interactive (no TTY)      → NO revert, no prompt
 *   - autonomous mode (even on TTY) → NO revert, no prompt
 *   - interactive TTY + declined    → NO revert
 *   - interactive TTY + confirmed   → revert runs, scoped by the pre-run
 *     untracked baseline so pre-existing files are preserved
 */

// Fake readline so the confirmation prompt can be driven deterministically.
// `questions` doubles as the assertion that a prompt did (or did not) open.
const readlineFake = vi.hoisted(() => ({
  questions: [] as string[],
  answers: [] as string[],
}));
vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (q: string, cb: (answer: string) => void) => {
      readlineFake.questions.push(q);
      cb(readlineFake.answers.shift() ?? "");
    },
    close: () => {},
    on: () => {},
    removeListener: () => {},
  }),
}));

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

const originalIsTTY = process.stdin.isTTY;

function setStdinTTY(value: boolean | undefined): void {
  Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  readlineFake.questions.length = 0;
  readlineFake.answers.length = 0;
});

afterEach(() => {
  setStdinTTY(originalIsTTY);
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
    expect(readlineFake.questions).toHaveLength(0);
  });

  it("does NOT revert when non-interactive (no TTY) — reports and leaves changes", async () => {
    setStdinTTY(undefined);
    const { runReviewGate } = await import("../../../src/agent/lifecycle/shared.js");
    const { revertChanges } = await import("../../../src/agent/analysis/review.js");

    const run = buildRun();
    const result = await runReviewGate("/project", {} as never, "task-1", run, {
      baselineUntracked: [],
    });

    expect(result.rejected).toBe(true);
    expect(run.status).toBe("failed");
    // Without a prompt channel there is no confirmation, so nothing reverts.
    expect(revertChanges).not.toHaveBeenCalled();
    expect(readlineFake.questions).toHaveLength(0);
  });

  it("does NOT revert in autonomous mode, even on a TTY (no prompt)", async () => {
    setStdinTTY(true);
    const { runReviewGate } = await import("../../../src/agent/lifecycle/shared.js");
    const { revertChanges } = await import("../../../src/agent/analysis/review.js");

    const run = buildRun();
    const result = await runReviewGate("/project", {} as never, "task-1", run, {
      autonomous: true,
      baselineUntracked: [],
    });

    expect(result.rejected).toBe(true);
    expect(revertChanges).not.toHaveBeenCalled();
    expect(readlineFake.questions).toHaveLength(0);
  });

  it("does NOT revert when the interactive prompt is declined", async () => {
    setStdinTTY(true);
    readlineFake.answers.push("n");
    const { runReviewGate } = await import("../../../src/agent/lifecycle/shared.js");
    const { revertChanges } = await import("../../../src/agent/analysis/review.js");

    const run = buildRun();
    const result = await runReviewGate("/project", {} as never, "task-1", run, {
      baselineUntracked: [],
    });

    expect(result.rejected).toBe(true);
    expect(readlineFake.questions).toHaveLength(1);
    expect(revertChanges).not.toHaveBeenCalled();
  });

  it("reverts on express confirmation, scoped by the pre-run untracked baseline", async () => {
    setStdinTTY(true);
    readlineFake.answers.push("y");
    const { runReviewGate } = await import("../../../src/agent/lifecycle/shared.js");
    const { revertChanges } = await import("../../../src/agent/analysis/review.js");

    const run = buildRun();
    const result = await runReviewGate("/project", {} as never, "task-1", run, {
      baselineUntracked: ["pre-existing.txt"],
    });

    expect(result.rejected).toBe(true);
    expect(run.status).toBe("failed");
    expect(readlineFake.questions).toHaveLength(1);
    // The rollback path ran and scoped the revert with the provided baseline,
    // so pre-existing untracked work survives even a confirmed revert.
    expect(revertChanges).toHaveBeenCalledTimes(1);
    expect(revertChanges).toHaveBeenCalledWith(
      "/project",
      expect.objectContaining({ baselineUntracked: ["pre-existing.txt"] }),
    );
  });
});
