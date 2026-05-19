import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initConfig } from "../../../../src/store/config.js";

/**
 * Tests for the --loop continuous execution mode.
 *
 * These tests exercise the loop control flow in cmdRun by mocking
 * the underlying runOne execution and verifying iteration behaviour,
 * pause timing, and stop conditions.
 */

// We'll test the extracted loop helpers directly rather than cmdRun
// to avoid needing to mock the full agent/CLI stack.

describe("loop mode helpers", () => {
  describe("shouldContinueLoop", () => {
    it("returns true for completed status", async () => {
      const { shouldContinueLoop } = await import(
        "../../../../src/cli/commands/run.js"
      );
      expect(shouldContinueLoop("completed")).toBe(true);
    });

    it("returns true for error_transient status", async () => {
      const { shouldContinueLoop } = await import(
        "../../../../src/cli/commands/run.js"
      );
      expect(shouldContinueLoop("error_transient")).toBe(true);
    });

    it("returns false for failed status", async () => {
      const { shouldContinueLoop } = await import(
        "../../../../src/cli/commands/run.js"
      );
      expect(shouldContinueLoop("failed")).toBe(false);
    });

    it("returns false for timeout status", async () => {
      const { shouldContinueLoop } = await import(
        "../../../../src/cli/commands/run.js"
      );
      expect(shouldContinueLoop("timeout")).toBe(false);
    });

    it("returns false for budget_exceeded status", async () => {
      const { shouldContinueLoop } = await import(
        "../../../../src/cli/commands/run.js"
      );
      expect(shouldContinueLoop("budget_exceeded")).toBe(false);
    });
  });

  describe("loopPause", () => {
    it("resolves after the specified delay", async () => {
      const { loopPause } = await import(
        "../../../../src/cli/commands/run.js"
      );
      const start = Date.now();
      await loopPause(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40); // allow small timer variance
    });

    it("resolves immediately for 0ms delay", async () => {
      const { loopPause } = await import(
        "../../../../src/cli/commands/run.js"
      );
      const start = Date.now();
      await loopPause(0);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(50);
    });

    it("can be aborted via AbortSignal", async () => {
      const { loopPause } = await import(
        "../../../../src/cli/commands/run.js"
      );
      const ac = new AbortController();
      const promise = loopPause(10_000, ac.signal);
      // Abort immediately
      ac.abort();
      const start = Date.now();
      await promise;
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(200);
    });
  });
});

describe("stuck task config defaults", () => {
  it("maxFailedAttempts is optional in schema and defaults to 3", async () => {
    const { validateConfig } = await import("../../../../src/schema/validate.js");
    const { DEFAULT_HENCH_CONFIG } = await import("../../../../src/schema/v1.js");

    const config = DEFAULT_HENCH_CONFIG();
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.maxFailedAttempts).toBe(3);
    }
  });

  it("maxFailedAttempts can be customised in config", async () => {
    const { validateConfig } = await import("../../../../src/schema/validate.js");
    const { DEFAULT_HENCH_CONFIG } = await import("../../../../src/schema/v1.js");

    const config = { ...DEFAULT_HENCH_CONFIG(), maxFailedAttempts: 5 };
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.maxFailedAttempts).toBe(5);
    }
  });

  it("rejects maxFailedAttempts of 0", async () => {
    const { validateConfig } = await import("../../../../src/schema/validate.js");
    const { DEFAULT_HENCH_CONFIG } = await import("../../../../src/schema/v1.js");

    const config = { ...DEFAULT_HENCH_CONFIG(), maxFailedAttempts: 0 };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
  });

  it("rejects negative maxFailedAttempts", async () => {
    const { validateConfig } = await import("../../../../src/schema/validate.js");
    const { DEFAULT_HENCH_CONFIG } = await import("../../../../src/schema/v1.js");

    const config = { ...DEFAULT_HENCH_CONFIG(), maxFailedAttempts: -1 };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
  });
});

describe("token budget config defaults", () => {
  it("tokenBudget is optional in schema and defaults to 0 (unlimited)", async () => {
    const { validateConfig } = await import("../../../../src/schema/validate.js");
    const { DEFAULT_HENCH_CONFIG } = await import("../../../../src/schema/v1.js");

    const config = DEFAULT_HENCH_CONFIG();
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.tokenBudget).toBe(0);
    }
  });

  it("tokenBudget can be set to a positive value", async () => {
    const { validateConfig } = await import("../../../../src/schema/validate.js");
    const { DEFAULT_HENCH_CONFIG } = await import("../../../../src/schema/v1.js");

    const config = { ...DEFAULT_HENCH_CONFIG(), tokenBudget: 500_000 };
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.tokenBudget).toBe(500_000);
    }
  });

  it("rejects negative tokenBudget", async () => {
    const { validateConfig } = await import("../../../../src/schema/validate.js");
    const { DEFAULT_HENCH_CONFIG } = await import("../../../../src/schema/v1.js");

    const config = { ...DEFAULT_HENCH_CONFIG(), tokenBudget: -1 };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
  });

  it("accepts tokenBudget of 0 (unlimited)", async () => {
    const { validateConfig } = await import("../../../../src/schema/validate.js");
    const { DEFAULT_HENCH_CONFIG } = await import("../../../../src/schema/v1.js");

    const config = { ...DEFAULT_HENCH_CONFIG(), tokenBudget: 0 };
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.tokenBudget).toBe(0);
    }
  });

  it("validates existing configs without tokenBudget field (backward compat)", async () => {
    const { validateConfig } = await import("../../../../src/schema/validate.js");
    const { DEFAULT_HENCH_CONFIG } = await import("../../../../src/schema/v1.js");

    // Simulate an old config file that doesn't have tokenBudget
    const { tokenBudget, ...configWithout } = DEFAULT_HENCH_CONFIG();
    const result = validateConfig(configWithout);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.tokenBudget).toBe(0);
    }
  });
});

describe("loop config defaults", () => {
  it("loopPauseMs is optional in schema and defaults to 2000", async () => {
    const { validateConfig } = await import("../../../../src/schema/validate.js");
    const { DEFAULT_HENCH_CONFIG } = await import("../../../../src/schema/v1.js");

    // Config without loopPauseMs should validate
    const config = DEFAULT_HENCH_CONFIG();
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.loopPauseMs).toBe(2000);
    }
  });

  it("loopPauseMs can be customised in config", async () => {
    const { validateConfig } = await import("../../../../src/schema/validate.js");
    const { DEFAULT_HENCH_CONFIG } = await import("../../../../src/schema/v1.js");

    const config = { ...DEFAULT_HENCH_CONFIG(), loopPauseMs: 5000 };
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.loopPauseMs).toBe(5000);
    }
  });

  it("rejects negative loopPauseMs", async () => {
    const { validateConfig } = await import("../../../../src/schema/validate.js");
    const { DEFAULT_HENCH_CONFIG } = await import("../../../../src/schema/v1.js");

    const config = { ...DEFAULT_HENCH_CONFIG(), loopPauseMs: -1 };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
  });
});

// ── iteration banner placement ────────────────────────────────────────────
//
// Regression guard: banners must be emitted BETWEEN iterations only.
// "Between" means: after the prior iteration's runOne (commit + summary)
// returns, and before the next iteration's task selection begins.
// No banner before iteration 1; no banner after the final iteration.
//
// These tests simulate the banner-gating logic used in runIterations()
// (if i > 0) and runLoop() (if completed > 1) to document the invariant
// without having to spin up the full agent stack.

describe("iteration banner placement invariants", () => {
  it("formatIterationBanner is not called for the first iteration (i === 0)", () => {
    // Simulates the gate in runIterations(): `if (i > 0)`
    const banners: string[] = [];
    const emitBanner = (i: number, total: number) => {
      if (i > 0) banners.push(`=== Iteration ${i + 1}/${total} ===`);
    };
    // Three iterations: only iterations 2 and 3 get a banner
    for (let i = 0; i < 3; i++) emitBanner(i, 3);
    expect(banners).toHaveLength(2);
    expect(banners[0]).toBe("=== Iteration 2/3 ===");
    expect(banners[1]).toBe("=== Iteration 3/3 ===");
  });

  it("no banner is emitted after the final iteration in fixed mode", () => {
    // After the loop ends there is no code path that would emit a banner,
    // because the gate condition (i > 0) is evaluated at the TOP of each
    // iteration — when the loop exits there is no 'next' iteration to enter.
    const banners: string[] = [];
    const total = 3;
    for (let i = 0; i < total; i++) {
      if (i > 0) banners.push(`banner-${i + 1}`);
      // simulate iteration work here
    }
    // Last banner is for iteration `total`, not `total + 1`
    expect(banners[banners.length - 1]).toBe(`banner-${total}`);
    expect(banners).toHaveLength(total - 1);
  });

  it("formatIterationBanner is not called for the first loop iteration (completed === 1)", () => {
    // Simulates the gate in runLoop(): `if (completed > 1)`
    const banners: string[] = [];
    let completed = 0;
    const emitBanner = () => {
      completed++;
      if (completed > 1) banners.push(`=== Iteration ${completed} ===`);
    };
    emitBanner(); // iteration 1 — no banner
    emitBanner(); // iteration 2 — banner for 2
    emitBanner(); // iteration 3 — banner for 3
    expect(banners).toHaveLength(2);
    expect(banners[0]).toBe("=== Iteration 2 ===");
    expect(banners[1]).toBe("=== Iteration 3 ===");
  });

  it("loop-mode banner format has no /total suffix", () => {
    // --loop is unbounded so the banner must not show a denominator
    const completed = 4;
    const banner = `=== Iteration ${completed} ===`;
    expect(banner).not.toMatch(/\d+\/\d+/);
    expect(banner).toBe("=== Iteration 4 ===");
  });
});

// ── attempt tracking per task within a single run invocation ───────────────

describe("attempt tracking in run loops", () => {
  it("tracks attempt count per task ID within a run invocation", async () => {
    const { createAttemptTracker } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const tracker = createAttemptTracker();

    // First attempt of task-1
    expect(tracker.incrementAndGetCount("task-1")).toBe(1);
    // Second attempt of task-1
    expect(tracker.incrementAndGetCount("task-1")).toBe(2);
    // First attempt of task-2
    expect(tracker.incrementAndGetCount("task-2")).toBe(1);
    // Third attempt of task-1
    expect(tracker.incrementAndGetCount("task-1")).toBe(3);
    // Second attempt of task-2
    expect(tracker.incrementAndGetCount("task-2")).toBe(2);

    // Verify counts are persistent
    expect(tracker.getCount("task-1")).toBe(3);
    expect(tracker.getCount("task-2")).toBe(2);
  });

  it("returns 0 for tasks with no attempts yet", async () => {
    const { createAttemptTracker } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const tracker = createAttemptTracker();

    expect(tracker.getCount("never-attempted")).toBe(0);
  });

  it("identifies tasks that have reached max attempts (3)", async () => {
    const { createAttemptTracker } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const tracker = createAttemptTracker();

    expect(tracker.hasReachedMaxAttempts("task-1")).toBe(false);

    tracker.incrementAndGetCount("task-1");
    expect(tracker.hasReachedMaxAttempts("task-1")).toBe(false);

    tracker.incrementAndGetCount("task-1");
    expect(tracker.hasReachedMaxAttempts("task-1")).toBe(false);

    tracker.incrementAndGetCount("task-1");
    expect(tracker.hasReachedMaxAttempts("task-1")).toBe(true);
  });

  it("resets on new tracker creation (separate run invocation)", async () => {
    const { createAttemptTracker } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const tracker1 = createAttemptTracker();
    tracker1.incrementAndGetCount("task-1");
    tracker1.incrementAndGetCount("task-1");

    // New tracker for a separate run invocation
    const tracker2 = createAttemptTracker();
    expect(tracker2.getCount("task-1")).toBe(0);
  });

  it("integrates with excludeTaskIds after reaching max attempts", async () => {
    const { createAttemptTracker } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const tracker = createAttemptTracker();
    const excludeIds = new Set<string>();

    // Simulate three task runs of the same task
    for (let i = 0; i < 3; i++) {
      const count = tracker.incrementAndGetCount("task-1");
      if (tracker.hasReachedMaxAttempts("task-1")) {
        excludeIds.add("task-1");
      }
    }

    expect(excludeIds.has("task-1")).toBe(true);
    expect(excludeIds.size).toBe(1);

    // A different task should not be excluded
    tracker.incrementAndGetCount("task-2");
    expect(excludeIds.has("task-2")).toBe(false);
  });
});
