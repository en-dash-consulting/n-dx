/**
 * REQUIRED TEST — do not skip or delete.
 *
 * Scheduler startup integration test.
 *
 * Verifies that the usage cleanup scheduler can be wired up and fires
 * at the expected interval. This makes the lifecycle dependency between
 * web-dashboard (server startup) and the cleanup scheduler detectable
 * by the test suite rather than requiring code reading to discover.
 *
 * Tests use real module imports from built dist/ artifacts to exercise
 * the actual compiled code path.
 *
 * This is the single point of failure for server scheduler wiring
 * coverage. Without it, regressions in the scheduler boot path would
 * require a full manual server startup to detect.
 *
 * @see packages/web/src/server/register-scheduler.ts
 * @see packages/web/src/server/usage-cleanup-scheduler.ts
 * @see TESTING.md "Required Tests" section
 * @see tests/e2e/cli-dev.test.js — analogous required test for dev-mode
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Import scheduler and cleanup functions from built web package
const {
  startUsageCleanupScheduler,
  runCleanupCycle,
  identifyOrphanedEntries,
  loadCleanupConfig,
  DEFAULT_CLEANUP_INTERVAL_MS,
} = await import(
  "../../packages/web/dist/server/usage-cleanup-scheduler.js"
);

const { registerUsageScheduler } = await import(
  "../../packages/web/dist/server/register-scheduler.js"
);

// Import collectAllIds from rex to verify the cross-package data flow
const { collectAllIds } = await import(
  "../../packages/rex/dist/core/tree.js"
);

/**
 * Simple PRD loader that reads prd.json from the .rex directory.
 * Injected into runCleanupCycle alongside collectAllIds to satisfy
 * the loadPRD requirement added when the two-callback contract was introduced.
 */
function loadPRDSync(rexDir) {
  const prdPath = join(rexDir, "prd.json");
  if (!existsSync(prdPath)) return null;
  try {
    return JSON.parse(readFileSync(prdPath, "utf-8"));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temporary project directory with .rex/ and optional prd.json. */
function makeTmpProject(prdItems = undefined) {
  const tmpDir = mkdtempSync(join(tmpdir(), "scheduler-test-"));
  const rexDir = join(tmpDir, ".rex");
  const henchDir = join(tmpDir, ".hench");
  const runsDir = join(henchDir, "runs");
  mkdirSync(rexDir, { recursive: true });
  mkdirSync(runsDir, { recursive: true });

  if (prdItems !== undefined) {
    writeFileSync(
      join(rexDir, "prd.json"),
      JSON.stringify({
        schema: "rex/v1",
        project: "test",
        items: prdItems,
      }),
    );
  }

  return { tmpDir, rexDir, henchDir, runsDir };
}

/** Create a minimal mock aggregator that returns controlled task usage. */
function mockAggregator(taskUsage = {}) {
  return {
    getTaskUsage: async () => ({ ...taskUsage }),
    pruneStaleEntries: vi.fn(),
    reset: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("scheduler startup integration", { timeout: 120_000 }, () => {
  /** @type {ReturnType<typeof setInterval>[]} */
  const activeTimers = [];

  afterEach(() => {
    // Clean up any active timers
    for (const timer of activeTimers) {
      clearInterval(timer);
    }
    activeTimers.length = 0;
  });

  describe("registerUsageScheduler", () => {
    it("returns an interval handle that can be cleared", () => {
      const { tmpDir, rexDir } = makeTmpProject([]);
      try {
        const handle = registerUsageScheduler({
          ctx: { rexDir, projectDir: tmpDir },
          getAggregator: () => mockAggregator(),
          overrideIntervalMs: 60_000, // Long interval — we just test the handle
        });

        activeTimers.push(handle);

        // The handle must be clearable (used by shutdown handlers)
        expect(handle).toBeDefined();
        expect(typeof handle[Symbol.toPrimitive] === "function" || typeof handle === "object").toBe(true);
        clearInterval(handle);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("fires the cleanup cycle at the configured interval", async () => {
      const { tmpDir, rexDir } = makeTmpProject([
        { id: "task-1", title: "Keep", level: "task", status: "pending" },
      ]);

      let cycleCount = 0;

      try {
        // Use a very short interval (50ms) to verify firing
        const handle = startUsageCleanupScheduler(
          { rexDir, projectDir: tmpDir },
          () => {
            cycleCount++;
            return mockAggregator();
          },
          undefined, // no broadcast
          50, // 50ms interval
          collectAllIds,
          loadPRDSync,
        );

        activeTimers.push(handle);

        // Wait for at least 2 cycles
        await new Promise((resolve) => setTimeout(resolve, 180));

        // The scheduler should have fired multiple times
        expect(cycleCount).toBeGreaterThanOrEqual(2);

        clearInterval(handle);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("exercises full registerUsageScheduler → rex collectAllIds integration path", async () => {
      // This test verifies the complete wiring from registerUsageScheduler
      // (the facade used by the web server at startup) through to the rex
      // collectAllIds function. It ensures the scheduler correctly identifies
      // orphaned entries when wired through the registration facade.
      const prdItems = [
        { id: "epic-1", title: "Epic", level: "epic", status: "pending", children: [
          { id: "task-1", title: "Active task", level: "task", status: "in_progress" },
        ]},
      ];
      const { tmpDir, rexDir } = makeTmpProject(prdItems);

      const pruned = [];
      const aggregator = {
        getTaskUsage: async () => ({
          "task-1": { totalTokens: 100, runCount: 1 },
          "orphan-task": { totalTokens: 500, runCount: 3 },
        }),
        pruneStaleEntries: vi.fn((ids) => pruned.push(...ids)),
        reset: vi.fn(),
      };

      const broadcastCalls = [];

      try {
        const handle = registerUsageScheduler({
          ctx: { rexDir, projectDir: tmpDir },
          getAggregator: () => aggregator,
          broadcast: (data) => broadcastCalls.push(data),
          collectAllIds,
          overrideIntervalMs: 50,
          loadPRD: loadPRDSync,
        });

        activeTimers.push(handle);

        // Wait for at least one cleanup cycle
        await new Promise((resolve) => setTimeout(resolve, 150));

        clearInterval(handle);

        // The facade should have wired collectAllIds through, detecting the orphan
        expect(broadcastCalls.length).toBeGreaterThanOrEqual(1);
        const cleanupMsg = broadcastCalls.find((m) => m.type === "hench:usage-cleanup");
        expect(cleanupMsg).toBeDefined();
        expect(cleanupMsg.totalOrphaned).toBe(1);
        expect(cleanupMsg.orphanedEntries[0].taskId).toBe("orphan-task");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("passes broadcast function through to cleanup cycle", async () => {
      const prdItems = [
        { id: "task-1", title: "Active task", level: "task", status: "pending" },
      ];
      const { tmpDir, rexDir } = makeTmpProject(prdItems);

      const broadcastCalls = [];
      const broadcast = (data) => broadcastCalls.push(data);

      // Aggregator with an orphaned task
      const aggregator = mockAggregator({
        "task-1": { totalTokens: 100, runCount: 1 },
        "deleted-task": { totalTokens: 500, runCount: 3 },
      });

      try {
        const handle = startUsageCleanupScheduler(
          { rexDir, projectDir: tmpDir },
          () => aggregator,
          broadcast,
          50, // 50ms interval
          collectAllIds,
          loadPRDSync,
        );

        activeTimers.push(handle);

        // Wait for cleanup to fire
        await new Promise((resolve) => setTimeout(resolve, 120));

        clearInterval(handle);

        // Broadcast should have been called with cleanup data
        expect(broadcastCalls.length).toBeGreaterThanOrEqual(1);
        expect(broadcastCalls[0].type).toBe("hench:usage-cleanup");
        expect(broadcastCalls[0].totalOrphaned).toBe(1);
        expect(broadcastCalls[0].orphanedEntries[0].taskId).toBe("deleted-task");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("runCleanupCycle cross-package data flow", () => {
    it("uses rex collectAllIds to identify valid tasks", async () => {
      const prdItems = [
        { id: "epic-1", title: "Epic", level: "epic", status: "pending", children: [
          { id: "feat-1", title: "Feature", level: "feature", status: "pending", children: [
            { id: "task-1", title: "Task A", level: "task", status: "pending" },
            { id: "task-2", title: "Task B", level: "task", status: "completed" },
          ]},
        ]},
      ];
      const { tmpDir, rexDir } = makeTmpProject(prdItems);

      const aggregator = mockAggregator({
        "task-1": { totalTokens: 100, runCount: 1 },
        "task-2": { totalTokens: 200, runCount: 2 },
        "orphan-1": { totalTokens: 300, runCount: 1 },
        "orphan-2": { totalTokens: 400, runCount: 3 },
      });

      try {
        const result = await runCleanupCycle({
          aggregator,
          rexDir,
          collectAllIds,
          loadPRD: loadPRDSync,
        });

        expect(result.prdAvailable).toBe(true);
        expect(result.totalOrphaned).toBe(2);
        expect(result.orphanedEntries.map((e) => e.taskId).sort()).toEqual([
          "orphan-1",
          "orphan-2",
        ]);
        // Valid tasks (including parent container IDs) should not be orphaned
        expect(
          result.orphanedEntries.find((e) => e.taskId === "task-1"),
        ).toBeUndefined();
        expect(
          result.orphanedEntries.find((e) => e.taskId === "task-2"),
        ).toBeUndefined();
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("skips cleanup gracefully when PRD is missing", async () => {
      const { tmpDir, rexDir } = makeTmpProject(); // No prd.json

      const aggregator = mockAggregator({
        "task-1": { totalTokens: 100, runCount: 1 },
      });

      try {
        const result = await runCleanupCycle({
          aggregator,
          rexDir,
          collectAllIds,
          loadPRD: loadPRDSync,
        });

        expect(result.prdAvailable).toBe(false);
        expect(result.totalOrphaned).toBe(0);
        expect(result.orphanedEntries).toEqual([]);
        // Aggregator should NOT have been pruned
        expect(aggregator.pruneStaleEntries).not.toHaveBeenCalled();
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("skips cleanup when no collectAllIds is provided", async () => {
      const prdItems = [
        { id: "task-1", title: "Task", level: "task", status: "pending" },
      ];
      const { tmpDir, rexDir } = makeTmpProject(prdItems);

      const aggregator = mockAggregator({
        "task-1": { totalTokens: 100, runCount: 1 },
        "orphan": { totalTokens: 200, runCount: 1 },
      });

      try {
        const result = await runCleanupCycle({
          aggregator,
          rexDir,
          // No collectAllIds — simulate missing injection
        });

        expect(result.prdAvailable).toBe(false);
        expect(result.totalOrphaned).toBe(0);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("identifyOrphanedEntries (pure function)", () => {
    it("identifies entries not present in valid task IDs", () => {
      const taskUsage = {
        "task-1": { totalTokens: 100, runCount: 1 },
        "task-2": { totalTokens: 200, runCount: 2 },
        "orphan": { totalTokens: 300, runCount: 3 },
      };
      const validIds = new Set(["task-1", "task-2"]);

      const orphaned = identifyOrphanedEntries(taskUsage, validIds);

      expect(orphaned).toEqual([
        { taskId: "orphan", totalTokens: 300, runCount: 3 },
      ]);
    });

    it("returns empty array when all tasks are valid", () => {
      const taskUsage = {
        "task-1": { totalTokens: 100, runCount: 1 },
      };
      const validIds = new Set(["task-1", "task-2"]);

      const orphaned = identifyOrphanedEntries(taskUsage, validIds);
      expect(orphaned).toEqual([]);
    });
  });

  describe("loadCleanupConfig", () => {
    it("returns default interval when .n-dx.json is missing", () => {
      const { tmpDir } = makeTmpProject();
      try {
        const config = loadCleanupConfig(tmpDir);
        expect(config.intervalMs).toBe(DEFAULT_CLEANUP_INTERVAL_MS);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("reads custom interval from .n-dx.json", () => {
      const { tmpDir } = makeTmpProject();
      try {
        writeFileSync(
          join(tmpDir, ".n-dx.json"),
          JSON.stringify({ cleanup: { intervalMs: 3600000 } }),
        );

        const config = loadCleanupConfig(tmpDir);
        expect(config.intervalMs).toBe(3600000);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("returns default for malformed config", () => {
      const { tmpDir } = makeTmpProject();
      try {
        writeFileSync(join(tmpDir, ".n-dx.json"), "not json");

        const config = loadCleanupConfig(tmpDir);
        expect(config.intervalMs).toBe(DEFAULT_CLEANUP_INTERVAL_MS);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
