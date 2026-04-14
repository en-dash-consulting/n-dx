import { describe, it, expect } from "vitest";
import type {
  EnrichedRecommendation,
  RecommendationTreeItem,
} from "../../../src/recommend/types.js";
import {
  detectRecommendationConflicts,
  formatConflict,
  formatIntraBatchDuplicate,
  CONFLICT_THRESHOLD,
} from "../../../src/recommend/conflict-detection.js";

// ── Helpers ──────────────────────────────────────────────────────────────

function makeRecommendation(
  overrides: Partial<EnrichedRecommendation> = {},
): EnrichedRecommendation {
  return {
    title: "Address auth issues (3 findings)",
    level: "feature",
    description: "- Auth finding A\n- Auth finding B",
    priority: "high",
    source: "sourcevision",
    ...overrides,
  };
}

function makeItem(overrides: Partial<RecommendationTreeItem> = {}): RecommendationTreeItem {
  return {
    id: "existing-1",
    title: "Address auth issues (3 findings)",
    status: "pending",
    level: "feature",
    ...overrides,
  };
}

// ── Conflict detection against existing PRD items ────────────────────────

describe("detectRecommendationConflicts", () => {
  // ── Basic conflict detection ────────────────────────────────────────

  it("detects exact title match with existing item", () => {
    const recs = [makeRecommendation({ title: "Address auth issues" })];
    const items = [makeItem({ title: "Address auth issues" })];

    const report = detectRecommendationConflicts(recs, items);

    expect(report.hasConflicts).toBe(true);
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0].reason).toBe("exact_title");
    expect(report.conflicts[0].score).toBe(1.0);
    expect(report.conflicts[0].recommendationIndex).toBe(0);
    expect(report.conflicts[0].matchedItem.id).toBe("existing-1");
  });

  it("detects semantic title match (similar but not exact)", () => {
    const recs = [makeRecommendation({ title: "Address authentication issues (3 findings)" })];
    const items = [makeItem({ title: "Address authentication issues" })];

    const report = detectRecommendationConflicts(recs, items);

    expect(report.hasConflicts).toBe(true);
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0].score).toBeGreaterThanOrEqual(CONFLICT_THRESHOLD);
  });

  it("detects title containment conflict", () => {
    const recs = [makeRecommendation({ title: "Address auth issues (5 findings)" })];
    const items = [makeItem({ title: "Address auth issues" })];

    const report = detectRecommendationConflicts(recs, items);

    expect(report.hasConflicts).toBe(true);
    expect(report.conflicts).toHaveLength(1);
  });

  it("returns no conflicts when titles are completely different", () => {
    const recs = [makeRecommendation({ title: "Implement dark mode" })];
    const items = [makeItem({ title: "Fix database migration" })];

    const report = detectRecommendationConflicts(recs, items);

    expect(report.hasConflicts).toBe(false);
    expect(report.conflicts).toHaveLength(0);
    expect(report.safeIndices).toEqual([0]);
  });

  it("returns no conflicts with empty PRD", () => {
    const recs = [makeRecommendation()];
    const report = detectRecommendationConflicts(recs, []);

    expect(report.hasConflicts).toBe(false);
    expect(report.conflicts).toHaveLength(0);
    expect(report.safeIndices).toEqual([0]);
  });

  it("returns no conflicts with empty recommendations", () => {
    const items = [makeItem()];
    const report = detectRecommendationConflicts([], items);

    expect(report.hasConflicts).toBe(false);
    expect(report.conflicts).toHaveLength(0);
    expect(report.safeIndices).toEqual([]);
  });

  // ── Multiple recommendations ──────────────────────────────────────

  it("detects conflicts for some recommendations while others are safe", () => {
    const recs = [
      makeRecommendation({ title: "Address auth issues", description: "- Auth token expiry\n- Missing CSRF protection" }),
      makeRecommendation({ title: "Implement new logging system", description: "- Add structured JSON logging\n- Configure log rotation" }),
      makeRecommendation({ title: "Fix performance problems", description: "- Slow database queries\n- Unoptimized image loading" }),
    ];
    const items = [
      makeItem({ id: "e1", title: "Address auth issues" }),
      makeItem({ id: "e2", title: "Fix performance problems" }),
    ];

    const report = detectRecommendationConflicts(recs, items);

    expect(report.hasConflicts).toBe(true);
    expect(report.conflicts).toHaveLength(2);
    expect(report.conflictingIndices).toContain(0); // auth
    expect(report.conflictingIndices).toContain(2); // perf
    expect(report.safeIndices).toEqual([1]); // logging is safe
  });

  it("identifies the best match when multiple items could match", () => {
    const recs = [makeRecommendation({ title: "Address auth issues" })];
    const items = [
      makeItem({ id: "e1", title: "Auth problems" }),
      makeItem({ id: "e2", title: "Address auth issues" }), // exact match
    ];

    const report = detectRecommendationConflicts(recs, items);

    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0].matchedItem.id).toBe("e2");
    expect(report.conflicts[0].score).toBe(1.0);
  });

  // ── Nested items ──────────────────────────────────────────────────

  it("detects conflicts with nested PRD items", () => {
    const recs = [makeRecommendation({ title: "Fix auth token refresh" })];
    const items: RecommendationTreeItem[] = [
      {
        id: "epic-1",
        title: "Security Epic",
        status: "pending",
        level: "epic",
        children: [
          {
            id: "feature-1",
            title: "Fix auth token refresh",
            status: "in_progress",
            level: "feature",
          },
        ],
      },
    ];

    const report = detectRecommendationConflicts(recs, items);

    expect(report.hasConflicts).toBe(true);
    expect(report.conflicts[0].matchedItem.id).toBe("feature-1");
    expect(report.conflicts[0].matchedItem.status).toBe("in_progress");
  });

  // ── Completed items are excluded ──────────────────────────────────

  it("skips completed items — new recommendations represent new work", () => {
    const recs = [makeRecommendation({ title: "Address auth issues" })];
    const items = [
      makeItem({
        id: "completed-1",
        title: "Address auth issues",
        status: "completed",
        level: "task",
      }),
    ];

    const report = detectRecommendationConflicts(recs, items);

    expect(report.hasConflicts).toBe(false);
    expect(report.conflicts).toHaveLength(0);
    expect(report.safeIndices).toEqual([0]);
  });

  it("conflicts with pending items but not completed ones with same title", () => {
    const recs = [
      makeRecommendation({ title: "Address auth issues" }),
      makeRecommendation({ title: "Fix perf problems" }),
    ];
    const items = [
      makeItem({ id: "e1", title: "Address auth issues", status: "pending" }),
      makeItem({ id: "e2", title: "Fix perf problems", status: "completed" }),
    ];

    const report = detectRecommendationConflicts(recs, items);

    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0].matchedItem.id).toBe("e1");
    expect(report.safeIndices).toContain(1); // perf is safe (matched item completed)
  });

  // ── Content overlap detection ─────────────────────────────────────

  it("detects content overlap conflicts", () => {
    const recs = [
      makeRecommendation({
        title: "Security improvements",
        description: "Implement input validation and sanitization for all user-facing endpoints",
      }),
    ];
    const items = [
      makeItem({
        id: "e1",
        title: "Input validation",
        description: "Implement input validation and sanitization for all user-facing endpoints",
      }),
    ];

    const report = detectRecommendationConflicts(recs, items);

    // At minimum, content overlap should be detected since descriptions match
    expect(report.hasConflicts).toBe(true);
  });

  // ── Intra-batch duplicate detection ──────────────────────────────

  it("detects intra-batch duplicates", () => {
    const recs = [
      makeRecommendation({ title: "Address auth issues (3 findings)" }),
      makeRecommendation({ title: "Address auth issues (5 findings)" }),
    ];

    const report = detectRecommendationConflicts(recs, []);

    expect(report.intraBatchDuplicates).toHaveLength(1);
    expect(report.intraBatchDuplicates[0].indexA).toBe(0);
    expect(report.intraBatchDuplicates[0].indexB).toBe(1);
    expect(report.intraBatchDuplicates[0].score).toBeGreaterThanOrEqual(CONFLICT_THRESHOLD);
    expect(report.hasConflicts).toBe(true);
    // The later one (indexB) is marked as conflicting
    expect(report.conflictingIndices).toContain(1);
  });

  it("does not flag non-duplicate batch items", () => {
    const recs = [
      makeRecommendation({ title: "Address auth issues", description: "- Auth token expiry bug" }),
      makeRecommendation({ title: "Implement dark mode", description: "- Add theme toggle to settings" }),
      makeRecommendation({ title: "Fix database migration", description: "- Migration script crashes on empty tables" }),
    ];

    const report = detectRecommendationConflicts(recs, []);

    expect(report.intraBatchDuplicates).toHaveLength(0);
    expect(report.hasConflicts).toBe(false);
    expect(report.safeIndices).toEqual([0, 1, 2]);
  });

  // ── Combined existing + intra-batch conflicts ─────────────────────

  it("reports both existing and intra-batch conflicts", () => {
    const recs = [
      makeRecommendation({ title: "Address auth issues", description: "- Token expiry bug\n- Missing CSRF" }),
      makeRecommendation({ title: "Address auth issues", description: "- Token expiry bug\n- Missing CSRF\n- Session hijack" }),
      makeRecommendation({ title: "Implement dark mode", description: "- Add theme toggle to settings" }),
    ];
    const items = [makeItem({ id: "e1", title: "Address auth issues" })];

    const report = detectRecommendationConflicts(recs, items);

    expect(report.hasConflicts).toBe(true);
    // Both auth recs conflict: #0 matches existing item, #1 matches existing + is intra-batch dup
    expect(report.conflictingIndices).toContain(0);
    expect(report.conflictingIndices).toContain(1);
    expect(report.safeIndices).toEqual([2]); // dark mode is safe
  });

  // ── Report structure ──────────────────────────────────────────────

  it("returns sorted conflicting indices", () => {
    const recs = [
      makeRecommendation({ title: "Fix auth", description: "- Auth token bug" }),
      makeRecommendation({ title: "New feature", description: "- Brand new logging system" }),
      makeRecommendation({ title: "Fix performance", description: "- Slow queries" }),
    ];
    const items = [
      makeItem({ id: "e1", title: "Fix auth" }),
      makeItem({ id: "e2", title: "Fix performance" }),
    ];

    const report = detectRecommendationConflicts(recs, items);

    expect(report.conflictingIndices).toEqual([0, 2]);
    expect(report.safeIndices).toEqual([1]);
  });
});

// ── Format functions ──────────────────────────────────────────────────

describe("formatConflict", () => {
  it("formats exact title match conflict", () => {
    const msg = formatConflict({
      recommendationIndex: 0,
      recommendationTitle: "Address auth issues",
      matchedItem: {
        id: "e1",
        title: "Address auth issues",
        level: "feature",
        status: "pending",
      },
      reason: "exact_title",
      score: 1.0,
    });

    expect(msg).toContain("Address auth issues");
    expect(msg).toContain("exact title match");
    expect(msg).toContain("100%");
    expect(msg).toContain("feature");
  });

  it("formats semantic title match conflict", () => {
    const msg = formatConflict({
      recommendationIndex: 0,
      recommendationTitle: "Fix auth token",
      matchedItem: {
        id: "e1",
        title: "Fix authentication tokens",
        level: "task",
        status: "in_progress",
      },
      reason: "semantic_title",
      score: 0.85,
    });

    expect(msg).toContain("similar title");
    expect(msg).toContain("85%");
    expect(msg).toContain("(in progress)");
  });

  it("formats completed item conflict", () => {
    const msg = formatConflict({
      recommendationIndex: 0,
      recommendationTitle: "Fix bug",
      matchedItem: {
        id: "e1",
        title: "Fix bug",
        level: "task",
        status: "completed",
      },
      reason: "exact_title",
      score: 1.0,
    });

    expect(msg).toContain("(completed)");
  });

  it("formats content overlap conflict", () => {
    const msg = formatConflict({
      recommendationIndex: 0,
      recommendationTitle: "Security fixes",
      matchedItem: {
        id: "e1",
        title: "Input validation",
        level: "feature",
        status: "pending",
      },
      reason: "content_overlap",
      score: 0.75,
    });

    expect(msg).toContain("overlapping content");
    expect(msg).toContain("75%");
  });
});

describe("formatIntraBatchDuplicate", () => {
  it("formats duplicate pair with 1-based indices", () => {
    const msg = formatIntraBatchDuplicate({
      indexA: 0,
      indexB: 2,
      titleA: "Fix auth",
      titleB: "Fix authentication",
      score: 0.9,
    });

    expect(msg).toContain("#1");
    expect(msg).toContain("#3");
    expect(msg).toContain("Fix auth");
    expect(msg).toContain("Fix authentication");
    expect(msg).toContain("90%");
  });
});
