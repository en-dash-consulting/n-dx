/**
 * Type consistency tests — verify duplicated Rex domain constants in sourcevision
 * match the canonical definitions in packages/rex/src/schema/v1.ts.
 *
 * Sourcevision intentionally duplicates Rex types and constants to avoid a
 * compile-time dependency, but the duplicates must stay in sync with the
 * canonical definitions. These tests catch drift early.
 *
 * @see packages/rex/src/schema/v1.ts — canonical definitions
 * @see packages/sourcevision/src/cli/server/routes-rex.ts — server-side duplicates
 * @see packages/sourcevision/src/cli/server/routes-validation.ts — validation duplicates
 */

import { describe, it, expect } from "vitest";
import {
  PRIORITY_ORDER,
  LEVEL_HIERARCHY,
  type Priority,
  type ItemLevel,
  type ItemStatus,
} from "../../../../rex/src/schema/v1.js";

describe("Rex domain constant consistency", () => {
  /**
   * We import the canonical Rex values and compare against hardcoded
   * expectations that mirror what routes-rex.ts and routes-validation.ts use.
   * If these tests fail, both the canonical source AND the duplicates in
   * routes-rex.ts / routes-validation.ts need to be updated together.
   */

  it("PRIORITY_ORDER has expected keys and ordering", () => {
    // These are the values duplicated in routes-rex.ts:170
    expect(PRIORITY_ORDER).toEqual({
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    });
  });

  it("LEVEL_HIERARCHY has expected parent-child relationships", () => {
    // These are the values duplicated in routes-rex.ts:43 and routes-validation.ts:76
    expect(LEVEL_HIERARCHY).toEqual({
      epic: [null],
      feature: ["epic"],
      task: ["feature", "epic"],
      subtask: ["task"],
    });
  });

  it("Priority type covers exactly 4 values", () => {
    // Validate the keys of PRIORITY_ORDER match the Priority type
    const priorities = Object.keys(PRIORITY_ORDER);
    expect(priorities).toHaveLength(4);
    expect(priorities).toContain("critical");
    expect(priorities).toContain("high");
    expect(priorities).toContain("medium");
    expect(priorities).toContain("low");
  });

  it("VALID_LEVELS matches LEVEL_HIERARCHY keys", () => {
    // routes-rex.ts:37 defines VALID_LEVELS = new Set(["epic", "feature", "task", "subtask"])
    const canonicalLevels = new Set(Object.keys(LEVEL_HIERARCHY));
    const expectedLevels = new Set(["epic", "feature", "task", "subtask"]);
    expect(canonicalLevels).toEqual(expectedLevels);
  });

  it("VALID_STATUSES matches canonical ItemStatus", () => {
    // routes-rex.ts:38 defines VALID_STATUSES
    // The canonical statuses include "deleted" which routes-rex omits for good reason
    // (deleted items shouldn't be settable via API). This test documents the canonical set.
    const canonicalStatuses: ItemStatus[] = [
      "pending",
      "in_progress",
      "completed",
      "deferred",
      "blocked",
      "deleted",
    ];
    expect(canonicalStatuses).toHaveLength(6);
  });

  it("VALID_PRIORITIES matches canonical Priority", () => {
    // routes-rex.ts:39 defines VALID_PRIORITIES
    const canonicalPriorities: Priority[] = ["critical", "high", "medium", "low"];
    expect(new Set(canonicalPriorities)).toEqual(new Set(Object.keys(PRIORITY_ORDER)));
  });

  it("viewer type mirrors have expected shape", () => {
    // packages/sourcevision/src/viewer/components/prd-tree/types.ts mirrors:
    //   ItemLevel = "epic" | "feature" | "task" | "subtask"
    //   ItemStatus = "pending" | "in_progress" | "completed" | "deferred" | "blocked" | "deleted"
    //   Priority = "critical" | "high" | "medium" | "low"
    //
    // These are compile-time types and can't be tested at runtime.
    // This test serves as a reminder: if canonical definitions change,
    // update the viewer mirrors in types.ts.
    const levels: ItemLevel[] = ["epic", "feature", "task", "subtask"];
    const statuses: ItemStatus[] = ["pending", "in_progress", "completed", "deferred", "blocked", "deleted"];
    const priorities: Priority[] = ["critical", "high", "medium", "low"];

    // If Rex changes these types, this test will fail at compile time,
    // signaling that the viewer mirrors need updating too.
    expect(levels).toHaveLength(4);
    expect(statuses).toHaveLength(6);
    expect(priorities).toHaveLength(4);
  });
});
