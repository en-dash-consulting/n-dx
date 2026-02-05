import { describe, it, expect } from "vitest";
import { validateDAG } from "../../../src/core/dag.js";
import type { PRDItem } from "../../../src/schema/index.js";

function makeItem(overrides: Partial<PRDItem> & { id: string; title: string }): PRDItem {
  return {
    status: "pending",
    level: "task",
    ...overrides,
  };
}

describe("validateDAG", () => {
  it("accepts empty tree", () => {
    const result = validateDAG([]);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts tree with no blockedBy edges", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "A" }),
      makeItem({ id: "t2", title: "B" }),
    ];
    const result = validateDAG(items);
    expect(result.valid).toBe(true);
  });

  it("accepts valid linear chain", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "A" }),
      makeItem({ id: "t2", title: "B", blockedBy: ["t1"] }),
      makeItem({ id: "t3", title: "C", blockedBy: ["t2"] }),
    ];
    const result = validateDAG(items);
    expect(result.valid).toBe(true);
  });

  it("detects duplicate IDs", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "A" }),
      makeItem({ id: "t1", title: "B" }),
    ];
    const result = validateDAG(items);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Duplicate ID"))).toBe(true);
  });

  it("detects orphan references", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "A", blockedBy: ["nonexistent"] }),
    ];
    const result = validateDAG(items);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Orphan reference"))).toBe(true);
  });

  it("detects self-references", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "A", blockedBy: ["t1"] }),
    ];
    const result = validateDAG(items);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Self-reference"))).toBe(true);
  });

  it("detects cycles", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "A", blockedBy: ["t2"] }),
      makeItem({ id: "t2", title: "B", blockedBy: ["t1"] }),
    ];
    const result = validateDAG(items);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Cycle detected"))).toBe(true);
  });

  it("detects triangle cycle", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "A", blockedBy: ["t3"] }),
      makeItem({ id: "t2", title: "B", blockedBy: ["t1"] }),
      makeItem({ id: "t3", title: "C", blockedBy: ["t2"] }),
    ];
    const result = validateDAG(items);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Cycle detected"))).toBe(true);
  });

  it("works with nested items", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        children: [
          makeItem({ id: "t1", title: "A" }),
          makeItem({ id: "t2", title: "B", blockedBy: ["t1"] }),
        ],
      }),
    ];
    const result = validateDAG(items);
    expect(result.valid).toBe(true);
  });

  it("detects cycles across nesting levels", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        blockedBy: ["t1"],
        children: [
          makeItem({ id: "t1", title: "A", blockedBy: ["e1"] }),
        ],
      }),
    ];
    const result = validateDAG(items);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Cycle detected"))).toBe(true);
  });
});
