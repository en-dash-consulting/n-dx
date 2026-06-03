/**
 * Shared test helpers and fixtures for rex test suite.
 * Consolidates duplicate item builders and tree factories used across test files.
 */

import type { PRDItem, ItemStatus } from "../../src/index.js";

/**
 * Creates a minimal PRDItem for testing.
 * Use for quick setup when you don't need specific properties.
 */
export function makeItem(overrides: Partial<PRDItem> & { id: string; title: string }): PRDItem {
  return {
    status: "pending",
    level: "task",
    ...overrides,
  };
}

/**
 * Creates a PRDTask (task-level item) for testing.
 */
export function makeTask(overrides?: Partial<PRDItem> & { id?: string; title?: string }): PRDItem {
  return makeItem({
    id: "task-1",
    title: "Test task",
    level: "task",
    ...overrides,
  });
}

/**
 * Creates a PRDFeature (feature-level item) for testing.
 */
export function makeFeature(overrides?: Partial<PRDItem> & { id?: string; title?: string }): PRDItem {
  return makeItem({
    id: "feature-1",
    title: "Test feature",
    level: "feature",
    ...overrides,
  });
}

/**
 * Creates a PRDEpic (epic-level item) for testing.
 */
export function makeEpic(overrides?: Partial<PRDItem> & { id?: string; title?: string }): PRDItem {
  return makeItem({
    id: "epic-1",
    title: "Test epic",
    level: "epic",
    ...overrides,
  });
}

/**
 * Creates a PRDSubtask (subtask-level item) for testing.
 */
export function makeSubtask(overrides?: Partial<PRDItem> & { id?: string; title?: string }): PRDItem {
  return makeItem({
    id: "subtask-1",
    title: "Test subtask",
    level: "subtask",
    ...overrides,
  });
}

/**
 * Creates a proposal object for testing.
 */
export function makeProposal(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "move",
    itemId: "item-1",
    reason: "Test proposal",
    ...overrides,
  };
}

/**
 * Creates a standard PRD tree for testing: epic → feature → 3 tasks, one with subtasks.
 */
export function makeTree(): PRDItem[] {
  return [
    makeEpic({ id: "epic-1", title: "Epic 1" }),
    makeFeature({ id: "feature-1", title: "Feature 1", parentId: "epic-1" }),
    makeTask({ id: "task-1", title: "Task 1", parentId: "feature-1" }),
    makeTask({ id: "task-2", title: "Task 2", parentId: "feature-1", status: "completed" }),
    makeTask({ id: "task-3", title: "Task 3", parentId: "feature-1", children: [{ id: "subtask-1", title: "Subtask 1" }] }),
  ];
}

/**
 * Creates a full PRD document structure for testing.
 */
export function makeDoc(overrides?: { items?: PRDItem[]; title?: string }): {
  schema: string;
  title: string;
  items: PRDItem[];
} {
  return {
    schema: "rex/v1",
    title: "Test PRD",
    items: [],
    ...overrides,
  };
}

/**
 * Creates a PRD with a standard tree structure.
 */
export function makePrd(overrides?: {
  items?: PRDItem[];
  title?: string;
}): {
  schema: string;
  title: string;
  items: PRDItem[];
} {
  return makeDoc({ items: makeTree(), title: "Test PRD", ...overrides });
}

/**
 * Creates a minimal PRD document for quick test setup.
 */
export function minimalDoc(): {
  schema: string;
  title: string;
  items: PRDItem[];
} {
  return {
    schema: "rex/v1",
    title: "Test",
    items: [],
  };
}

/**
 * Builds a PRD tree with specific items.
 */
export function buildTree(items: PRDItem[]): PRDItem[] {
  return items;
}

/**
 * Extracts just the titles from a list of PRD items.
 */
export function epicTitles(items: PRDItem[]): string[] {
  return items.filter((i) => i.level === "epic").map((i) => i.title);
}

/**
 * Extracts just the titles from a list of feature items.
 */
export function featureTitles(items: PRDItem[]): string[] {
  return items.filter((i) => i.level === "feature").map((i) => i.title);
}

/**
 * Extracts just the titles from a list of task items.
 */
export function taskTitles(items: PRDItem[]): string[] {
  return items.filter((i) => i.level === "task").map((i) => i.title);
}

/**
 * Flattens a tree structure to a flat list of items.
 */
export function flatten(items: PRDItem[]): PRDItem[] {
  const result: PRDItem[] = [];
  const stack = [...items];
  while (stack.length > 0) {
    const item = stack.pop()!;
    result.push(item);
    if (item.children) {
      stack.push(...item.children);
    }
  }
  return result;
}

/**
 * Finds an item by ID in a flat or nested tree.
 */
export function findById(items: PRDItem[], id: string): PRDItem | undefined {
  return flatten(items).find((i) => i.id === id);
}

/**
 * Extracts item IDs from a list.
 */
export function extractId(items: PRDItem[]): string[] {
  return items.map((i) => i.id);
}

/**
 * Gets an item by index (helper for quick access).
 */
export function get(items: PRDItem[], index: number): PRDItem {
  return items[index];
}

/**
 * Gets a full tree structure for testing.
 */
export function fullTree(): PRDItem[] {
  return makeTree();
}
