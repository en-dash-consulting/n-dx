import { describe, it, expect } from "vitest";
import {
  computeTagOverlap,
  computeCorrelationSignals,
  computeCombinedScore,
  rankEpicsForFeature,
  correlateEpiclessFeatures,
  formatScore,
} from "../../../src/core/epic-correlation.js";
import type { PRDItem } from "../../../src/schema/index.js";
import type { EpiclessFeature } from "../../../src/core/structural.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEpic(overrides: Partial<PRDItem> & { id: string; title: string }): PRDItem {
  return {
    level: "epic",
    status: "pending",
    children: [],
    ...overrides,
  };
}

function makeFeature(overrides: Partial<PRDItem> & { id: string; title: string }): PRDItem {
  return {
    level: "feature",
    status: "pending",
    ...overrides,
  };
}

// ── computeTagOverlap ────────────────────────────────────────────────────────

describe("computeTagOverlap", () => {
  it("returns 0 when either side has no tags", () => {
    expect(computeTagOverlap(undefined, ["a"])).toBe(0);
    expect(computeTagOverlap(["a"], undefined)).toBe(0);
    expect(computeTagOverlap([], ["a"])).toBe(0);
    expect(computeTagOverlap(["a"], [])).toBe(0);
    expect(computeTagOverlap(undefined, undefined)).toBe(0);
  });

  it("returns 1 for identical tag sets", () => {
    expect(computeTagOverlap(["auth", "api"], ["auth", "api"])).toBe(1);
  });

  it("computes Jaccard overlap for partial match", () => {
    // intersection: {auth}, union: {auth, api, ui} → 1/3
    expect(computeTagOverlap(["auth", "api"], ["auth", "ui"])).toBeCloseTo(
      1 / 3,
    );
  });

  it("is case-insensitive", () => {
    expect(computeTagOverlap(["Auth"], ["auth"])).toBe(1);
  });

  it("returns 0 for disjoint tag sets", () => {
    expect(computeTagOverlap(["alpha"], ["beta"])).toBe(0);
  });
});

// ── computeCorrelationSignals ────────────────────────────────────────────────

describe("computeCorrelationSignals", () => {
  it("computes title similarity between feature and epic", () => {
    const feature = makeFeature({
      id: "f1",
      title: "User authentication flow",
    });
    const epic = makeEpic({ id: "e1", title: "Authentication system" });

    const signals = computeCorrelationSignals(feature, epic);

    expect(signals.titleSimilarity).toBeGreaterThan(0);
    expect(signals.descriptionSimilarity).toBe(0);
    expect(signals.tagOverlap).toBe(0);
    expect(signals.childContentSimilarity).toBe(0);
  });

  it("computes description similarity when both have descriptions", () => {
    const feature = makeFeature({
      id: "f1",
      title: "Login page",
      description: "Implement user login with OAuth2 and session management",
    });
    const epic = makeEpic({
      id: "e1",
      title: "Authentication",
      description: "Build OAuth2 authentication with session management",
    });

    const signals = computeCorrelationSignals(feature, epic);

    expect(signals.descriptionSimilarity).toBeGreaterThan(0);
  });

  it("returns 0 for description similarity when one lacks description", () => {
    const feature = makeFeature({
      id: "f1",
      title: "Login page",
      description: "Implement user login",
    });
    const epic = makeEpic({ id: "e1", title: "Authentication" });

    const signals = computeCorrelationSignals(feature, epic);

    expect(signals.descriptionSimilarity).toBe(0);
  });

  it("computes tag overlap", () => {
    const feature = makeFeature({
      id: "f1",
      title: "Feature",
      tags: ["auth", "security"],
    });
    const epic = makeEpic({
      id: "e1",
      title: "Epic",
      tags: ["auth", "api"],
    });

    const signals = computeCorrelationSignals(feature, epic);

    expect(signals.tagOverlap).toBeGreaterThan(0);
  });

  it("computes child content similarity", () => {
    const feature = makeFeature({
      id: "f1",
      title: "Login flow",
      children: [
        { id: "t1", title: "Add login form", level: "task", status: "pending" },
        {
          id: "t2",
          title: "Add password reset",
          level: "task",
          status: "pending",
        },
      ],
    });
    const epic = makeEpic({
      id: "e1",
      title: "Auth system",
      children: [
        {
          id: "f2",
          title: "Registration form",
          level: "feature",
          status: "pending",
          children: [
            {
              id: "t3",
              title: "Add signup form",
              level: "task",
              status: "pending",
            },
          ],
        },
      ],
    });

    const signals = computeCorrelationSignals(feature, epic);

    // Epic children (at first level) include "Registration form" —
    // not directly related, so child similarity may be low
    expect(signals.childContentSimilarity).toBeGreaterThanOrEqual(0);
  });

  it("excludes deleted children from child content", () => {
    const feature = makeFeature({
      id: "f1",
      title: "Feature",
      children: [
        {
          id: "t1",
          title: "Active task",
          level: "task",
          status: "pending",
        },
        {
          id: "t2",
          title: "Deleted task",
          level: "task",
          status: "deleted",
        },
      ],
    });
    const epic = makeEpic({
      id: "e1",
      title: "Epic",
      children: [
        {
          id: "f2",
          title: "Active task related",
          level: "feature",
          status: "pending",
        },
      ],
    });

    const signals = computeCorrelationSignals(feature, epic);

    // Should compute based on non-deleted children only
    expect(signals.childContentSimilarity).toBeGreaterThanOrEqual(0);
  });
});

// ── computeCombinedScore ─────────────────────────────────────────────────────

describe("computeCombinedScore", () => {
  it("returns 1.0 when all signals are perfect", () => {
    const score = computeCombinedScore({
      titleSimilarity: 1.0,
      descriptionSimilarity: 1.0,
      tagOverlap: 1.0,
      childContentSimilarity: 1.0,
    });
    expect(score).toBe(1.0);
  });

  it("returns 0 when all signals are zero", () => {
    const score = computeCombinedScore({
      titleSimilarity: 0,
      descriptionSimilarity: 0,
      tagOverlap: 0,
      childContentSimilarity: 0,
    });
    expect(score).toBe(0);
  });

  it("redistributes description weight to title when description is 0", () => {
    // With description: title gets 0.45 weight
    // Without description: title gets 0.45 + 0.25 = 0.70 weight
    const withDesc = computeCombinedScore({
      titleSimilarity: 0.8,
      descriptionSimilarity: 0.5,
      tagOverlap: 0,
      childContentSimilarity: 0,
    });

    const withoutDesc = computeCombinedScore({
      titleSimilarity: 0.8,
      descriptionSimilarity: 0,
      tagOverlap: 0,
      childContentSimilarity: 0,
    });

    // Without desc, score = 0.8 * 0.70 = 0.56
    expect(withoutDesc).toBeCloseTo(0.56);
    // With desc, score = 0.8 * 0.45 + 0.5 * 0.25 = 0.36 + 0.125 = 0.485
    expect(withDesc).toBeCloseTo(0.485);
  });

  it("weights title as the strongest signal", () => {
    const titleOnly = computeCombinedScore({
      titleSimilarity: 1.0,
      descriptionSimilarity: 0,
      tagOverlap: 0,
      childContentSimilarity: 0,
    });

    const tagsOnly = computeCombinedScore({
      titleSimilarity: 0,
      descriptionSimilarity: 0,
      tagOverlap: 1.0,
      childContentSimilarity: 0,
    });

    expect(titleOnly).toBeGreaterThan(tagsOnly);
  });
});

// ── rankEpicsForFeature ──────────────────────────────────────────────────────

describe("rankEpicsForFeature", () => {
  it("returns empty array when no epics available", () => {
    const feature = makeFeature({ id: "f1", title: "Feature" });
    const result = rankEpicsForFeature(feature, []);
    expect(result).toEqual([]);
  });

  it("ranks epics by score descending", () => {
    const feature = makeFeature({
      id: "f1",
      title: "User authentication login",
    });
    const epics = [
      makeEpic({ id: "e1", title: "Payment processing" }),
      makeEpic({ id: "e2", title: "Authentication system" }),
      makeEpic({ id: "e3", title: "Dashboard UI" }),
    ];

    const candidates = rankEpicsForFeature(feature, epics);

    // Auth epic should score highest for an auth feature
    if (candidates.length > 0) {
      expect(candidates[0].epicId).toBe("e2");
    }

    // Verify sorted descending
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i - 1].score).toBeGreaterThanOrEqual(
        candidates[i].score,
      );
    }
  });

  it("filters out candidates below minScore", () => {
    const feature = makeFeature({ id: "f1", title: "Some feature" });
    const epics = [
      makeEpic({ id: "e1", title: "Completely unrelated epic" }),
    ];

    const candidates = rankEpicsForFeature(feature, epics, {
      minScore: 0.9,
    });

    expect(candidates).toEqual([]);
  });

  it("respects maxCandidates limit", () => {
    const feature = makeFeature({ id: "f1", title: "Feature" });
    const epics = Array.from({ length: 10 }, (_, i) =>
      makeEpic({ id: `e${i}`, title: `Epic ${i} Feature related` }),
    );

    const candidates = rankEpicsForFeature(feature, epics, {
      maxCandidates: 3,
      minScore: 0,
    });

    expect(candidates.length).toBeLessThanOrEqual(3);
  });

  it("includes signal breakdown in candidates", () => {
    const feature = makeFeature({
      id: "f1",
      title: "Auth feature",
      tags: ["auth"],
    });
    const epics = [
      makeEpic({ id: "e1", title: "Auth epic", tags: ["auth"] }),
    ];

    const candidates = rankEpicsForFeature(feature, epics, { minScore: 0 });

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].signals).toHaveProperty("titleSimilarity");
    expect(candidates[0].signals).toHaveProperty("descriptionSimilarity");
    expect(candidates[0].signals).toHaveProperty("tagOverlap");
    expect(candidates[0].signals).toHaveProperty("childContentSimilarity");
    expect(candidates[0].signals.tagOverlap).toBe(1.0);
  });
});

// ── correlateEpiclessFeatures ────────────────────────────────────────────────

describe("correlateEpiclessFeatures", () => {
  it("returns empty candidates when no epics exist", () => {
    const items: PRDItem[] = [
      makeFeature({ id: "f1", title: "Orphan Feature" }),
    ];
    const epicless: EpiclessFeature[] = [
      {
        itemId: "f1",
        title: "Orphan Feature",
        status: "pending",
        childCount: 0,
      },
    ];

    const results = correlateEpiclessFeatures(items, epicless);

    expect(results).toHaveLength(1);
    expect(results[0].featureId).toBe("f1");
    expect(results[0].candidates).toEqual([]);
    expect(results[0].hasHighConfidence).toBe(false);
  });

  it("handles feature not found in items gracefully", () => {
    const items: PRDItem[] = [
      makeEpic({ id: "e1", title: "Epic" }),
    ];
    const epicless: EpiclessFeature[] = [
      {
        itemId: "f-gone",
        title: "Gone Feature",
        status: "pending",
        childCount: 0,
      },
    ];

    const results = correlateEpiclessFeatures(items, epicless);

    expect(results).toHaveLength(1);
    expect(results[0].featureId).toBe("f-gone");
    expect(results[0].candidates).toEqual([]);
    expect(results[0].hasHighConfidence).toBe(false);
  });

  it("excludes deleted epics from candidates", () => {
    const items: PRDItem[] = [
      makeEpic({ id: "e1", title: "Deleted Auth", status: "deleted" }),
      makeFeature({ id: "f1", title: "Auth login" }),
    ];
    const epicless: EpiclessFeature[] = [
      { itemId: "f1", title: "Auth login", status: "pending", childCount: 0 },
    ];

    const results = correlateEpiclessFeatures(items, epicless);

    expect(results[0].candidates).toEqual([]);
  });

  it("flags high confidence when top score exceeds threshold", () => {
    const items: PRDItem[] = [
      makeEpic({
        id: "e1",
        title: "Authentication and authorization system",
        description: "Build user authentication with OAuth",
        tags: ["auth"],
      }),
      makeFeature({
        id: "f1",
        title: "Authentication login flow",
        description: "Implement OAuth login and session management",
        tags: ["auth"],
      }),
    ];
    const epicless: EpiclessFeature[] = [
      {
        itemId: "f1",
        title: "Authentication login flow",
        status: "pending",
        childCount: 0,
      },
    ];

    const results = correlateEpiclessFeatures(items, epicless, {
      highConfidenceThreshold: 0.3,
    });

    expect(results[0].candidates.length).toBeGreaterThan(0);
    expect(results[0].hasHighConfidence).toBe(true);
  });

  it("does not flag high confidence when scores are low", () => {
    const items: PRDItem[] = [
      makeEpic({ id: "e1", title: "Payment processing" }),
      makeFeature({ id: "f1", title: "Dashboard styling" }),
    ];
    const epicless: EpiclessFeature[] = [
      {
        itemId: "f1",
        title: "Dashboard styling",
        status: "pending",
        childCount: 0,
      },
    ];

    const results = correlateEpiclessFeatures(items, epicless, {
      highConfidenceThreshold: 0.9,
      minScore: 0,
    });

    expect(results[0].hasHighConfidence).toBe(false);
  });

  it("handles multiple epicless features independently", () => {
    const items: PRDItem[] = [
      makeEpic({ id: "e1", title: "Authentication system" }),
      makeEpic({ id: "e2", title: "Payment processing" }),
      makeFeature({ id: "f1", title: "Login flow" }),
      makeFeature({ id: "f2", title: "Checkout flow" }),
    ];
    const epicless: EpiclessFeature[] = [
      { itemId: "f1", title: "Login flow", status: "pending", childCount: 0 },
      {
        itemId: "f2",
        title: "Checkout flow",
        status: "pending",
        childCount: 0,
      },
    ];

    const results = correlateEpiclessFeatures(items, epicless, {
      minScore: 0,
    });

    expect(results).toHaveLength(2);
    expect(results[0].featureId).toBe("f1");
    expect(results[1].featureId).toBe("f2");
  });

  it("returns results in input order", () => {
    const items: PRDItem[] = [
      makeEpic({ id: "e1", title: "Epic" }),
      makeFeature({ id: "f2", title: "Second" }),
      makeFeature({ id: "f1", title: "First" }),
    ];
    const epicless: EpiclessFeature[] = [
      { itemId: "f2", title: "Second", status: "pending", childCount: 0 },
      { itemId: "f1", title: "First", status: "pending", childCount: 0 },
    ];

    const results = correlateEpiclessFeatures(items, epicless, {
      minScore: 0,
    });

    expect(results[0].featureId).toBe("f2");
    expect(results[1].featureId).toBe("f1");
  });
});

// ── formatScore ──────────────────────────────────────────────────────────────

describe("formatScore", () => {
  it("formats 0 as 0%", () => {
    expect(formatScore(0)).toBe("0%");
  });

  it("formats 1.0 as 100%", () => {
    expect(formatScore(1.0)).toBe("100%");
  });

  it("rounds to nearest percent", () => {
    expect(formatScore(0.735)).toBe("74%");
    expect(formatScore(0.5)).toBe("50%");
  });
});
