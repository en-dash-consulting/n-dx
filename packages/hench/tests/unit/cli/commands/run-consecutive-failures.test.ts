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
