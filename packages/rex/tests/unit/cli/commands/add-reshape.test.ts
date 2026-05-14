import { describe, it, expect } from "vitest";
import {
  stripHashSuffix,
  detectHashSuffixDuplicates,
  detectHashSuffixDuplicatesInTree,
  getContainerLevel,
} from "../../../../src/cli/commands/add-reshape.js";
import type { PRDItem } from "../../../../src/schema/index.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTask(
  id: string,
  title: string,
  opts: { children?: PRDItem[]; createdAt?: string; level?: PRDItem["level"] } = {},
): PRDItem {
  return {
    id,
    title,
    level: opts.level ?? "task",
    status: "pending",
    createdAt: opts.createdAt ?? "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...(opts.children ? { children: opts.children } : {}),
  };
}

// ── stripHashSuffix ───────────────────────────────────────────────────────────

describe("stripHashSuffix", () => {
  describe("parenthesized short identifier", () => {
    it("strips lowercase hex token in parentheses", () => {
      expect(stripHashSuffix("Fix bug (abc123)")).toBe("Fix bug");
    });

    it("strips uppercase alphanumeric token in parentheses", () => {
      expect(stripHashSuffix("Fix bug (ABC123)")).toBe("Fix bug");
    });

    it("strips hyphenated identifier in parentheses", () => {
      expect(stripHashSuffix("Fix bug (ABC-123)")).toBe("Fix bug");
    });

    it("strips token in square brackets", () => {
      expect(stripHashSuffix("Fix bug [abc123]")).toBe("Fix bug");
    });

    it("strips with leading/trailing spaces inside brackets", () => {
      expect(stripHashSuffix("Fix bug ( abc123 )")).toBe("Fix bug");
    });
  });

  describe("parenthesized UUID", () => {
    it("strips full UUID in parentheses", () => {
      expect(stripHashSuffix("Fix bug (550e8400-e29b-41d4-a716-446655440000)")).toBe("Fix bug");
    });

    it("strips full UUID in square brackets", () => {
      expect(stripHashSuffix("Fix bug [550e8400-e29b-41d4-a716-446655440000]")).toBe("Fix bug");
    });
  });

  describe("dash UUID tail", () => {
    it("strips UUID after dash separator", () => {
      expect(stripHashSuffix("Fix bug - 550e8400-e29b-41d4-a716-446655440000")).toBe("Fix bug");
    });

    it("strips UUID after dash with extra spaces", () => {
      expect(stripHashSuffix("Fix bug  -  550e8400-e29b-41d4-a716-446655440000")).toBe("Fix bug");
    });
  });

  describe("dash short hex tail", () => {
    it("strips 6-char hex hash after dash", () => {
      expect(stripHashSuffix("Fix bug - a1b2c3")).toBe("Fix bug");
    });

    it("strips 8-char hex hash after dash", () => {
      expect(stripHashSuffix("Fix auth - 7f3c9e2f")).toBe("Fix auth");
    });

    it("strips 12-char hex hash after dash", () => {
      expect(stripHashSuffix("Title - deadbeefcafe")).toBe("Title");
    });
  });

  describe("no-op cases", () => {
    it("returns title unchanged when no suffix", () => {
      expect(stripHashSuffix("Implement authentication")).toBe("Implement authentication");
    });

    it("does not strip a non-hash word after dash", () => {
      // "endpoint" contains 'n', 'p', 't' which are outside a-f hex range
      expect(stripHashSuffix("Fix API - endpoint")).toBe("Fix API - endpoint");
    });

    it("does not strip dash-word where word is too short (< 6 hex chars)", () => {
      // "cafe" is only 4 chars — below the 6-char minimum for dash tails
      expect(stripHashSuffix("Fix API - cafe")).toBe("Fix API - cafe");
    });

    it("does not strip when parenthesized token is too short (< 3 chars)", () => {
      expect(stripHashSuffix("Fix bug (ab)")).toBe("Fix bug (ab)");
    });

    it("does not strip when parenthesized token is too long (> 12 chars)", () => {
      // 13 non-UUID chars in parens — not a short ID, not a UUID
      expect(stripHashSuffix("Fix bug (abcdefghijklm)")).toBe("Fix bug (abcdefghijklm)");
    });
  });
});

// ── detectHashSuffixDuplicates (per-cohort) ───────────────────────────────────

describe("detectHashSuffixDuplicates", () => {
  it("returns empty for fewer than 2 siblings", () => {
    const result = detectHashSuffixDuplicates([makeTask("1", "Fix bug (abc)")], "1");
    expect(result).toHaveLength(0);
  });

  it("groups two items that differ only by hash suffix — emits merge", () => {
    const siblings = [
      makeTask("1", "Fix observation in global (abc123)"),
      makeTask("2", "Fix observation in global (def456)"),
    ];
    const proposals = detectHashSuffixDuplicates(siblings, "2");
    expect(proposals).toHaveLength(1);
    expect(proposals[0].action.action).toBe("merge");
    if (proposals[0].action.action === "merge") {
      expect(proposals[0].action.reason).toBe("hash-suffix-duplicate-sibling");
    }
  });

  it("does not group items with genuinely different titles", () => {
    const siblings = [
      makeTask("1", "Fix authentication bug"),
      makeTask("2", "Refactor database schema"),
    ];
    expect(detectHashSuffixDuplicates(siblings, "2")).toHaveLength(0);
  });

  it("does not group items where only one has a suffix (different base)", () => {
    const siblings = [
      makeTask("1", "Fix auth (abc123)"),
      makeTask("2", "Fix database (abc123)"),
    ];
    // Stripped: "fix auth" vs "fix database" — different base titles
    expect(detectHashSuffixDuplicates(siblings, "2")).toHaveLength(0);
  });

  it("prefers item with no suffix as survivor", () => {
    const siblings = [
      makeTask("1", "Fix bug (abc123)"),
      makeTask("2", "Fix bug"),
    ];
    const proposals = detectHashSuffixDuplicates(siblings, "1");
    expect(proposals).toHaveLength(1);
    if (proposals[0].action.action === "merge") {
      expect(proposals[0].action.survivorId).toBe("2");
      expect(proposals[0].action.mergedIds).toContain("1");
    }
  });

  it("uses group strategy when all members have children and level allows container", () => {
    const child1 = makeTask("c1", "Child 1");
    const child2 = makeTask("c2", "Child 2");
    const siblings: PRDItem[] = [
      makeTask("1", "Fix bug (abc123)", { children: [child1], level: "feature" }),
      makeTask("2", "Fix bug (def456)", { children: [child2], level: "feature" }),
    ];
    const proposals = detectHashSuffixDuplicates(siblings, "2");
    expect(proposals).toHaveLength(1);
    expect(proposals[0].action.action).toBe("group");
  });

  it("uses merge strategy when not all members have children", () => {
    const siblings = [
      makeTask("1", "Fix bug (abc123)", { children: [makeTask("c1", "Child")] }),
      makeTask("2", "Fix bug (def456)"), // no children
    ];
    const proposals = detectHashSuffixDuplicates(siblings, "2");
    expect(proposals).toHaveLength(1);
    expect(proposals[0].action.action).toBe("merge");
  });
});

// ── detectHashSuffixDuplicatesInTree ─────────────────────────────────────────

describe("detectHashSuffixDuplicatesInTree", () => {
  it("returns empty array for an empty tree", () => {
    expect(detectHashSuffixDuplicatesInTree([])).toHaveLength(0);
  });

  it("returns empty array when no hash-suffix duplicates exist", () => {
    const items = [
      makeTask("1", "Implement authentication"),
      makeTask("2", "Fix database migration"),
      makeTask("3", "Refactor API layer"),
    ];
    expect(detectHashSuffixDuplicatesInTree(items)).toHaveLength(0);
  });

  it("detects root-level hash-suffix duplicates", () => {
    const items = [
      makeTask("1", "Fix observation (abc123)"),
      makeTask("2", "Fix observation (def456)"),
    ];
    const groups = detectHashSuffixDuplicatesInTree(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].normalizedTitle).toBe("fix observation");
    expect(groups[0].parentId).toBeUndefined();
    expect(groups[0].parentTitle).toBeUndefined();
    expect(groups[0].members).toHaveLength(2);
    expect(groups[0].members.map((m) => m.id).sort()).toEqual(["1", "2"]);
  });

  it("includes child counts in member entries", () => {
    const items = [
      makeTask("1", "Fix observation (abc123)", { children: [makeTask("c1", "Sub"), makeTask("c2", "Sub2")] }),
      makeTask("2", "Fix observation (def456)", { children: [makeTask("c3", "Sub3")] }),
    ];
    const groups = detectHashSuffixDuplicatesInTree(items);
    expect(groups).toHaveLength(1);
    const memberById = Object.fromEntries(groups[0].members.map((m) => [m.id, m]));
    expect(memberById["1"].childCount).toBe(2);
    expect(memberById["2"].childCount).toBe(1);
  });

  it("includes parent context for nested items", () => {
    const parent: PRDItem = {
      id: "epic1",
      title: "Auth Epic",
      level: "epic",
      status: "pending",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      children: [
        makeTask("1", "Fix bug (abc123)"),
        makeTask("2", "Fix bug (def456)"),
      ],
    };
    const groups = detectHashSuffixDuplicatesInTree([parent]);
    expect(groups).toHaveLength(1);
    expect(groups[0].parentId).toBe("epic1");
    expect(groups[0].parentTitle).toBe("Auth Epic");
  });

  it("does not group items from different parent cohorts", () => {
    const parent1: PRDItem = {
      id: "epic1",
      title: "Epic 1",
      level: "epic",
      status: "pending",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      children: [makeTask("t1", "Fix bug (abc123)")],
    };
    const parent2: PRDItem = {
      id: "epic2",
      title: "Epic 2",
      level: "epic",
      status: "pending",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      children: [makeTask("t2", "Fix bug (def456)")],
    };
    // Same stripped title, but under different parents — must NOT be grouped
    const groups = detectHashSuffixDuplicatesInTree([parent1, parent2]);
    expect(groups).toHaveLength(0);
  });

  it("includes pre-computed proposals in each group", () => {
    const items = [
      makeTask("1", "Fix observation (abc123)"),
      makeTask("2", "Fix observation (def456)"),
    ];
    const groups = detectHashSuffixDuplicatesInTree(items);
    expect(groups[0].proposals.length).toBeGreaterThan(0);
    const flatProposals = groups.flatMap((g) => g.proposals);
    expect(flatProposals).toHaveLength(groups[0].proposals.length);
    expect(flatProposals[0].action.action).toMatch(/merge|group/);
  });

  it("detects dash-style hash suffix duplicates", () => {
    const items = [
      makeTask("1", "Fix observation in global - a1b2c3"),
      makeTask("2", "Fix observation in global - d4e5f6"),
    ];
    const groups = detectHashSuffixDuplicatesInTree(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].normalizedTitle).toBe("fix observation in global");
  });

  it("detects UUID-suffix duplicates", () => {
    const items = [
      makeTask("1", "Fix observation (550e8400-e29b-41d4-a716-446655440000)"),
      makeTask("2", "Fix observation (660f9500-f3ac-52e5-b827-557766551111)"),
    ];
    const groups = detectHashSuffixDuplicatesInTree(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].normalizedTitle).toBe("fix observation");
  });

  it("does not group items with different base titles regardless of suffix", () => {
    const items = [
      makeTask("1", "Fix authentication (abc123)"),
      makeTask("2", "Fix authorization (def456)"),
    ];
    expect(detectHashSuffixDuplicatesInTree(items)).toHaveLength(0);
  });
});

// ── getContainerLevel ─────────────────────────────────────────────────────────

describe("getContainerLevel", () => {
  it("returns feature for task level", () => {
    expect(getContainerLevel("task")).toBe("feature");
  });

  it("returns epic for feature level", () => {
    expect(getContainerLevel("feature")).toBe("epic");
  });

  it("returns task for subtask level", () => {
    expect(getContainerLevel("subtask")).toBe("task");
  });

  it("returns null for epic level (no container above epic)", () => {
    expect(getContainerLevel("epic")).toBeNull();
  });
});
