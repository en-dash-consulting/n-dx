import { describe, it, expect } from "vitest";

/**
 * Regression tests for --loop consecutive-failure auto-cancellation.
 *
 * These tests verify the 3-strike cancellation boundary:
 * - Loop exits after exactly 3 consecutive failures, not before
 * - A success mid-sequence resets the counter
 * - The cancellation message includes failure count and last task attempted
 * - Mocked run outcomes (no live LLM required)
 */

describe("consecutive failure counter in --loop mode", () => {
  describe("ConsecutiveFailureCounter class", () => {
    it("creates a counter initialized to 0", async () => {
      const { ConsecutiveFailureCounter } = await import(
        "../../../../src/cli/commands/consecutive-failures.js"
      );
      const counter = new ConsecutiveFailureCounter();
      expect(counter.count()).toBe(0);
    });

    it("increments counter on recordFailure", async () => {
      const { ConsecutiveFailureCounter } = await import(
        "../../../../src/cli/commands/consecutive-failures.js"
      );
      const counter = new ConsecutiveFailureCounter();
      counter.recordFailure("task-1");
      expect(counter.count()).toBe(1);
    });

    it("continues incrementing on repeated failures", async () => {
      const { ConsecutiveFailureCounter } = await import(
        "../../../../src/cli/commands/consecutive-failures.js"
      );
      const counter = new ConsecutiveFailureCounter();
      counter.recordFailure("task-1");
      counter.recordFailure("task-2");
      counter.recordFailure("task-3");
      expect(counter.count()).toBe(3);
    });

    it("detects when threshold (3) is reached", async () => {
      const { ConsecutiveFailureCounter } = await import(
        "../../../../src/cli/commands/consecutive-failures.js"
      );
      const counter = new ConsecutiveFailureCounter();
      expect(counter.shouldCancel()).toBe(false);

      counter.recordFailure("task-1");
      expect(counter.shouldCancel()).toBe(false);

      counter.recordFailure("task-2");
      expect(counter.shouldCancel()).toBe(false);

      counter.recordFailure("task-3");
      expect(counter.shouldCancel()).toBe(true);
    });

    it("does not cancel before exactly 3 failures", async () => {
      const { ConsecutiveFailureCounter } = await import(
        "../../../../src/cli/commands/consecutive-failures.js"
      );
      const counter = new ConsecutiveFailureCounter();

      counter.recordFailure("task-1");
      expect(counter.shouldCancel()).toBe(false);
      expect(counter.count()).toBe(1);

      counter.recordFailure("task-2");
      expect(counter.shouldCancel()).toBe(false);
      expect(counter.count()).toBe(2);
    });

    it("resets counter to 0 on recordSuccess", async () => {
      const { ConsecutiveFailureCounter } = await import(
        "../../../../src/cli/commands/consecutive-failures.js"
      );
      const counter = new ConsecutiveFailureCounter();
      counter.recordFailure("task-1");
      counter.recordFailure("task-2");
      expect(counter.count()).toBe(2);

      counter.recordSuccess();
      expect(counter.count()).toBe(0);
      expect(counter.shouldCancel()).toBe(false);
    });

    it("resets counter even from threshold", async () => {
      const { ConsecutiveFailureCounter } = await import(
        "../../../../src/cli/commands/consecutive-failures.js"
      );
      const counter = new ConsecutiveFailureCounter();
      counter.recordFailure("task-1");
      counter.recordFailure("task-2");
      counter.recordFailure("task-3");
      expect(counter.shouldCancel()).toBe(true);

      counter.recordSuccess();
      expect(counter.count()).toBe(0);
      expect(counter.shouldCancel()).toBe(false);
    });

    it("tracks last failed task ID", async () => {
      const { ConsecutiveFailureCounter } = await import(
        "../../../../src/cli/commands/consecutive-failures.js"
      );
      const counter = new ConsecutiveFailureCounter();
      counter.recordFailure("task-1");
      expect(counter.lastFailedTaskId()).toBe("task-1");

      counter.recordFailure("task-2");
      expect(counter.lastFailedTaskId()).toBe("task-2");

      counter.recordFailure("task-3");
      expect(counter.lastFailedTaskId()).toBe("task-3");
    });

    it("resets lastFailedTaskId on success", async () => {
      const { ConsecutiveFailureCounter } = await import(
        "../../../../src/cli/commands/consecutive-failures.js"
      );
      const counter = new ConsecutiveFailureCounter();
      counter.recordFailure("task-1");
      counter.recordFailure("task-2");
      expect(counter.lastFailedTaskId()).toBe("task-2");

      counter.recordSuccess();
      expect(counter.lastFailedTaskId()).toBeUndefined();
    });

    it("provides diagnostic message with failure count and task", async () => {
      const { ConsecutiveFailureCounter } = await import(
        "../../../../src/cli/commands/consecutive-failures.js"
      );
      const counter = new ConsecutiveFailureCounter();
      counter.recordFailure("task-abc");
      counter.recordFailure("task-def");
      counter.recordFailure("task-ghi");

      const message = counter.getCancellationMessage();
      expect(message).toContain("3");
      expect(message).toContain("task-ghi");
      expect(message).toContain("consecutive");
    });

    it("cancellation message is empty before threshold", async () => {
      const { ConsecutiveFailureCounter } = await import(
        "../../../../src/cli/commands/consecutive-failures.js"
      );
      const counter = new ConsecutiveFailureCounter();
      counter.recordFailure("task-1");
      counter.recordFailure("task-2");

      const message = counter.getCancellationMessage();
      expect(message).toBe("");
    });
  });

  describe("fail → pass → fail → pass → fail sequence", () => {
    it("does not trigger cancellation with pattern: fail, pass, fail, pass, fail", async () => {
      const { ConsecutiveFailureCounter } = await import(
        "../../../../src/cli/commands/consecutive-failures.js"
      );
      const counter = new ConsecutiveFailureCounter();

      // Fail-1
      counter.recordFailure("task-1");
      expect(counter.shouldCancel()).toBe(false);

      // Pass (reset)
      counter.recordSuccess();
      expect(counter.count()).toBe(0);

      // Fail-2
      counter.recordFailure("task-2");
      expect(counter.shouldCancel()).toBe(false);

      // Pass (reset)
      counter.recordSuccess();
      expect(counter.count()).toBe(0);

      // Fail-3
      counter.recordFailure("task-3");
      expect(counter.shouldCancel()).toBe(false);
      expect(counter.count()).toBe(1);
    });

    it("triggers cancellation with pattern: fail, fail, fail (no pass between)", async () => {
      const { ConsecutiveFailureCounter } = await import(
        "../../../../src/cli/commands/consecutive-failures.js"
      );
      const counter = new ConsecutiveFailureCounter();

      counter.recordFailure("task-1");
      expect(counter.shouldCancel()).toBe(false);

      counter.recordFailure("task-2");
      expect(counter.shouldCancel()).toBe(false);

      counter.recordFailure("task-3");
      expect(counter.shouldCancel()).toBe(true);
    });
  });

  describe("cancellation message format", () => {
    it("includes failure count in message", async () => {
      const { ConsecutiveFailureCounter } = await import(
        "../../../../src/cli/commands/consecutive-failures.js"
      );
      const counter = new ConsecutiveFailureCounter();
      counter.recordFailure("task-a");
      counter.recordFailure("task-b");
      counter.recordFailure("task-c");

      const message = counter.getCancellationMessage();
      expect(message).toMatch(/3/);
    });

    it("includes last task ID in message", async () => {
      const { ConsecutiveFailureCounter } = await import(
        "../../../../src/cli/commands/consecutive-failures.js"
      );
      const counter = new ConsecutiveFailureCounter();
      counter.recordFailure("my-task-id");
      counter.recordFailure("another-task");
      counter.recordFailure("final-task-xyz");

      const message = counter.getCancellationMessage();
      expect(message).toContain("final-task-xyz");
    });

    it("message indicates auto-cancellation reason", async () => {
      const { ConsecutiveFailureCounter } = await import(
        "../../../../src/cli/commands/consecutive-failures.js"
      );
      const counter = new ConsecutiveFailureCounter();
      counter.recordFailure("task-1");
      counter.recordFailure("task-2");
      counter.recordFailure("task-3");

      const message = counter.getCancellationMessage();
      expect(message).toMatch(/consecutive|auto.?cancel/i);
    });
  });

  describe("edge cases", () => {
    it("recordSuccess on fresh counter is safe (count stays 0)", async () => {
      const { ConsecutiveFailureCounter } = await import(
        "../../../../src/cli/commands/consecutive-failures.js"
      );
      const counter = new ConsecutiveFailureCounter();
      counter.recordSuccess();
      expect(counter.count()).toBe(0);
      expect(counter.shouldCancel()).toBe(false);
    });

    it("multiple successes in a row maintain count at 0", async () => {
      const { ConsecutiveFailureCounter } = await import(
        "../../../../src/cli/commands/consecutive-failures.js"
      );
      const counter = new ConsecutiveFailureCounter();
      counter.recordSuccess();
      counter.recordSuccess();
      counter.recordSuccess();
      expect(counter.count()).toBe(0);
    });

    it("handles undefined taskId gracefully on first failure", async () => {
      const { ConsecutiveFailureCounter } = await import(
        "../../../../src/cli/commands/consecutive-failures.js"
      );
      const counter = new ConsecutiveFailureCounter();
      counter.recordFailure("");
      expect(counter.count()).toBe(1);
      expect(counter.lastFailedTaskId()).toBe("");
    });

    it("handles task IDs with special characters", async () => {
      const { ConsecutiveFailureCounter } = await import(
        "../../../../src/cli/commands/consecutive-failures.js"
      );
      const counter = new ConsecutiveFailureCounter();
      const taskId = "task-@#$%^&*()";
      counter.recordFailure(taskId);
      counter.recordFailure("task-2");
      counter.recordFailure("task-3");

      const message = counter.getCancellationMessage();
      expect(message).toContain("task-3");
    });
  });

  describe("isFailureStatus predicate", () => {
    it("returns true for hard failure statuses", async () => {
      const { isFailureStatus } = await import(
        "../../../../src/cli/commands/consecutive-failures.js"
      );
      expect(isFailureStatus("failed")).toBe(true);
      expect(isFailureStatus("timeout")).toBe(true);
      expect(isFailureStatus("budget_exceeded")).toBe(true);
    });

    it("returns true for error_transient and cancelled (regression: bug 1358)", async () => {
      // Pre-fix bug: the call site used !shouldContinueLoop(status), which
      // returned false for error_transient/cancelled, so those statuses
      // SILENTLY RESET the counter via recordSuccess(). The 3-strike
      // threshold could never fire if every run errored transiently.
      const { isFailureStatus } = await import(
        "../../../../src/cli/commands/consecutive-failures.js"
      );
      expect(isFailureStatus("error_transient")).toBe(true);
      expect(isFailureStatus("cancelled")).toBe(true);
    });

    it("returns false for completed status", async () => {
      const { isFailureStatus } = await import(
        "../../../../src/cli/commands/consecutive-failures.js"
      );
      expect(isFailureStatus("completed")).toBe(false);
    });

    it("returns false for running and unknown statuses", async () => {
      const { isFailureStatus } = await import(
        "../../../../src/cli/commands/consecutive-failures.js"
      );
      expect(isFailureStatus("running")).toBe(false);
      expect(isFailureStatus("no_actionable_task")).toBe(false);
      expect(isFailureStatus("")).toBe(false);
    });

    it("agrees with shared.ts FAILURE_STATUSES set", async () => {
      // Hard guard: the rollback gate (shared.ts FAILURE_STATUSES) and the
      // counter gate (isFailureStatus) must agree. If they diverge, a run
      // can be rolled back but still reset the counter, or vice versa.
      const { isFailureStatus } = await import(
        "../../../../src/cli/commands/consecutive-failures.js"
      );
      const sharedFailureStatuses = [
        "failed",
        "timeout",
        "budget_exceeded",
        "error_transient",
        "cancelled",
      ];
      for (const status of sharedFailureStatuses) {
        expect(isFailureStatus(status)).toBe(true);
      }
    });
  });

  describe("loop iteration simulation", () => {
    it("simulates loop with 3 consecutive failures → exit", async () => {
      const { ConsecutiveFailureCounter } = await import(
        "../../../../src/cli/commands/consecutive-failures.js"
      );

      // Mock runOne outcomes for each iteration
      const outcomes = [
        { taskId: "task-1", status: "failed" },
        { taskId: "task-2", status: "failed" },
        { taskId: "task-3", status: "failed" },
      ];

      const counter = new ConsecutiveFailureCounter();
      const loopIterations: number[] = [];

      for (let i = 0; i < outcomes.length; i++) {
        loopIterations.push(i + 1);
        const outcome = outcomes[i];

        // Record failure
        counter.recordFailure(outcome.taskId);

        // Check cancellation after each iteration
        if (counter.shouldCancel()) {
          const message = counter.getCancellationMessage();
          expect(message).toBeTruthy();
          expect(message).toContain("3");
          expect(message).toContain("task-3");
          break;
        }
      }

      // Should complete exactly 3 iterations before canceling
      expect(loopIterations).toEqual([1, 2, 3]);
    });

    it("simulates loop with failure, success, failure → continues", async () => {
      const { ConsecutiveFailureCounter } = await import(
        "../../../../src/cli/commands/consecutive-failures.js"
      );

      const outcomes = [
        { taskId: "task-1", status: "failed" },
        { taskId: "task-2", status: "completed" },
        { taskId: "task-3", status: "failed" },
      ];

      const counter = new ConsecutiveFailureCounter();
      let canceledAt = -1;

      for (let i = 0; i < 10; i++) {
        // Cycle through outcomes for simulation
        const outcome = outcomes[i % outcomes.length];

        if (outcome.status === "failed") {
          counter.recordFailure(outcome.taskId);
        } else {
          counter.recordSuccess();
        }

        if (counter.shouldCancel()) {
          canceledAt = i;
          break;
        }
      }

      // Should NOT cancel (pattern is fail, pass, fail, pass, fail... which never reaches 3 consecutive)
      expect(canceledAt).toBe(-1);
      expect(counter.shouldCancel()).toBe(false);
    });

    /**
     * Fixture-driven regression for the call-site classification bug.
     *
     * `runLoop` decides whether to call `recordFailure` or `recordSuccess`
     * based on the run's status. The bug was that the call site used
     * `!shouldContinueLoop(status)` — a loop-continuation predicate — which
     * incorrectly treated `error_transient` and `cancelled` as successes,
     * silently resetting the counter and preventing the 3-strike trigger
     * from ever firing.
     *
     * This test reproduces the runLoop body's classification step using
     * `isFailureStatus` (the fixed predicate) and a fixture that yields
     * the failing status on every iteration. It must:
     *   • record exactly 3 failures
     *   • cancel after the 3rd iteration
     *   • emit a message that names the failing task and the count
     */
    function runFixtureLoop(
      counter: { recordFailure: (id: string) => void; recordSuccess: () => void; shouldCancel: () => boolean; getCancellationMessage: () => string },
      isFailure: (status: string) => boolean,
      fixture: () => { status: string; taskId: string },
      maxIterations: number = 10,
    ): { iterations: number; cancelMessage: string } {
      let iterations = 0;
      let cancelMessage = "";
      while (iterations < maxIterations) {
        iterations++;
        const outcome = fixture();
        if (isFailure(outcome.status)) {
          counter.recordFailure(outcome.taskId);
        } else {
          counter.recordSuccess();
        }
        if (counter.shouldCancel()) {
          cancelMessage = counter.getCancellationMessage();
          break;
        }
      }
      return { iterations, cancelMessage };
    }

    it("always-failing fixture exits after exactly 3 agent invocations with auto-cancel message", async () => {
      const { ConsecutiveFailureCounter, isFailureStatus } = await import(
        "../../../../src/cli/commands/consecutive-failures.js"
      );
      const counter = new ConsecutiveFailureCounter();
      let i = 0;
      const result = runFixtureLoop(
        counter,
        isFailureStatus,
        () => ({ status: "failed", taskId: `always-fail-${++i}` }),
      );
      expect(result.iterations).toBe(3);
      expect(result.cancelMessage).toContain("3");
      expect(result.cancelMessage).toContain("always-fail-3");
      expect(result.cancelMessage).toMatch(/auto-cancel|consecutive/i);
    });

    it("always-error_transient fixture also exits after 3 agent invocations (bug-1358 regression)", async () => {
      // Pre-fix: this fixture looped forever because error_transient was
      // classified as a success by the call site.
      const { ConsecutiveFailureCounter, isFailureStatus } = await import(
        "../../../../src/cli/commands/consecutive-failures.js"
      );
      const counter = new ConsecutiveFailureCounter();
      let i = 0;
      const result = runFixtureLoop(
        counter,
        isFailureStatus,
        () => ({ status: "error_transient", taskId: `transient-${++i}` }),
      );
      expect(result.iterations).toBe(3);
      expect(result.cancelMessage).toContain("transient-3");
    });

    it("2 failures + 1 success + 2 failures does NOT cancel at iteration 4", async () => {
      const { ConsecutiveFailureCounter, isFailureStatus } = await import(
        "../../../../src/cli/commands/consecutive-failures.js"
      );
      const counter = new ConsecutiveFailureCounter();
      const sequence = [
        { status: "failed", taskId: "task-1" },
        { status: "failed", taskId: "task-2" },
        { status: "completed", taskId: "task-3" }, // resets counter
        { status: "failed", taskId: "task-4" },
        { status: "failed", taskId: "task-5" },
      ];
      let cursor = 0;
      const result = runFixtureLoop(
        counter,
        isFailureStatus,
        () => sequence[cursor++],
        sequence.length,
      );
      // Loop should run all 5 iterations without cancelling
      expect(result.iterations).toBe(5);
      expect(result.cancelMessage).toBe("");
      expect(counter.count()).toBe(2);
      expect(counter.shouldCancel()).toBe(false);
    });

    it("2 failures + 1 success + 3 failures DOES cancel at iteration 6", async () => {
      const { ConsecutiveFailureCounter, isFailureStatus } = await import(
        "../../../../src/cli/commands/consecutive-failures.js"
      );
      const counter = new ConsecutiveFailureCounter();
      const sequence = [
        { status: "failed", taskId: "task-1" },
        { status: "failed", taskId: "task-2" },
        { status: "completed", taskId: "task-3" }, // resets counter
        { status: "failed", taskId: "task-4" },
        { status: "failed", taskId: "task-5" },
        { status: "failed", taskId: "task-6" },
      ];
      let cursor = 0;
      const result = runFixtureLoop(
        counter,
        isFailureStatus,
        () => sequence[cursor++],
        sequence.length,
      );
      expect(result.iterations).toBe(6);
      expect(result.cancelMessage).toContain("task-6");
      expect(result.cancelMessage).toContain("3");
    });

    it("simulates loop that passes several, then fails 3 times → exit", async () => {
      const { ConsecutiveFailureCounter } = await import(
        "../../../../src/cli/commands/consecutive-failures.js"
      );

      const counter = new ConsecutiveFailureCounter();
      let canceledAt = -1;

      // Pass 2 tasks
      counter.recordSuccess();
      counter.recordSuccess();
      expect(counter.count()).toBe(0);

      // Fail 3 times
      counter.recordFailure("task-bad-1");
      counter.recordFailure("task-bad-2");
      counter.recordFailure("task-bad-3");

      if (counter.shouldCancel()) {
        canceledAt = 5; // Iteration 5 (2 passes + 3 fails)
      }

      expect(canceledAt).toBe(5);
      const message = counter.getCancellationMessage();
      expect(message).toContain("task-bad-3");
    });
  });
});
