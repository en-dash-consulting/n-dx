/**
 * Type consistency tests — verify the web package's Rex domain constants
 * (rex-domain.ts) match the canonical definitions in packages/rex/src/schema/v1.ts.
 *
 * The web server intentionally duplicates Rex types and constants in a single
 * shared module (rex-domain.ts) to avoid a compile-time dependency on the Rex
 * package. The duplicates must stay in sync with the canonical definitions.
 * These tests catch drift early.
 *
 * @see packages/rex/src/schema/v1.ts — canonical definitions
 * @see packages/web/src/server/rex-domain.ts — web server duplicates (single source for web)
 * @see packages/web/src/viewer/components/prd-tree/types.ts — viewer type mirrors
 */

import { describe, it, expect } from "vitest";

// Canonical definitions from Rex
import {
  PRIORITY_ORDER as CANONICAL_PRIORITY_ORDER,
  LEVEL_HIERARCHY as CANONICAL_LEVEL_HIERARCHY,
  VALID_LEVELS as CANONICAL_VALID_LEVELS,
  VALID_STATUSES as CANONICAL_VALID_STATUSES,
  VALID_PRIORITIES as CANONICAL_VALID_PRIORITIES,
  VALID_REQUIREMENT_CATEGORIES as CANONICAL_VALID_REQ_CATEGORIES,
  VALID_VALIDATION_TYPES as CANONICAL_VALID_VALIDATION_TYPES,
  CHILD_LEVEL as CANONICAL_CHILD_LEVEL,
  isPriority as canonicalIsPriority,
  isItemLevel as canonicalIsItemLevel,
  isItemStatus as canonicalIsItemStatus,
  isRequirementCategory as canonicalIsReqCategory,
  isValidationType as canonicalIsValidationType,
  type Priority,
  type ItemLevel,
  type ItemStatus,
  type RequirementCategory,
  type RequirementValidationType,
} from "../../../../rex/src/schema/v1.js";

// Web server duplicates from the shared rex-domain module
import {
  PRIORITY_ORDER as LOCAL_PRIORITY_ORDER,
  LEVEL_HIERARCHY as LOCAL_LEVEL_HIERARCHY,
  VALID_LEVELS,
  VALID_STATUSES,
  VALID_PRIORITIES,
  isPriority,
  isItemLevel,
} from "../../../src/server/rex-domain.js";

describe("Rex domain constant consistency", () => {
  /**
   * These tests compare the canonical Rex values against the web package's
   * rex-domain.ts duplicates. If any test fails, both the canonical source
   * AND the web duplicates need to be updated together.
   */

  it("PRIORITY_ORDER matches canonical", () => {
    expect(LOCAL_PRIORITY_ORDER).toEqual(CANONICAL_PRIORITY_ORDER);
  });

  it("LEVEL_HIERARCHY matches canonical", () => {
    expect(LOCAL_LEVEL_HIERARCHY).toEqual(CANONICAL_LEVEL_HIERARCHY);
  });

  it("Priority type covers exactly 4 values", () => {
    const priorities = Object.keys(CANONICAL_PRIORITY_ORDER);
    expect(priorities).toHaveLength(4);
    expect(priorities).toContain("critical");
    expect(priorities).toContain("high");
    expect(priorities).toContain("medium");
    expect(priorities).toContain("low");
  });

  it("VALID_LEVELS matches canonical VALID_LEVELS", () => {
    expect(VALID_LEVELS).toEqual(CANONICAL_VALID_LEVELS);
  });

  it("VALID_STATUSES covers API-settable statuses", () => {
    // The canonical VALID_STATUSES includes "deleted", but the web
    // VALID_STATUSES omits it because deleted items shouldn't be
    // settable via the API.
    for (const status of VALID_STATUSES) {
      expect(CANONICAL_VALID_STATUSES.has(status as ItemStatus)).toBe(true);
    }
    expect(VALID_STATUSES.has("deleted" as never)).toBe(false);
    // The web set should be exactly canonical minus "deleted"
    expect(VALID_STATUSES.size).toBe(CANONICAL_VALID_STATUSES.size - 1);
  });

  it("VALID_PRIORITIES matches canonical VALID_PRIORITIES", () => {
    expect(VALID_PRIORITIES).toEqual(CANONICAL_VALID_PRIORITIES);
  });

  it("PRIORITY_ORDER keys exactly match the Priority type members", () => {
    const keys = Object.keys(LOCAL_PRIORITY_ORDER);
    const expected: Priority[] = ["critical", "high", "medium", "low"];
    expect(new Set(keys)).toEqual(new Set(expected));
    expect(keys).toHaveLength(expected.length);
  });

  it("LEVEL_HIERARCHY keys exactly match the ItemLevel type members", () => {
    const keys = Object.keys(LOCAL_LEVEL_HIERARCHY);
    const expected: ItemLevel[] = ["epic", "feature", "task", "subtask"];
    expect(new Set(keys)).toEqual(new Set(expected));
    expect(keys).toHaveLength(expected.length);
  });

  it("isPriority type guard matches canonical behaviour", () => {
    const testValues = ["critical", "high", "medium", "low", "invalid", "", "CRITICAL"];
    for (const v of testValues) {
      expect(isPriority(v)).toBe(canonicalIsPriority(v));
    }
    expect(isPriority(undefined)).toBe(canonicalIsPriority(undefined));
  });

  it("isItemLevel type guard matches canonical behaviour", () => {
    const testValues = ["epic", "feature", "task", "subtask", "invalid", "", "EPIC"];
    for (const v of testValues) {
      expect(isItemLevel(v)).toBe(canonicalIsItemLevel(v));
    }
    expect(isItemLevel(undefined)).toBe(canonicalIsItemLevel(undefined));
  });

  it("canonical isItemStatus type guard works correctly", () => {
    expect(canonicalIsItemStatus("pending")).toBe(true);
    expect(canonicalIsItemStatus("in_progress")).toBe(true);
    expect(canonicalIsItemStatus("completed")).toBe(true);
    expect(canonicalIsItemStatus("deferred")).toBe(true);
    expect(canonicalIsItemStatus("blocked")).toBe(true);
    expect(canonicalIsItemStatus("deleted")).toBe(true);
    expect(canonicalIsItemStatus("invalid")).toBe(false);
    expect(canonicalIsItemStatus(undefined)).toBe(false);
  });

  it("canonical CHILD_LEVEL maps every level correctly", () => {
    expect(CANONICAL_CHILD_LEVEL.epic).toBe("feature");
    expect(CANONICAL_CHILD_LEVEL.feature).toBe("task");
    expect(CANONICAL_CHILD_LEVEL.task).toBe("subtask");
    expect(CANONICAL_CHILD_LEVEL.subtask).toBeNull();
  });

  it("RequirementCategory covers exactly 6 values", () => {
    const categories: RequirementCategory[] = [
      "technical", "performance", "security", "accessibility", "compatibility", "quality",
    ];
    expect(CANONICAL_VALID_REQ_CATEGORIES.size).toBe(6);
    for (const cat of categories) {
      expect(CANONICAL_VALID_REQ_CATEGORIES.has(cat)).toBe(true);
    }
  });

  it("RequirementValidationType covers exactly 3 values", () => {
    const types: RequirementValidationType[] = ["automated", "manual", "metric"];
    expect(CANONICAL_VALID_VALIDATION_TYPES.size).toBe(3);
    for (const t of types) {
      expect(CANONICAL_VALID_VALIDATION_TYPES.has(t)).toBe(true);
    }
  });

  it("isRequirementCategory type guard works correctly", () => {
    expect(canonicalIsReqCategory("technical")).toBe(true);
    expect(canonicalIsReqCategory("performance")).toBe(true);
    expect(canonicalIsReqCategory("invalid")).toBe(false);
    expect(canonicalIsReqCategory(undefined)).toBe(false);
  });

  it("isValidationType type guard works correctly", () => {
    expect(canonicalIsValidationType("automated")).toBe(true);
    expect(canonicalIsValidationType("manual")).toBe(true);
    expect(canonicalIsValidationType("metric")).toBe(true);
    expect(canonicalIsValidationType("invalid")).toBe(false);
    expect(canonicalIsValidationType(undefined)).toBe(false);
  });

  it("viewer type mirrors have expected shape", () => {
    // packages/web/src/viewer/components/prd-tree/types.ts mirrors:
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
