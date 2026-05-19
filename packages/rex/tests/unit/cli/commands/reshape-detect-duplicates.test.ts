import { describe, it, expect } from "vitest";
import { detectCrossPRDDuplicates } from "../../../../src/cli/commands/reshape-detect-duplicates.js";
import type { PRDItem } from "../../../../src/schema/index.js";
import type { ItemFileMap } from "../../../../src/cli/commands/smart-add-duplicates.js";

// Helper to create a test item
function createItem(
  id: string,
  title: string,
  level: "epic" | "feature" | "task" = "task",
  parentId?: string,
  description?: string,
  acceptanceCriteria?: string[],
): PRDItem {
  const item: PRDItem = {
    id,
    title,
    level,
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (parentId) {
    item.parent = parentId;
  }

  if (description) {
    item.description = description;
  }

  if (acceptanceCriteria && acceptanceCriteria.length > 0) {
    item.acceptanceCriteria = acceptanceCriteria;
  }

  return item;
}

// Helper to build an items tree
function buildTree(items: PRDItem[]): PRDItem[] {
  // Build parent-child relationships
  const itemMap = new Map(items.map((item) => [item.id, item]));

  for (const item of items) {
    if (item.parent) {
      const parent = itemMap.get(item.parent);
      if (parent) {
        if (!parent.children) {
          parent.children = [];
        }
        parent.children.push(item);
      }
    }
  }

  // Return only root items (no parent)
  return items.filter((item) => !item.parent);
}

// Helper to create a mock file map
function createFileMap(entries: Record<string, string>): ItemFileMap {
  return new Map(Object.entries(entries));
}

describe("detectCrossPRDDuplicates", () => {
  describe("no duplicates", () => {
    it("returns empty array when items have different titles", () => {
      const items: PRDItem[] = [
        createItem("1", "Implement user authentication"),
        createItem("2", "Fix database migration script"),
        createItem("3", "Refactor API error handling"),
      ];
      const fileMap = createFileMap({
        "1": "prd.json",
        "2": "prd.json",
        "3": "prd.json",
      });

      const proposals = detectCrossPRDDuplicates(items, fileMap);

      expect(proposals).toHaveLength(0);
    });

    it("returns empty array when no items exist", () => {
      const fileMap = createFileMap({});
      const proposals = detectCrossPRDDuplicates([], fileMap);
      expect(proposals).toHaveLength(0);
    });

    it("returns empty array when only one item exists", () => {
      const items = [createItem("1", "Task A")];
      const fileMap = createFileMap({ "1": "prd.json" });
      const proposals = detectCrossPRDDuplicates(items, fileMap);
      expect(proposals).toHaveLength(0);
    });
  });

  describe("exact title match", () => {
    it("detects exact title match among siblings", () => {
      const items: PRDItem[] = [
        createItem("1", "Implement Auth"),
        createItem("2", "Implement Auth"),
      ];
      const fileMap = createFileMap({
        "1": "prd_main_2024-01-10.json",
        "2": "prd_feature_2024-01-20.json",
      });

      const proposals = detectCrossPRDDuplicates(items, fileMap);

      expect(proposals).toHaveLength(1);
      expect(proposals[0].action.action).toBe("merge");
      expect(proposals[0].action.survivorId).toBe("2"); // newer file wins
      expect(proposals[0].action.mergedIds).toEqual(["1"]); // older item merged in
    });
  });

  describe("semantic match", () => {
    it("detects semantic duplicates (high similarity with whitespace/case variants)", () => {
      const items: PRDItem[] = [
        createItem("1", "Implement  Authentication"),
        createItem("2", "implement authentication"),
      ];
      const fileMap = createFileMap({
        "1": "prd_main_2024-01-10.json",
        "2": "prd_feature_2024-01-20.json", // newer
      });

      const proposals = detectCrossPRDDuplicates(items, fileMap);

      expect(proposals).toHaveLength(1);
      expect(proposals[0].action.survivorId).toBe("2"); // newer item survives
      expect(proposals[0].action.mergedIds).toEqual(["1"]); // older item merged in
    });

    it("skips non-duplicates (low similarity)", () => {
      const items: PRDItem[] = [
        createItem("1", "Implement user authentication"),
        createItem("2", "Fix database migration issue"),
      ];
      const fileMap = createFileMap({
        "1": "prd_main_2024-01-10.json",
        "2": "prd_main_2024-01-20.json",
      });

      const proposals = detectCrossPRDDuplicates(items, fileMap);

      expect(proposals).toHaveLength(0);
    });
  });

  describe("description-driven similarity", () => {
    it("detects duplicates with different titles but similar descriptions", () => {
      const items: PRDItem[] = [
        createItem(
          "1",
          "Auth feature",
          "task",
          undefined,
          "Implement JWT-based authentication with refresh token support",
        ),
        createItem(
          "2",
          "Security implementation",
          "task",
          undefined,
          "Add JWT authentication and refresh token support",
        ),
      ];
      const fileMap = createFileMap({
        "1": "prd_main_2024-01-10.json",
        "2": "prd_feature_2024-01-20.json",
      });

      const proposals = detectCrossPRDDuplicates(items, fileMap);

      expect(proposals.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("cross-parent no-merge", () => {
    it("does not merge items with same title but different parents", () => {
      const items: PRDItem[] = [
        createItem("epic1", "Backend", "epic"),
        createItem("epic2", "Frontend", "epic"),
        createItem("task1", "Implement Auth", "task", "epic1"),
        createItem("task2", "Implement Auth", "task", "epic2"),
      ];

      const tree = buildTree(items);

      const fileMap = createFileMap({
        epic1: "prd_main_2024-01-10.json",
        epic2: "prd_main_2024-01-10.json",
        task1: "prd_main_2024-01-10.json",
        task2: "prd_main_2024-01-20.json",
      });

      const proposals = detectCrossPRDDuplicates(tree, fileMap);

      // Should have 0 proposals because tasks have different parents
      expect(proposals).toHaveLength(0);
    });
  });

  describe("different levels skip", () => {
    it("does not merge items at different levels", () => {
      const items: PRDItem[] = [
        createItem("1", "Auth", "epic"),
        createItem("2", "Auth", "feature"),
      ];
      const fileMap = createFileMap({
        "1": "prd_main_2024-01-10.json",
        "2": "prd_main_2024-01-20.json",
      });

      const proposals = detectCrossPRDDuplicates(items, fileMap);

      expect(proposals).toHaveLength(0);
    });
  });

  describe("file age preference", () => {
    it("prefers newer file's item as survivor", () => {
      const items: PRDItem[] = [
        createItem("1", "Same Title"),
        createItem("2", "Same Title"),
      ];
      const fileMap = createFileMap({
        "1": "prd_main_2024-01-20.json", // newer
        "2": "prd_main_2024-01-10.json", // older
      });

      const proposals = detectCrossPRDDuplicates(items, fileMap);

      expect(proposals).toHaveLength(1);
      expect(proposals[0].action.survivorId).toBe("1"); // item from newer file survives
      expect(proposals[0].action.mergedIds).toEqual(["2"]); // older item merged into newer
    });

    it("treats non-legacy file as newer than legacy prd.json", () => {
      const items: PRDItem[] = [
        createItem("1", "Same Title"),
        createItem("2", "Same Title"),
      ];
      const fileMap = createFileMap({
        "1": "prd.json", // legacy, oldest
        "2": "prd_main_2024-01-10.json", // newer than legacy
      });

      const proposals = detectCrossPRDDuplicates(items, fileMap);

      expect(proposals).toHaveLength(1);
      expect(proposals[0].action.survivorId).toBe("2"); // newer file's item survives
      expect(proposals[0].action.mergedIds).toEqual(["1"]);
    });
  });

  describe("multiple duplicates in cohort", () => {
    it("merges 3+ similar items into newest item", () => {
      const items: PRDItem[] = [
        createItem("1", "Implement Auth"),
        createItem("2", "Implement Auth"),
        createItem("3", "Implement Auth"),
      ];
      const fileMap = createFileMap({
        "1": "prd_main_2024-01-10.json", // oldest
        "2": "prd_main_2024-01-15.json",
        "3": "prd_main_2024-01-20.json", // newest
      });

      const proposals = detectCrossPRDDuplicates(items, fileMap);

      // Should generate 2 merge proposals: items 1 and 2 merge into item 3 (newest)
      expect(proposals.length).toBeGreaterThanOrEqual(2);

      const survivorProposals = proposals.filter((p) => p.action.action === "merge");
      const survivorIds = survivorProposals.map((p) => {
        if (p.action.action === "merge") return p.action.survivorId;
        return null;
      });

      // Item 3 (newest) should be survivor in all merge proposals
      expect(survivorIds.every((id) => id === "3")).toBe(true);
    });
  });

  describe("threshold behavior", () => {
    it("does not merge items below similarity threshold (0.7)", () => {
      const items: PRDItem[] = [
        createItem("1", "Login functionality"),
        createItem("2", "Database schema redesign"),
      ];
      const fileMap = createFileMap({
        "1": "prd_main_2024-01-10.json",
        "2": "prd_main_2024-01-20.json",
      });

      const proposals = detectCrossPRDDuplicates(items, fileMap);

      expect(proposals).toHaveLength(0);
    });
  });

  describe("reason field", () => {
    it("sets correct reason for cross-PRD duplicate merges", () => {
      const items: PRDItem[] = [
        createItem("1", "Task"),
        createItem("2", "Task"),
      ];
      const fileMap = createFileMap({
        "1": "prd_main_2024-01-10.json",
        "2": "prd_main_2024-01-20.json",
      });

      const proposals = detectCrossPRDDuplicates(items, fileMap);

      expect(proposals).toHaveLength(1);
      expect(proposals[0].action.action).toBe("merge");
      if (proposals[0].action.action === "merge") {
        expect(proposals[0].action.reason).toBe("cross-prd-duplicate-sibling-merge");
      }
    });
  });

  describe("idempotent behavior", () => {
    it("running twice produces same proposals", () => {
      const items: PRDItem[] = [
        createItem("1", "Task"),
        createItem("2", "Task"),
      ];
      const fileMap = createFileMap({
        "1": "prd_main_2024-01-10.json",
        "2": "prd_main_2024-01-20.json",
      });

      const proposals1 = detectCrossPRDDuplicates(items, fileMap);
      const proposals2 = detectCrossPRDDuplicates(items, fileMap);

      expect(proposals1).toHaveLength(proposals2.length);
      expect(proposals1[0].id).toBe(proposals2[0].id);
      expect(proposals1[0].action.survivorId).toBe(proposals2[0].action.survivorId);
    });
  });

  describe("cluster handling", () => {
    it("handles 4+ item clusters correctly", () => {
      const items: PRDItem[] = [
        createItem("1", "Auth"),
        createItem("2", "Auth"),
        createItem("3", "Auth"),
        createItem("4", "Auth"),
      ];
      const fileMap = createFileMap({
        "1": "prd_main_2024-01-05.json", // oldest
        "2": "prd_main_2024-01-10.json",
        "3": "prd_main_2024-01-15.json",
        "4": "prd_main_2024-01-20.json", // newest
      });

      const proposals = detectCrossPRDDuplicates(items, fileMap);

      // Should generate 3 proposals: 1, 2, 3 all merge into 4 (newest)
      const mergeProposals = proposals.filter((p) => p.action.action === "merge");
      expect(mergeProposals.length).toBeGreaterThanOrEqual(1);

      // All should merge into item 4 (newest)
      for (const proposal of mergeProposals) {
        if (proposal.action.action === "merge") {
          expect(proposal.action.survivorId).toBe("4");
        }
      }
    });
  });

  describe("mixed similarity levels", () => {
    it("merges only high-similarity pairs within cohort", () => {
      const items: PRDItem[] = [
        createItem("1", "Implement Auth"),
        createItem("2", "Implement Auth"), // high similarity to 1
        createItem("3", "Fix database bug"), // low similarity to 1 and 2
      ];
      const fileMap = createFileMap({
        "1": "prd_main_2024-01-10.json",
        "2": "prd_main_2024-01-15.json", // newer than 1
        "3": "prd_main_2024-01-20.json", // low similarity, not merged
      });

      const proposals = detectCrossPRDDuplicates(items, fileMap);

      expect(proposals.length).toBeGreaterThanOrEqual(1);

      const mergeProposals = proposals.filter((p) => p.action.action === "merge");
      for (const proposal of mergeProposals) {
        if (proposal.action.action === "merge") {
          // Should merge 1 into 2 (newer wins), not involve 3
          expect(proposal.action.survivorId).toBe("2");
          expect(proposal.action.mergedIds).toEqual(["1"]);
        }
      }
    });
  });
});
