import { describe, it, expect } from "vitest";
import { maxFailedAttemptsOf, stuckTaskIdsFromRuns } from "../../../src/server/stuck-tasks.js";

const run = (taskId: string, status: string, extra: Record<string, unknown> = {}) => ({ taskId, status, ...extra });

describe("stuckTaskIdsFromRuns", () => {
  it("flags a task with threshold consecutive hard failures, newest first", () => {
    const runs = [run("t", "failed"), run("t", "timeout"), run("t", "budget_exceeded")];
    expect([...stuckTaskIdsFromRuns(runs, 3)]).toEqual(["t"]);
    expect(stuckTaskIdsFromRuns(runs, 4).size).toBe(0);
  });

  it("stops counting at the first non-failure", () => {
    expect(stuckTaskIdsFromRuns([run("t", "failed"), run("t", "completed"), run("t", "failed"), run("t", "failed")], 3).size).toBe(0);
  });

  it("does not let one task's success end another's streak", () => {
    const runs = [run("a", "failed"), run("b", "completed"), run("a", "failed")];
    expect([...stuckTaskIdsFromRuns(runs, 2)]).toEqual(["a"]);
  });

  it("skips review-gate refusals without ending or extending a streak", () => {
    const gated = run("t", "failed", { review: { failed: "no reviewer", gated: true } });
    expect(stuckTaskIdsFromRuns([gated, gated, gated], 1).size).toBe(0);
    expect([...stuckTaskIdsFromRuns([run("t", "failed"), gated, run("t", "failed")], 2)]).toEqual(["t"]);
  });

  it("is disabled by a threshold of 0", () => {
    expect(stuckTaskIdsFromRuns([run("t", "failed")], 0).size).toBe(0);
  });
});

describe("maxFailedAttemptsOf", () => {
  it("reads a positive integer and otherwise answers hench's default of 3", () => {
    expect(maxFailedAttemptsOf({ maxFailedAttempts: 5 })).toBe(5);
    expect(maxFailedAttemptsOf(null)).toBe(3);
    expect(maxFailedAttemptsOf({ maxFailedAttempts: 0 })).toBe(3);
    expect(maxFailedAttemptsOf({ maxFailedAttempts: "2" })).toBe(3);
  });
});
