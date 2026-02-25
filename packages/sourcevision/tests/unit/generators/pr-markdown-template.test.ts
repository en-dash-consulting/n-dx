import { describe, it, expect } from "vitest";

import {
  renderPRMarkdownFromRecord,
  groupItemsByEpic,
  extractBreakingChanges,
  extractMajorChanges,
  extractMinorChanges,
  sortItemsBySignificance,
  renderEpicSection,
  renderBreakingChangesSection,
  renderMajorChangesSection,
  renderSummarySection,
} from "../../../src/generators/pr-markdown-template.js";
import type {
  BranchWorkRecord,
  BranchWorkRecordItem,
  BranchWorkEpicSummary,
} from "../../../src/schema/v1.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<BranchWorkRecordItem> = {}): BranchWorkRecordItem {
  return {
    id: overrides.id ?? "task-1",
    title: overrides.title ?? "Test task",
    level: overrides.level ?? "task",
    completedAt: overrides.completedAt ?? "2026-02-24T10:00:00.000Z",
    parentChain: overrides.parentChain ?? [],
    ...overrides,
  };
}

function makeRecord(overrides: Partial<BranchWorkRecord> = {}): BranchWorkRecord {
  return {
    schemaVersion: "1.0.0",
    branch: overrides.branch ?? "feature/test-branch",
    baseBranch: overrides.baseBranch ?? "main",
    createdAt: overrides.createdAt ?? "2026-02-24T12:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-02-24T12:00:00.000Z",
    items: overrides.items ?? [makeItem()],
    epicSummaries: overrides.epicSummaries ?? [],
    metadata: overrides.metadata ?? {},
  };
}

// ---------------------------------------------------------------------------
// groupItemsByEpic
// ---------------------------------------------------------------------------

describe("groupItemsByEpic", () => {
  it("groups items under their root epic ancestor", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({
        id: "task-1",
        title: "Auth login",
        parentChain: [
          { id: "epic-1", title: "Authentication", level: "epic" },
          { id: "feat-1", title: "Login Flow", level: "feature" },
        ],
      }),
      makeItem({
        id: "task-2",
        title: "Auth signup",
        parentChain: [
          { id: "epic-1", title: "Authentication", level: "epic" },
          { id: "feat-2", title: "Signup Flow", level: "feature" },
        ],
      }),
    ];

    const grouped = groupItemsByEpic(items);
    expect(grouped.size).toBe(1);
    expect(grouped.get("Authentication")).toHaveLength(2);
  });

  it("puts items without epic parent under '(Ungrouped)' key", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({ id: "task-1", title: "Orphan task", parentChain: [] }),
    ];

    const grouped = groupItemsByEpic(items);
    expect(grouped.has("(Ungrouped)")).toBe(true);
    expect(grouped.get("(Ungrouped)")).toHaveLength(1);
  });

  it("groups multiple epics separately", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({
        id: "task-1",
        title: "Auth task",
        parentChain: [{ id: "epic-1", title: "Auth", level: "epic" }],
      }),
      makeItem({
        id: "task-2",
        title: "UI task",
        parentChain: [{ id: "epic-2", title: "UI Polish", level: "epic" }],
      }),
    ];

    const grouped = groupItemsByEpic(items);
    expect(grouped.size).toBe(2);
    expect(grouped.has("Auth")).toBe(true);
    expect(grouped.has("UI Polish")).toBe(true);
  });

  it("returns empty map for empty items array", () => {
    const grouped = groupItemsByEpic([]);
    expect(grouped.size).toBe(0);
  });

  it("uses feature title when no epic in chain", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({
        id: "task-1",
        title: "Some task",
        parentChain: [{ id: "feat-1", title: "Feature X", level: "feature" }],
      }),
    ];

    const grouped = groupItemsByEpic(items);
    expect(grouped.has("(Ungrouped)")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// extractBreakingChanges
// ---------------------------------------------------------------------------

describe("extractBreakingChanges", () => {
  it("returns only items with breakingChange=true", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({ id: "t1", title: "Breaking task", breakingChange: true }),
      makeItem({ id: "t2", title: "Normal task", breakingChange: false }),
      makeItem({ id: "t3", title: "No flag task" }),
    ];

    const breaking = extractBreakingChanges(items);
    expect(breaking).toHaveLength(1);
    expect(breaking[0].id).toBe("t1");
  });

  it("returns empty array when no breaking changes exist", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({ id: "t1", title: "Normal task" }),
    ];

    const breaking = extractBreakingChanges(items);
    expect(breaking).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// extractMajorChanges
// ---------------------------------------------------------------------------

describe("extractMajorChanges", () => {
  it("returns only items with changeSignificance=major", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({ id: "t1", title: "Major change", changeSignificance: "major" }),
      makeItem({ id: "t2", title: "Minor change", changeSignificance: "minor" }),
      makeItem({ id: "t3", title: "Patch change", changeSignificance: "patch" }),
      makeItem({ id: "t4", title: "No significance" }),
    ];

    const major = extractMajorChanges(items);
    expect(major).toHaveLength(1);
    expect(major[0].id).toBe("t1");
  });

  it("returns empty array when no major changes exist", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({ id: "t1", changeSignificance: "minor" }),
    ];

    const major = extractMajorChanges(items);
    expect(major).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// extractMinorChanges
// ---------------------------------------------------------------------------

describe("extractMinorChanges", () => {
  it("returns only items with changeSignificance=minor", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({ id: "t1", title: "Major change", changeSignificance: "major" }),
      makeItem({ id: "t2", title: "Minor change", changeSignificance: "minor" }),
      makeItem({ id: "t3", title: "Patch change", changeSignificance: "patch" }),
      makeItem({ id: "t4", title: "No significance" }),
    ];

    const minor = extractMinorChanges(items);
    expect(minor).toHaveLength(1);
    expect(minor[0].id).toBe("t2");
  });

  it("returns empty array when no minor changes exist", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({ id: "t1", changeSignificance: "major" }),
      makeItem({ id: "t2", changeSignificance: "patch" }),
    ];

    const minor = extractMinorChanges(items);
    expect(minor).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// sortItemsBySignificance
// ---------------------------------------------------------------------------

describe("sortItemsBySignificance", () => {
  it("sorts major before minor before patch", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({ id: "t1", title: "Patch", changeSignificance: "patch" }),
      makeItem({ id: "t2", title: "Major", changeSignificance: "major" }),
      makeItem({ id: "t3", title: "Minor", changeSignificance: "minor" }),
    ];

    const sorted = sortItemsBySignificance(items);
    expect(sorted[0].id).toBe("t2"); // major
    expect(sorted[1].id).toBe("t3"); // minor
    expect(sorted[2].id).toBe("t1"); // patch
  });

  it("treats undefined significance as patch", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({ id: "t1", title: "No significance" }),
      makeItem({ id: "t2", title: "Minor", changeSignificance: "minor" }),
    ];

    const sorted = sortItemsBySignificance(items);
    expect(sorted[0].id).toBe("t2"); // minor first
    expect(sorted[1].id).toBe("t1"); // undefined = patch last
  });

  it("preserves relative order within same significance", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({ id: "t1", title: "First patch", changeSignificance: "patch" }),
      makeItem({ id: "t2", title: "Second patch", changeSignificance: "patch" }),
      makeItem({ id: "t3", title: "Third patch", changeSignificance: "patch" }),
    ];

    const sorted = sortItemsBySignificance(items);
    expect(sorted[0].id).toBe("t1");
    expect(sorted[1].id).toBe("t2");
    expect(sorted[2].id).toBe("t3");
  });

  it("returns empty array for empty input", () => {
    const sorted = sortItemsBySignificance([]);
    expect(sorted).toHaveLength(0);
  });

  it("does not mutate the original array", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({ id: "t1", changeSignificance: "patch" }),
      makeItem({ id: "t2", changeSignificance: "major" }),
    ];

    const sorted = sortItemsBySignificance(items);
    expect(items[0].id).toBe("t1"); // original unchanged
    expect(sorted[0].id).toBe("t2"); // sorted copy
  });
});

// ---------------------------------------------------------------------------
// renderSummarySection
// ---------------------------------------------------------------------------

describe("renderSummarySection", () => {
  it("includes branch name and item count", () => {
    const record = makeRecord({
      branch: "feature/auth-system",
      items: [makeItem(), makeItem({ id: "t2" })],
    });

    const section = renderSummarySection(record);
    expect(section).toContain("feature/auth-system");
    expect(section).toContain("2");
  });

  it("includes epic summary counts when available", () => {
    const record = makeRecord({
      epicSummaries: [
        { id: "epic-1", title: "Auth", completedCount: 5 },
        { id: "epic-2", title: "UI", completedCount: 3 },
      ],
    });

    const section = renderSummarySection(record);
    expect(section).toContain("Auth");
    expect(section).toContain("UI");
  });

  it("handles empty record gracefully", () => {
    const record = makeRecord({ items: [], epicSummaries: [] });
    const section = renderSummarySection(record);
    expect(section).toContain("0");
  });
});

// ---------------------------------------------------------------------------
// renderEpicSection
// ---------------------------------------------------------------------------

describe("renderEpicSection", () => {
  it("renders epic heading with items grouped by feature", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({
        id: "task-1",
        title: "Login form",
        level: "task",
        parentChain: [
          { id: "epic-1", title: "Auth", level: "epic" },
          { id: "feat-1", title: "Login Flow", level: "feature" },
        ],
      }),
      makeItem({
        id: "task-2",
        title: "Signup form",
        level: "task",
        parentChain: [
          { id: "epic-1", title: "Auth", level: "epic" },
          { id: "feat-2", title: "Signup Flow", level: "feature" },
        ],
      }),
    ];

    const section = renderEpicSection("Auth", items);
    expect(section).toContain("### Auth");
    expect(section).toContain("Login Flow");
    expect(section).toContain("Login form");
    expect(section).toContain("Signup Flow");
    expect(section).toContain("Signup form");
  });

  it("renders items without feature parent in '(Other)' group", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({
        id: "task-1",
        title: "Standalone task",
        level: "task",
        parentChain: [{ id: "epic-1", title: "Infra", level: "epic" }],
      }),
    ];

    const section = renderEpicSection("Infra", items);
    expect(section).toContain("### Infra");
    expect(section).toContain("Standalone task");
  });

  it("shows level for non-task items", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({
        id: "feat-1",
        title: "Completed feature",
        level: "feature",
        parentChain: [{ id: "epic-1", title: "Auth", level: "epic" }],
      }),
    ];

    const section = renderEpicSection("Auth", items);
    expect(section).toContain("feature");
    expect(section).toContain("Completed feature");
  });

  it("sorts items within feature groups by significance", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({
        id: "t1",
        title: "Patch task",
        changeSignificance: "patch",
        parentChain: [
          { id: "e1", title: "Epic", level: "epic" },
          { id: "f1", title: "Feature", level: "feature" },
        ],
      }),
      makeItem({
        id: "t2",
        title: "Major task",
        changeSignificance: "major",
        parentChain: [
          { id: "e1", title: "Epic", level: "epic" },
          { id: "f1", title: "Feature", level: "feature" },
        ],
      }),
      makeItem({
        id: "t3",
        title: "Minor task",
        changeSignificance: "minor",
        parentChain: [
          { id: "e1", title: "Epic", level: "epic" },
          { id: "f1", title: "Feature", level: "feature" },
        ],
      }),
    ];

    const section = renderEpicSection("Epic", items);
    const majorIdx = section.indexOf("Major task");
    const minorIdx = section.indexOf("Minor task");
    const patchIdx = section.indexOf("Patch task");
    expect(majorIdx).toBeLessThan(minorIdx);
    expect(minorIdx).toBeLessThan(patchIdx);
  });

  it("renders ⚠️ indicator for breaking items", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({
        id: "t1",
        title: "Breaking change",
        breakingChange: true,
        changeSignificance: "major",
        parentChain: [{ id: "e1", title: "Epic", level: "epic" }],
      }),
    ];

    const section = renderEpicSection("Epic", items);
    expect(section).toContain("⚠️");
    expect(section).toContain("**Breaking change**");
  });

  it("renders 🔶 indicator for non-breaking major items", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({
        id: "t1",
        title: "Major change",
        changeSignificance: "major",
        parentChain: [{ id: "e1", title: "Epic", level: "epic" }],
      }),
    ];

    const section = renderEpicSection("Epic", items);
    expect(section).toContain("🔶");
    expect(section).toContain("**Major change**");
  });

  it("includes description for significant items", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({
        id: "t1",
        title: "Important task",
        changeSignificance: "minor",
        description: "This rewrites the validation layer",
        parentChain: [{ id: "e1", title: "Epic", level: "epic" }],
      }),
    ];

    const section = renderEpicSection("Epic", items);
    expect(section).toContain("This rewrites the validation layer");
  });

  it("includes acceptance criteria for significant items", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({
        id: "t1",
        title: "API change",
        changeSignificance: "major",
        acceptanceCriteria: ["New endpoint returns 200", "Old endpoint deprecated"],
        parentChain: [{ id: "e1", title: "Epic", level: "epic" }],
      }),
    ];

    const section = renderEpicSection("Epic", items);
    expect(section).toContain("New endpoint returns 200");
    expect(section).toContain("Old endpoint deprecated");
  });

  it("does not include description for patch items", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({
        id: "t1",
        title: "Minor fix",
        changeSignificance: "patch",
        description: "Fixes a tiny typo",
        parentChain: [{ id: "e1", title: "Epic", level: "epic" }],
      }),
    ];

    const section = renderEpicSection("Epic", items);
    expect(section).toContain("Minor fix");
    expect(section).not.toContain("Fixes a tiny typo");
  });
});

// ---------------------------------------------------------------------------
// renderBreakingChangesSection
// ---------------------------------------------------------------------------

describe("renderBreakingChangesSection", () => {
  it("renders warning indicator in heading", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({
        id: "t1",
        title: "Remove legacy API",
        breakingChange: true,
        description: "Removes the v1 API endpoints",
      }),
    ];

    const section = renderBreakingChangesSection(items);
    expect(section).toContain("⚠️ Breaking Changes");
    expect(section).toContain("Remove legacy API");
  });

  it("includes description when available", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({
        id: "t1",
        title: "Breaking task",
        breakingChange: true,
        description: "This removes old behavior",
      }),
    ];

    const section = renderBreakingChangesSection(items);
    expect(section).toContain("This removes old behavior");
  });

  it("returns empty string when no breaking changes", () => {
    const section = renderBreakingChangesSection([]);
    expect(section).toBe("");
  });
});

// ---------------------------------------------------------------------------
// renderMajorChangesSection
// ---------------------------------------------------------------------------

describe("renderMajorChangesSection", () => {
  it("renders major change items with significance indicator", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({
        id: "t1",
        title: "New auth system",
        changeSignificance: "major",
        description: "Complete auth rewrite",
      }),
    ];

    const section = renderMajorChangesSection(items);
    expect(section).toContain("New auth system");
  });

  it("includes description when available", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({
        id: "t1",
        title: "Major task",
        changeSignificance: "major",
        description: "Detailed description of the change",
      }),
    ];

    const section = renderMajorChangesSection(items);
    expect(section).toContain("Detailed description of the change");
  });

  it("returns empty string when no major changes", () => {
    const section = renderMajorChangesSection([]);
    expect(section).toBe("");
  });
});

// ---------------------------------------------------------------------------
// renderPRMarkdownFromRecord (full integration)
// ---------------------------------------------------------------------------

describe("renderPRMarkdownFromRecord", () => {
  it("generates complete markdown with all sections in priority order", () => {
    const record = makeRecord({
      branch: "feature/auth-system",
      items: [
        makeItem({
          id: "task-1",
          title: "Login form",
          level: "task",
          parentChain: [
            { id: "epic-1", title: "Authentication", level: "epic" },
            { id: "feat-1", title: "Login Flow", level: "feature" },
          ],
        }),
        makeItem({
          id: "task-2",
          title: "Remove v1 endpoints",
          level: "task",
          breakingChange: true,
          changeSignificance: "major",
          description: "Removes deprecated v1 API",
          parentChain: [
            { id: "epic-2", title: "API Migration", level: "epic" },
            { id: "feat-2", title: "Endpoint Cleanup", level: "feature" },
          ],
        }),
        makeItem({
          id: "task-3",
          title: "New auth system",
          level: "task",
          changeSignificance: "major",
          description: "Complete auth overhaul",
          parentChain: [
            { id: "epic-1", title: "Authentication", level: "epic" },
            { id: "feat-3", title: "Auth Revamp", level: "feature" },
          ],
        }),
      ],
      epicSummaries: [
        { id: "epic-1", title: "Authentication", completedCount: 2 },
        { id: "epic-2", title: "API Migration", completedCount: 1 },
      ],
    });

    const markdown = renderPRMarkdownFromRecord(record);

    // Summary section
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("feature/auth-system");

    // Breaking changes section (high-visibility)
    expect(markdown).toContain("⚠️ Breaking Changes");
    expect(markdown).toContain("Remove v1 endpoints");

    // Major changes section (non-breaking major items only)
    expect(markdown).toContain("## Major Changes");
    expect(markdown).toContain("New auth system");

    // Completed work section
    expect(markdown).toContain("### Authentication");
    expect(markdown).toContain("Login form");
    expect(markdown).toContain("### API Migration");
  });

  it("places breaking changes before major changes before completed work", () => {
    const record = makeRecord({
      items: [
        makeItem({
          id: "t1",
          title: "Normal task",
          changeSignificance: "patch",
          parentChain: [{ id: "e1", title: "Epic A", level: "epic" }],
        }),
        makeItem({
          id: "t2",
          title: "Breaking task",
          breakingChange: true,
          changeSignificance: "major",
          parentChain: [{ id: "e1", title: "Epic A", level: "epic" }],
        }),
        makeItem({
          id: "t3",
          title: "Major non-breaking task",
          changeSignificance: "major",
          parentChain: [{ id: "e1", title: "Epic A", level: "epic" }],
        }),
      ],
    });

    const markdown = renderPRMarkdownFromRecord(record);
    const summaryIdx = markdown.indexOf("## Summary");
    const breakingIdx = markdown.indexOf("⚠️ Breaking Changes");
    const majorIdx = markdown.indexOf("## Major Changes");
    const completedIdx = markdown.indexOf("## Completed Work");

    expect(summaryIdx).toBeLessThan(breakingIdx);
    expect(breakingIdx).toBeLessThan(majorIdx);
    expect(majorIdx).toBeLessThan(completedIdx);
  });

  it("excludes breaking items from major changes section", () => {
    const record = makeRecord({
      items: [
        makeItem({
          id: "t1",
          title: "Breaking and major",
          breakingChange: true,
          changeSignificance: "major",
          description: "This is breaking",
        }),
      ],
    });

    const markdown = renderPRMarkdownFromRecord(record);
    // Breaking section should exist
    expect(markdown).toContain("⚠️ Breaking Changes");
    // Major section should NOT exist (only major item is also breaking)
    expect(markdown).not.toContain("## Major Changes");
  });

  it("omits breaking changes section when none exist", () => {
    const record = makeRecord({
      items: [makeItem({ id: "t1", title: "Normal task" })],
    });

    const markdown = renderPRMarkdownFromRecord(record);
    expect(markdown).not.toContain("Breaking Changes");
  });

  it("omits major changes section when none exist", () => {
    const record = makeRecord({
      items: [makeItem({ id: "t1", title: "Normal task" })],
    });

    const markdown = renderPRMarkdownFromRecord(record);
    expect(markdown).not.toContain("## Major Changes");
  });

  it("handles empty record with no items", () => {
    const record = makeRecord({ items: [], epicSummaries: [] });

    const markdown = renderPRMarkdownFromRecord(record);
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("No completed work items");
  });

  it("sorts epics alphabetically", () => {
    const record = makeRecord({
      items: [
        makeItem({
          id: "t1",
          title: "Zebra task",
          parentChain: [{ id: "e2", title: "Zebra Epic", level: "epic" }],
        }),
        makeItem({
          id: "t2",
          title: "Alpha task",
          parentChain: [{ id: "e1", title: "Alpha Epic", level: "epic" }],
        }),
      ],
    });

    const markdown = renderPRMarkdownFromRecord(record);
    const alphaIdx = markdown.indexOf("### Alpha Epic");
    const zebraIdx = markdown.indexOf("### Zebra Epic");
    expect(alphaIdx).toBeGreaterThan(-1);
    expect(zebraIdx).toBeGreaterThan(-1);
    expect(alphaIdx).toBeLessThan(zebraIdx);
  });

  it("includes acceptance criteria for breaking changes when available", () => {
    const record = makeRecord({
      items: [
        makeItem({
          id: "t1",
          title: "Breaking change",
          breakingChange: true,
          acceptanceCriteria: ["Consumers must update their imports"],
        }),
      ],
    });

    const markdown = renderPRMarkdownFromRecord(record);
    expect(markdown).toContain("Consumers must update their imports");
  });

  it("renders multiple items under same feature", () => {
    const record = makeRecord({
      items: [
        makeItem({
          id: "t1",
          title: "Task A",
          parentChain: [
            { id: "e1", title: "Epic", level: "epic" },
            { id: "f1", title: "Feature X", level: "feature" },
          ],
        }),
        makeItem({
          id: "t2",
          title: "Task B",
          parentChain: [
            { id: "e1", title: "Epic", level: "epic" },
            { id: "f1", title: "Feature X", level: "feature" },
          ],
        }),
      ],
    });

    const markdown = renderPRMarkdownFromRecord(record);
    // Feature X should appear once as a heading but have both tasks
    expect(markdown).toContain("Task A");
    expect(markdown).toContain("Task B");
    expect(markdown).toContain("Feature X");
  });

  it("produces stable output on repeated calls", () => {
    const record = makeRecord({
      items: [
        makeItem({
          id: "t1",
          title: "Task A",
          parentChain: [{ id: "e1", title: "Epic B", level: "epic" }],
        }),
        makeItem({
          id: "t2",
          title: "Task B",
          parentChain: [{ id: "e2", title: "Epic A", level: "epic" }],
        }),
      ],
    });

    const first = renderPRMarkdownFromRecord(record);
    const second = renderPRMarkdownFromRecord(record);
    expect(first).toBe(second);
  });

  it("includes priority for high-priority items in major section", () => {
    const record = makeRecord({
      items: [
        makeItem({
          id: "t1",
          title: "Critical task",
          priority: "high",
          tags: ["security", "auth"],
          changeSignificance: "major",
          parentChain: [{ id: "e1", title: "Security", level: "epic" }],
        }),
      ],
    });

    const markdown = renderPRMarkdownFromRecord(record);
    expect(markdown).toContain("Critical task");
    // Priority should be visible in the major changes section
    expect(markdown).toContain("high");
  });

  it("shows significance indicators in completed work section", () => {
    const record = makeRecord({
      items: [
        makeItem({
          id: "t1",
          title: "Breaking item",
          breakingChange: true,
          changeSignificance: "major",
          parentChain: [{ id: "e1", title: "Epic", level: "epic" }],
        }),
        makeItem({
          id: "t2",
          title: "Major item",
          changeSignificance: "major",
          parentChain: [{ id: "e1", title: "Epic", level: "epic" }],
        }),
        makeItem({
          id: "t3",
          title: "Patch item",
          changeSignificance: "patch",
          parentChain: [{ id: "e1", title: "Epic", level: "epic" }],
        }),
      ],
    });

    const markdown = renderPRMarkdownFromRecord(record);
    // Completed work section should have indicators
    const completedSection = markdown.slice(markdown.indexOf("## Completed Work"));
    expect(completedSection).toContain("⚠️ **Breaking item**");
    expect(completedSection).toContain("🔶 **Major item**");
    // Patch items have no indicator
    expect(completedSection).toContain("- Patch item");
    expect(completedSection).not.toContain("🔶 **Patch item**");
  });

  it("shows inline context for significant items in completed work", () => {
    const record = makeRecord({
      items: [
        makeItem({
          id: "t1",
          title: "Important change",
          changeSignificance: "minor",
          description: "Rewrites the validation pipeline",
          acceptanceCriteria: ["Validates all input fields", "Returns structured errors"],
          parentChain: [{ id: "e1", title: "Validation", level: "epic" }],
        }),
        makeItem({
          id: "t2",
          title: "Trivial fix",
          changeSignificance: "patch",
          description: "Fixes a typo in comments",
          parentChain: [{ id: "e1", title: "Validation", level: "epic" }],
        }),
      ],
    });

    const markdown = renderPRMarkdownFromRecord(record);
    const completedSection = markdown.slice(markdown.indexOf("## Completed Work"));

    // Significant item should have context
    expect(completedSection).toContain("Rewrites the validation pipeline");
    expect(completedSection).toContain("Validates all input fields");
    expect(completedSection).toContain("Returns structured errors");

    // Patch item should NOT have description in completed work
    expect(completedSection).not.toContain("Fixes a typo in comments");
  });

  it("sorts items by significance within completed work feature groups", () => {
    const record = makeRecord({
      items: [
        makeItem({
          id: "t1",
          title: "Patch task",
          changeSignificance: "patch",
          parentChain: [
            { id: "e1", title: "Epic", level: "epic" },
            { id: "f1", title: "Feature", level: "feature" },
          ],
        }),
        makeItem({
          id: "t2",
          title: "Major task",
          changeSignificance: "major",
          parentChain: [
            { id: "e1", title: "Epic", level: "epic" },
            { id: "f1", title: "Feature", level: "feature" },
          ],
        }),
      ],
    });

    const markdown = renderPRMarkdownFromRecord(record);
    const completedSection = markdown.slice(markdown.indexOf("## Completed Work"));
    const majorIdx = completedSection.indexOf("Major task");
    const patchIdx = completedSection.indexOf("Patch task");
    expect(majorIdx).toBeLessThan(patchIdx);
  });

  it("ends with a trailing newline", () => {
    const record = makeRecord();
    const markdown = renderPRMarkdownFromRecord(record);
    expect(markdown.endsWith("\n")).toBe(true);
  });
});
