import { describe, it, expect } from "vitest";
import {
  stripHashSuffix,
  detectHashSuffixDuplicates,
  detectHashSuffixDuplicatesInTree,
  detectConsolidationGroups,
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

// ── detectConsolidationGroups ─────────────────────────────────────────────────

describe("detectConsolidationGroups", () => {
  // ── no-match cases ──────────────────────────────────────────────────────────

  it("returns empty array for fewer than 2 children", () => {
    const children = [makeTask("1", "Fix bug (a3f2)")];
    expect(detectConsolidationGroups(children)).toHaveLength(0);
  });

  it("returns empty array when all titles are genuinely different", () => {
    const children = [
      makeTask("1", "Implement auth"),
      makeTask("2", "Refactor DB"),
      makeTask("3", "Fix logging"),
    ];
    expect(detectConsolidationGroups(children)).toHaveLength(0);
  });

  it("skips singletons — one base title with no suffixed sibling", () => {
    // Only one item normalizes to "fix bug" — not enough for a group
    const children = [
      makeTask("1", "Fix bug (a3f2)"),
      makeTask("2", "Fix database (b91c)"),
    ];
    expect(detectConsolidationGroups(children)).toHaveLength(0);
  });

  it("skips groups where no member has a hash-token suffix (exact duplicates)", () => {
    // Both items share the same literal title with no suffix
    const children = [
      makeTask("1", "Fix bug"),
      makeTask("2", "Fix bug"),
    ];
    expect(detectConsolidationGroups(children)).toHaveLength(0);
  });

  it("skips groups where the distinguishing suffix is a user-authored word (non-hex)", () => {
    // "(beta)" contains 't' which is not a hex character
    const children = [
      makeTask("1", "Fix bug"),
      makeTask("2", "Fix bug (beta)"),
    ];
    expect(detectConsolidationGroups(children)).toHaveLength(0);
  });

  it("skips groups where dash suffix contains non-hex letters", () => {
    // "endpoint" contains non-hex chars → not a hash token
    const children = [
      makeTask("1", "Fix API - endpoint"),
      makeTask("2", "Fix API - handler"),
    ];
    expect(detectConsolidationGroups(children)).toHaveLength(0);
  });

  // ── pure hash siblings ──────────────────────────────────────────────────────

  it("groups two siblings differing only by parenthesized short hex token", () => {
    const children = [
      makeTask("1", "Fix observation in global (a3f2)"),
      makeTask("2", "Fix observation in global (b91c)"),
    ];
    const groups = detectConsolidationGroups(children);
    expect(groups).toHaveLength(1);
    expect(groups[0].baseTitle).toBe("Fix observation in global");
    expect(groups[0].members).toHaveLength(2);
    expect(groups[0].members.map((m) => m.id).sort()).toEqual(["1", "2"]);
  });

  it("groups two siblings differing only by dash-hex suffix", () => {
    const children = [
      makeTask("1", "Fix observation in global - a1b2c3"),
      makeTask("2", "Fix observation in global - d4e5f6"),
    ];
    const groups = detectConsolidationGroups(children);
    expect(groups).toHaveLength(1);
    expect(groups[0].baseTitle).toBe("Fix observation in global");
  });

  it("groups two siblings differing by bracketed UUID", () => {
    const children = [
      makeTask("1", "Fix auth (550e8400-e29b-41d4-a716-446655440000)"),
      makeTask("2", "Fix auth (660f9500-f3ac-52e5-b827-557766551111)"),
    ];
    const groups = detectConsolidationGroups(children);
    expect(groups).toHaveLength(1);
    expect(groups[0].baseTitle).toBe("Fix auth");
  });

  // ── three or more members ───────────────────────────────────────────────────

  it("groups three hash-suffixed siblings into one cluster", () => {
    const children = [
      makeTask("1", "Fix observation in global"),
      makeTask("2", "Fix observation in global (a3f2)"),
      makeTask("3", "Fix observation in global (b91c)"),
    ];
    const groups = detectConsolidationGroups(children);
    expect(groups).toHaveLength(1);
    expect(groups[0].baseTitle).toBe("Fix observation in global");
    expect(groups[0].members).toHaveLength(3);
    expect(groups[0].members.map((m) => m.id).sort()).toEqual(["1", "2", "3"]);
  });

  it("groups four hash-suffixed siblings", () => {
    const children = [
      makeTask("1", "Update schema (a1b2c3)"),
      makeTask("2", "Update schema (d4e5f6)"),
      makeTask("3", "Update schema (7890ab)"),
      makeTask("4", "Update schema (cdef01)"),
    ];
    const groups = detectConsolidationGroups(children);
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(4);
  });

  // ── mixed hash + non-hash siblings ─────────────────────────────────────────

  it("groups canonical (no-suffix) item with hash-suffixed siblings", () => {
    // "Fix bug" is the canonical form; siblings have hash suffixes
    const children = [
      makeTask("1", "Fix bug"),
      makeTask("2", "Fix bug (a3f2)"),
      makeTask("3", "Fix bug (b91c)"),
    ];
    const groups = detectConsolidationGroups(children);
    expect(groups).toHaveLength(1);
    // Canonical member supplies the base title
    expect(groups[0].baseTitle).toBe("Fix bug");
    expect(groups[0].members).toHaveLength(3);
  });

  it("groups only the hash-suffix cluster when other siblings have distinct titles", () => {
    const children = [
      makeTask("1", "Fix bug (a3f2)"),
      makeTask("2", "Fix bug (b91c)"),
      makeTask("3", "Refactor DB"),   // unrelated — stays out of any group
    ];
    const groups = detectConsolidationGroups(children);
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(2);
    expect(groups[0].members.map((m) => m.id).sort()).toEqual(["1", "2"]);
  });

  it("produces separate groups for two independent hash-suffix clusters", () => {
    const children = [
      makeTask("1", "Fix bug (a3f2)"),
      makeTask("2", "Fix bug (b91c)"),
      makeTask("3", "Update schema (1a2b3c)"),
      makeTask("4", "Update schema (4d5e6f)"),
    ];
    const groups = detectConsolidationGroups(children);
    expect(groups).toHaveLength(2);
    const baseTitles = groups.map((g) => g.baseTitle).sort();
    expect(baseTitles).toEqual(["Fix bug", "Update schema"]);
  });

  // ── body / description propagation ─────────────────────────────────────────

  it("includes description in members when present", () => {
    const children: PRDItem[] = [
      { id: "1", title: "Fix bug (a3f2)", level: "task", status: "pending", description: "Desc A" },
      { id: "2", title: "Fix bug (b91c)", level: "task", status: "pending", description: "Desc B" },
    ];
    const groups = detectConsolidationGroups(children);
    expect(groups).toHaveLength(1);
    const memberById = Object.fromEntries(groups[0].members.map((m) => [m.id, m]));
    expect(memberById["1"].description).toBe("Desc A");
    expect(memberById["2"].description).toBe("Desc B");
  });

  it("includes acceptanceCriteria in members when present", () => {
    const children: PRDItem[] = [
      {
        id: "1", title: "Fix bug (a3f2)", level: "task", status: "pending",
        acceptanceCriteria: ["AC1", "AC2"],
      },
      {
        id: "2", title: "Fix bug (b91c)", level: "task", status: "pending",
        acceptanceCriteria: ["AC3"],
      },
    ];
    const groups = detectConsolidationGroups(children);
    expect(groups).toHaveLength(1);
    const memberById = Object.fromEntries(groups[0].members.map((m) => [m.id, m]));
    expect(memberById["1"].acceptanceCriteria).toEqual(["AC1", "AC2"]);
    expect(memberById["2"].acceptanceCriteria).toEqual(["AC3"]);
  });

  it("omits description and acceptanceCriteria keys when not present on the item", () => {
    const children: PRDItem[] = [
      { id: "1", title: "Fix bug (a3f2)", level: "task", status: "pending" },
      { id: "2", title: "Fix bug (b91c)", level: "task", status: "pending" },
    ];
    const groups = detectConsolidationGroups(children);
    const member = groups[0].members[0];
    expect(Object.prototype.hasOwnProperty.call(member, "description")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(member, "acceptanceCriteria")).toBe(false);
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
