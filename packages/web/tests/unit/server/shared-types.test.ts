/**
 * Unit tests for shared-types module.
 *
 * Validates that the cross-zone type contract is structurally sound:
 * - All exported types compile and can be instantiated
 * - Type shapes match the documented stability contract
 * - Types are compatible with their consuming modules
 *
 * This test exists to catch accidental type shape changes that would
 * break the cross-zone analytics contract between task-usage-analytics
 * and web-dashboard zones.
 *
 * @see packages/web/src/server/shared-types.ts
 */

import { describe, it, expect } from "vitest";
import type {
  TaskUsageAccumulator,
  CollectAllIdsFn,
  OrphanedEntry,
  CleanupResult,
  CleanupLogEntry,
  CleanupConfig,
} from "../../../src/server/shared-types.js";

describe("shared-types structural contract", () => {
  describe("TaskUsageAccumulator", () => {
    it("conforms to the expected shape", () => {
      const acc: TaskUsageAccumulator = {
        totalTokens: 1000,
        runCount: 5,
      };

      expect(acc.totalTokens).toBe(1000);
      expect(acc.runCount).toBe(5);
      expect(Object.keys(acc).sort()).toEqual(["runCount", "totalTokens"]);
    });
  });

  describe("CollectAllIdsFn", () => {
    it("accepts unknown[] and returns Set<string>", () => {
      const fn: CollectAllIdsFn = (items: unknown[]) => {
        const ids = new Set<string>();
        for (const item of items) {
          if (typeof item === "object" && item !== null && "id" in item) {
            ids.add(String((item as { id: unknown }).id));
          }
        }
        return ids;
      };

      const result = fn([{ id: "a" }, { id: "b" }]);
      expect(result).toBeInstanceOf(Set);
      expect(result.has("a")).toBe(true);
      expect(result.has("b")).toBe(true);
    });
  });

  describe("OrphanedEntry", () => {
    it("conforms to the expected shape", () => {
      const entry: OrphanedEntry = {
        taskId: "orphan-1",
        totalTokens: 500,
        runCount: 3,
      };

      expect(entry.taskId).toBe("orphan-1");
      expect(entry.totalTokens).toBe(500);
      expect(entry.runCount).toBe(3);
    });
  });

  describe("CleanupResult", () => {
    it("conforms to the expected shape with all fields", () => {
      const result: CleanupResult = {
        timestamp: "2026-01-01T00:00:00.000Z",
        prdAvailable: true,
        orphanedEntries: [
          { taskId: "orphan-1", totalTokens: 500, runCount: 3 },
        ],
        totalOrphaned: 1,
        totalTokensRemoved: 500,
        totalRunsRemoved: 3,
      };

      expect(result.prdAvailable).toBe(true);
      expect(result.totalOrphaned).toBe(1);
      expect(result.orphanedEntries.length).toBe(1);
      expect(result.orphanedEntries[0].taskId).toBe("orphan-1");
    });

    it("represents empty cleanup correctly", () => {
      const result: CleanupResult = {
        timestamp: new Date().toISOString(),
        prdAvailable: false,
        orphanedEntries: [],
        totalOrphaned: 0,
        totalTokensRemoved: 0,
        totalRunsRemoved: 0,
      };

      expect(result.prdAvailable).toBe(false);
      expect(result.totalOrphaned).toBe(0);
      expect(result.orphanedEntries).toEqual([]);
    });
  });

  describe("CleanupLogEntry", () => {
    it("extends CleanupResult with event field", () => {
      const entry: CleanupLogEntry = {
        event: "usage_cleanup",
        timestamp: "2026-01-01T00:00:00.000Z",
        prdAvailable: true,
        orphanedEntries: [],
        totalOrphaned: 0,
        totalTokensRemoved: 0,
        totalRunsRemoved: 0,
      };

      expect(entry.event).toBe("usage_cleanup");
      // Serialization should produce valid JSON
      const json = JSON.stringify(entry);
      const parsed = JSON.parse(json);
      expect(parsed.event).toBe("usage_cleanup");
    });
  });

  describe("CleanupConfig", () => {
    it("contains intervalMs", () => {
      const config: CleanupConfig = {
        intervalMs: 604800000, // 7 days
      };

      expect(config.intervalMs).toBe(604800000);
    });
  });

  describe("cross-zone compatibility", () => {
    it("CleanupResult can be broadcast as unknown data", () => {
      // Simulates the broadcast(data: unknown) pattern used in the scheduler
      const result: CleanupResult = {
        timestamp: new Date().toISOString(),
        prdAvailable: true,
        orphanedEntries: [{ taskId: "t1", totalTokens: 100, runCount: 1 }],
        totalOrphaned: 1,
        totalTokensRemoved: 100,
        totalRunsRemoved: 1,
      };

      const broadcastData: unknown = { type: "hench:usage-cleanup", ...result };
      const serialized = JSON.stringify(broadcastData);
      const deserialized = JSON.parse(serialized);

      expect(deserialized.type).toBe("hench:usage-cleanup");
      expect(deserialized.totalOrphaned).toBe(1);
    });

    it("TaskUsageAccumulator values are numeric", () => {
      // Ensures accumulator math works correctly
      const a: TaskUsageAccumulator = { totalTokens: 100, runCount: 1 };
      const b: TaskUsageAccumulator = { totalTokens: 200, runCount: 2 };

      const merged: TaskUsageAccumulator = {
        totalTokens: a.totalTokens + b.totalTokens,
        runCount: a.runCount + b.runCount,
      };

      expect(merged.totalTokens).toBe(300);
      expect(merged.runCount).toBe(3);
    });
  });
});
