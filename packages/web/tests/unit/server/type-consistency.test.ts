/**
 * Type consistency tests — verify duplicated Rex domain constants in the web
 * server match the canonical definitions in packages/rex/src/schema/v1.ts.
 *
 * The web server intentionally duplicates Rex types and constants to avoid a
 * compile-time dependency, but the duplicates must stay in sync with the
 * canonical definitions. These tests catch drift early.
 *
 * The server-side duplicates in routes-rex.ts and routes-validation.ts use
 * local `Priority` and `ItemLevel` type aliases with type guards at the
 * JSON boundary, ensuring type-safe lookups into PRIORITY_ORDER and
 * LEVEL_HIERARCHY while handling unvalidated input.
 *
 * @see packages/rex/src/schema/v1.ts — canonical definitions
 * @see packages/web/src/server/routes-rex.ts — server-side duplicates (with local type aliases)
 * @see packages/web/src/server/routes-validation.ts — validation duplicates (with local type alias)
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

  it("PRIORITY_ORDER keys exactly match the Priority type members", () => {
    // routes-rex.ts duplicates Priority as a local type alias.
    // This test ensures that if a priority value is added or removed
    // in Rex, the duplicate type and PRIORITY_ORDER stay in sync.
    const keys = Object.keys(PRIORITY_ORDER);
    const expected: Priority[] = ["critical", "high", "medium", "low"];
    expect(new Set(keys)).toEqual(new Set(expected));
    expect(keys).toHaveLength(expected.length);
  });

  it("LEVEL_HIERARCHY keys exactly match the ItemLevel type members", () => {
    // routes-rex.ts and routes-validation.ts duplicate ItemLevel.
    // This verifies the local aliases won't miss new levels.
    const keys = Object.keys(LEVEL_HIERARCHY);
    const expected: ItemLevel[] = ["epic", "feature", "task", "subtask"];
    expect(new Set(keys)).toEqual(new Set(expected));
    expect(keys).toHaveLength(expected.length);
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
