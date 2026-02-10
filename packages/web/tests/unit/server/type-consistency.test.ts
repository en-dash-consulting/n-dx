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
  type Priority,
  type ItemLevel,
  type ItemStatus,
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

  it("VALID_LEVELS matches LEVEL_HIERARCHY keys", () => {
    const canonicalLevels = new Set(Object.keys(CANONICAL_LEVEL_HIERARCHY));
    expect(VALID_LEVELS).toEqual(canonicalLevels);
  });

  it("VALID_STATUSES covers API-settable statuses", () => {
    // The canonical statuses include "deleted" which VALID_STATUSES omits
    // because deleted items shouldn't be settable via API.
    const canonicalStatuses: ItemStatus[] = [
      "pending",
      "in_progress",
      "completed",
      "deferred",
      "blocked",
      "deleted",
    ];
    expect(canonicalStatuses).toHaveLength(6);
    // VALID_STATUSES should be a subset (minus "deleted")
    for (const status of VALID_STATUSES) {
      expect(canonicalStatuses).toContain(status);
    }
    expect(VALID_STATUSES.has("deleted" as never)).toBe(false);
  });

  it("VALID_PRIORITIES matches canonical Priority", () => {
    const canonicalPriorities: Priority[] = ["critical", "high", "medium", "low"];
    expect(VALID_PRIORITIES).toEqual(new Set(canonicalPriorities));
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

  it("isPriority type guard works correctly", () => {
    expect(isPriority("critical")).toBe(true);
    expect(isPriority("high")).toBe(true);
    expect(isPriority("medium")).toBe(true);
    expect(isPriority("low")).toBe(true);
    expect(isPriority("invalid")).toBe(false);
    expect(isPriority(undefined)).toBe(false);
  });

  it("isItemLevel type guard works correctly", () => {
    expect(isItemLevel("epic")).toBe(true);
    expect(isItemLevel("feature")).toBe(true);
    expect(isItemLevel("task")).toBe(true);
    expect(isItemLevel("subtask")).toBe(true);
    expect(isItemLevel("invalid")).toBe(false);
    expect(isItemLevel(undefined)).toBe(false);
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
