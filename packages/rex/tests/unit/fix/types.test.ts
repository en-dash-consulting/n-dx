/**
 * Structural contract tests for fix/types.ts.
 *
 * This file has no runtime logic — it exports pure type definitions.
 * These tests verify the shape and value constraints of those types,
 * locking down the module's behavioral contract for the fix satellite zone.
 */
import { describe, it, expect } from "vitest";
import type { FixItem, FixItemStatus, FixKind, FixAction, FixResult } from "../../../src/fix/types.js";

describe("FixItemStatus", () => {
  it("accepts all five valid status values", () => {
    const statuses: FixItemStatus[] = [
      "pending",
      "in_progress",
      "completed",
      "deferred",
      "deleted",
    ];
    expect(statuses).toHaveLength(5);
    // TypeScript would reject any value not in the union — this list is exhaustive.
  });
});

describe("FixKind", () => {
  it("includes all three fix kinds", () => {
    const kinds: FixKind[] = [
      "missing_timestamp",
      "orphan_blocked_by",
      "parent_child_alignment",
    ];
    expect(kinds).toHaveLength(3);
  });
});

describe("FixItem", () => {
  it("constructs with required fields only", () => {
    const item: FixItem = { id: "test-id", title: "Test Item", status: "pending" };
    expect(item.id).toBe("test-id");
    expect(item.title).toBe("Test Item");
    expect(item.status).toBe("pending");
    expect(item.level).toBeUndefined();
    expect(item.blockedBy).toBeUndefined();
    expect(item.children).toBeUndefined();
  });

  it("accepts all optional fields", () => {
    const item: FixItem = {
      id: "full-id",
      title: "Full Item",
      status: "in_progress",
      level: "task",
      startedAt: "2024-01-01T00:00:00.000Z",
      completedAt: "2024-01-02T00:00:00.000Z",
      blockedBy: ["dep-id"],
      children: [{ id: "child", title: "Child", status: "pending" }],
    };
    expect(item.level).toBe("task");
    expect(item.startedAt).toBeDefined();
    expect(item.completedAt).toBeDefined();
    expect(item.blockedBy).toEqual(["dep-id"]);
    expect(item.children).toHaveLength(1);
  });

  it("children array is recursive (FixItem[])", () => {
    const grandchild: FixItem = { id: "gc", title: "Grandchild", status: "completed" };
    const child: FixItem = { id: "c", title: "Child", status: "pending", children: [grandchild] };
    const parent: FixItem = { id: "p", title: "Parent", status: "pending", children: [child] };
    expect(parent.children![0]!.children![0]!.id).toBe("gc");
  });
});

describe("FixAction", () => {
  it("constructs with all required fields", () => {
    const action: FixAction = {
      kind: "missing_timestamp",
      itemId: "abc-123",
      description: "Add missing completedAt timestamp",
    };
    expect(action.kind).toBe("missing_timestamp");
    expect(action.itemId).toBe("abc-123");
    expect(action.description).toBeTruthy();
  });

  it("supports all FixKind values", () => {
    const kinds: FixKind[] = ["missing_timestamp", "orphan_blocked_by", "parent_child_alignment"];
    for (const kind of kinds) {
      const action: FixAction = { kind, itemId: "id", description: "desc" };
      expect(action.kind).toBe(kind);
    }
  });
});

describe("FixResult", () => {
  it("constructs with empty actions and zero mutatedCount", () => {
    const result: FixResult = { actions: [], mutatedCount: 0 };
    expect(result.actions).toHaveLength(0);
    expect(result.mutatedCount).toBe(0);
  });

  it("holds actions and mutatedCount independently", () => {
    // mutatedCount tracks mutations, actions tracks the log of what was done.
    // They may differ if multiple mutations produce one action entry.
    const result: FixResult = {
      actions: [
        { kind: "missing_timestamp", itemId: "x", description: "fix x" },
      ],
      mutatedCount: 3,
    };
    expect(result.actions).toHaveLength(1);
    expect(result.mutatedCount).toBe(3);
  });
});
