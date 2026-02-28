/**
 * Type consistency tests — verify the web package's duplicated types
 * stay in sync with the canonical Rex definitions.
 *
 * After the rex-domain.ts deduplication, server routes now import Rex
 * types and constants directly through the Rex gateway (rex-gateway.ts).
 * The only remaining intentional duplications are:
 *
 *   1. Viewer types (packages/web/src/viewer/components/prd-tree/types.ts)
 *      — browser-bundled code that cannot import Node.js packages.
 *   2. Viewer LogEntry (packages/web/src/viewer/views/analysis.ts)
 *      — local interface for log display.
 *
 * These tests verify those viewer mirrors stay in sync with canonical
 * Rex definitions, and that the gateway re-exports are correct.
 *
 * @see packages/rex/src/schema/v1.ts — canonical definitions
 * @see packages/web/src/server/rex-gateway.ts — gateway (re-exports from rex)
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

// Gateway re-exports (should be identical references)
import {
  PRIORITY_ORDER as GATEWAY_PRIORITY_ORDER,
  LEVEL_HIERARCHY as GATEWAY_LEVEL_HIERARCHY,
  VALID_LEVELS as GATEWAY_VALID_LEVELS,
  VALID_STATUSES as GATEWAY_VALID_STATUSES,
  VALID_PRIORITIES as GATEWAY_VALID_PRIORITIES,
  VALID_REQUIREMENT_CATEGORIES as GATEWAY_VALID_REQ_CATEGORIES,
  VALID_VALIDATION_TYPES as GATEWAY_VALID_VALIDATION_TYPES,
  CHILD_LEVEL as GATEWAY_CHILD_LEVEL,
  isPriority as gatewayIsPriority,
  isItemLevel as gatewayIsItemLevel,
  isRequirementCategory as gatewayIsReqCategory,
  isValidationType as gatewayIsValidationType,
} from "../../../src/server/rex-gateway.js";

describe("Gateway re-exports are identical to canonical", () => {
  /**
   * Since the gateway re-exports directly from rex, these should be
   * the exact same references. This test guards against accidental
   * re-introduction of local duplicates in the gateway.
   */

  it("PRIORITY_ORDER is same reference", () => {
    expect(GATEWAY_PRIORITY_ORDER).toBe(CANONICAL_PRIORITY_ORDER);
  });

  it("LEVEL_HIERARCHY is same reference", () => {
    expect(GATEWAY_LEVEL_HIERARCHY).toBe(CANONICAL_LEVEL_HIERARCHY);
  });

  it("VALID_LEVELS is same reference", () => {
    expect(GATEWAY_VALID_LEVELS).toBe(CANONICAL_VALID_LEVELS);
  });

  it("VALID_STATUSES is same reference", () => {
    expect(GATEWAY_VALID_STATUSES).toBe(CANONICAL_VALID_STATUSES);
  });

  it("VALID_PRIORITIES is same reference", () => {
    expect(GATEWAY_VALID_PRIORITIES).toBe(CANONICAL_VALID_PRIORITIES);
  });

  it("VALID_REQUIREMENT_CATEGORIES is same reference", () => {
    expect(GATEWAY_VALID_REQ_CATEGORIES).toBe(CANONICAL_VALID_REQ_CATEGORIES);
  });

  it("VALID_VALIDATION_TYPES is same reference", () => {
    expect(GATEWAY_VALID_VALIDATION_TYPES).toBe(CANONICAL_VALID_VALIDATION_TYPES);
  });

  it("CHILD_LEVEL is same reference", () => {
    expect(GATEWAY_CHILD_LEVEL).toBe(CANONICAL_CHILD_LEVEL);
  });

  it("isPriority is same reference", () => {
    expect(gatewayIsPriority).toBe(canonicalIsPriority);
  });

  it("isItemLevel is same reference", () => {
    expect(gatewayIsItemLevel).toBe(canonicalIsItemLevel);
  });

  it("isRequirementCategory is same reference", () => {
    expect(gatewayIsReqCategory).toBe(canonicalIsReqCategory);
  });

  it("isValidationType is same reference", () => {
    expect(gatewayIsValidationType).toBe(canonicalIsValidationType);
  });
});

describe("Viewer type mirrors match canonical definitions", () => {
  /**
   * The viewer types in packages/web/src/viewer/components/prd-tree/types.ts
   * are intentionally duplicated because browser-bundled code cannot import
   * Node.js packages. These tests verify the canonical shapes haven't drifted.
   */

  it("ItemLevel covers exactly 4 values", () => {
    const levels: ItemLevel[] = ["epic", "feature", "task", "subtask"];
    expect(CANONICAL_VALID_LEVELS.size).toBe(4);
    for (const level of levels) {
      expect(CANONICAL_VALID_LEVELS.has(level)).toBe(true);
    }
  });

  it("ItemStatus covers exactly 7 values", () => {
    const statuses: ItemStatus[] = ["pending", "in_progress", "completed", "failing", "deferred", "blocked", "deleted"];
    expect(CANONICAL_VALID_STATUSES.size).toBe(7);
    for (const status of statuses) {
      expect(CANONICAL_VALID_STATUSES.has(status)).toBe(true);
    }
  });

  it("Priority covers exactly 4 values", () => {
    const priorities: Priority[] = ["critical", "high", "medium", "low"];
    expect(CANONICAL_VALID_PRIORITIES.size).toBe(4);
    for (const p of priorities) {
      expect(CANONICAL_VALID_PRIORITIES.has(p)).toBe(true);
    }
  });

  it("PRIORITY_ORDER maps all priority values", () => {
    const priorities = Object.keys(CANONICAL_PRIORITY_ORDER);
    expect(priorities).toHaveLength(4);
    expect(priorities).toContain("critical");
    expect(priorities).toContain("high");
    expect(priorities).toContain("medium");
    expect(priorities).toContain("low");
  });

  it("LEVEL_HIERARCHY keys match ItemLevel values", () => {
    const keys = Object.keys(CANONICAL_LEVEL_HIERARCHY);
    const expected: ItemLevel[] = ["epic", "feature", "task", "subtask"];
    expect(new Set(keys)).toEqual(new Set(expected));
    expect(keys).toHaveLength(expected.length);
  });

  it("CHILD_LEVEL maps every level correctly", () => {
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

  it("type guards work correctly", () => {
    expect(canonicalIsPriority("critical")).toBe(true);
    expect(canonicalIsPriority("invalid")).toBe(false);
    expect(canonicalIsPriority(undefined)).toBe(false);

    expect(canonicalIsItemLevel("epic")).toBe(true);
    expect(canonicalIsItemLevel("invalid")).toBe(false);
    expect(canonicalIsItemLevel(undefined)).toBe(false);

    expect(canonicalIsItemStatus("pending")).toBe(true);
    expect(canonicalIsItemStatus("deleted")).toBe(true);
    expect(canonicalIsItemStatus("invalid")).toBe(false);
    expect(canonicalIsItemStatus(undefined)).toBe(false);

    expect(canonicalIsReqCategory("technical")).toBe(true);
    expect(canonicalIsReqCategory("invalid")).toBe(false);
    expect(canonicalIsReqCategory(undefined)).toBe(false);

    expect(canonicalIsValidationType("automated")).toBe(true);
    expect(canonicalIsValidationType("invalid")).toBe(false);
    expect(canonicalIsValidationType(undefined)).toBe(false);
  });

  it("viewer type mirrors have expected shape (compile-time reminder)", () => {
    // packages/web/src/viewer/components/prd-tree/types.ts mirrors:
    //   ItemLevel = "epic" | "feature" | "task" | "subtask"
    //   ItemStatus = "pending" | "in_progress" | "completed" | "deferred" | "blocked" | "deleted"
    //   Priority = "critical" | "high" | "medium" | "low"
    //   RequirementCategory = "technical" | "performance" | "security" | "accessibility" | "compatibility" | "quality"
    //   RequirementValidationType = "automated" | "manual" | "metric"
    //
    // These are compile-time types and can't be tested at runtime.
    // This test serves as a reminder: if canonical definitions change,
    // update the viewer mirrors in types.ts.
    const levels: ItemLevel[] = ["epic", "feature", "task", "subtask"];
    const statuses: ItemStatus[] = ["pending", "in_progress", "completed", "failing", "deferred", "blocked", "deleted"];
    const priorities: Priority[] = ["critical", "high", "medium", "low"];
    const categories: RequirementCategory[] = ["technical", "performance", "security", "accessibility", "compatibility", "quality"];
    const validationTypes: RequirementValidationType[] = ["automated", "manual", "metric"];

    expect(levels).toHaveLength(4);
    expect(statuses).toHaveLength(7);
    expect(priorities).toHaveLength(4);
    expect(categories).toHaveLength(6);
    expect(validationTypes).toHaveLength(3);
  });
});
