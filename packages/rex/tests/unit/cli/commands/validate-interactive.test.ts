import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveEpiclessFeatures,
  applyEpiclessResolutions,
} from "../../../../src/cli/commands/validate-interactive.js";
import type {
  EpiclessResolution,
  PromptFn,
} from "../../../../src/cli/commands/validate-interactive.js";
import type { EpiclessFeature } from "../../../../src/core/structural.js";
import type { PRDDocument } from "../../../../src/schema/index.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a mock prompt function that returns answers in sequence. */
function mockPrompt(answers: string[]): PromptFn {
  let idx = 0;
  return async (_question: string) => {
    if (idx >= answers.length) return "";
    return answers[idx++];
  };
}

function makeDoc(overrides?: Partial<PRDDocument>): PRDDocument {
  return {
    schema: "rex/v1",
    title: "Test",
    items: [
      {
        id: "e1",
        title: "Epic One",
        level: "epic",
        status: "pending",
        children: [],
      },
      {
        id: "e2",
        title: "Epic Two",
        level: "epic",
        status: "pending",
        children: [],
      },
      {
        id: "f1",
        title: "Orphan Feature",
        level: "feature",
        status: "pending",
        children: [
          {
            id: "t1",
            title: "Task Under Feature",
            level: "task",
            status: "pending",
          },
        ],
      },
    ],
    ...overrides,
  };
}

const SINGLE_EPICLESS: EpiclessFeature[] = [
  { itemId: "f1", title: "Orphan Feature", status: "pending", childCount: 1 },
];

// ── resolveEpiclessFeatures ──────────────────────────────────────────────────

describe("resolveEpiclessFeatures", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("presents options for each epicless feature", async () => {
    const doc = makeDoc();
    const prompt = mockPrompt(["3"]); // skip

    await resolveEpiclessFeatures(doc, SINGLE_EPICLESS, { prompt });

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Orphan Feature");
    expect(output).toContain("[1] Correlate");
    expect(output).toContain("[2] Delete");
    expect(output).toContain("[3] Skip");
  });

  it("returns skip resolution when user chooses skip", async () => {
    const doc = makeDoc();
    const prompt = mockPrompt(["3"]);

    const resolutions = await resolveEpiclessFeatures(
      doc,
      SINGLE_EPICLESS,
      { prompt },
    );

    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]).toEqual({
      featureId: "f1",
      action: "skip",
    });
  });

  it("returns delete resolution when user chooses delete", async () => {
    const doc = makeDoc();
    const prompt = mockPrompt(["2"]);

    const resolutions = await resolveEpiclessFeatures(
      doc,
      SINGLE_EPICLESS,
      { prompt },
    );

    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]).toEqual({
      featureId: "f1",
      action: "delete",
    });
  });

  it("returns correlate resolution with target epic when user correlates", async () => {
    const doc = makeDoc();
    // "1" = correlate, "1" = first epic
    const prompt = mockPrompt(["1", "1"]);

    const resolutions = await resolveEpiclessFeatures(
      doc,
      SINGLE_EPICLESS,
      { prompt },
    );

    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]).toEqual({
      featureId: "f1",
      action: "correlate",
      targetEpicId: "e1",
    });
  });

  it("allows selecting second epic for correlation", async () => {
    const doc = makeDoc();
    // "1" = correlate, "2" = second epic
    const prompt = mockPrompt(["1", "2"]);

    const resolutions = await resolveEpiclessFeatures(
      doc,
      SINGLE_EPICLESS,
      { prompt },
    );

    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]).toEqual({
      featureId: "f1",
      action: "correlate",
      targetEpicId: "e2",
    });
  });

  it("falls back to skip when invalid epic selection is given", async () => {
    const doc = makeDoc();
    // "1" = correlate, "99" = invalid epic number
    const prompt = mockPrompt(["1", "99"]);

    const resolutions = await resolveEpiclessFeatures(
      doc,
      SINGLE_EPICLESS,
      { prompt },
    );

    expect(resolutions).toHaveLength(1);
    expect(resolutions[0].action).toBe("skip");
  });

  it("falls back to skip when no epics are available for correlation", async () => {
    const doc = makeDoc({
      items: [
        {
          id: "f1",
          title: "Orphan Feature",
          level: "feature",
          status: "pending",
        },
      ],
    });
    const prompt = mockPrompt(["1"]); // correlate

    const resolutions = await resolveEpiclessFeatures(
      doc,
      SINGLE_EPICLESS,
      { prompt },
    );

    expect(resolutions).toHaveLength(1);
    expect(resolutions[0].action).toBe("skip");
  });

  it("handles invalid choice by defaulting to skip", async () => {
    const doc = makeDoc();
    const prompt = mockPrompt(["xyz"]);

    const resolutions = await resolveEpiclessFeatures(
      doc,
      SINGLE_EPICLESS,
      { prompt },
    );

    expect(resolutions).toHaveLength(1);
    expect(resolutions[0].action).toBe("skip");
  });

  it("handles empty input by defaulting to skip", async () => {
    const doc = makeDoc();
    const prompt = mockPrompt([""]);

    const resolutions = await resolveEpiclessFeatures(
      doc,
      SINGLE_EPICLESS,
      { prompt },
    );

    expect(resolutions).toHaveLength(1);
    expect(resolutions[0].action).toBe("skip");
  });

  it("handles multiple epicless features independently", async () => {
    const doc = makeDoc({
      items: [
        { id: "e1", title: "Epic One", level: "epic", status: "pending", children: [] },
        { id: "f1", title: "Feature A", level: "feature", status: "pending" },
        { id: "f2", title: "Feature B", level: "feature", status: "pending" },
      ],
    });
    const features: EpiclessFeature[] = [
      { itemId: "f1", title: "Feature A", status: "pending", childCount: 0 },
      { itemId: "f2", title: "Feature B", status: "pending", childCount: 0 },
    ];

    // f1 → correlate under e1, f2 → delete
    const prompt = mockPrompt(["1", "1", "2"]);

    const resolutions = await resolveEpiclessFeatures(doc, features, { prompt });

    expect(resolutions).toHaveLength(2);
    expect(resolutions[0]).toEqual({
      featureId: "f1",
      action: "correlate",
      targetEpicId: "e1",
    });
    expect(resolutions[1]).toEqual({
      featureId: "f2",
      action: "delete",
    });
  });

  it("excludes deleted epics from correlation options", async () => {
    const doc = makeDoc({
      items: [
        { id: "e1", title: "Deleted Epic", level: "epic", status: "deleted" },
        { id: "f1", title: "Feature", level: "feature", status: "pending" },
      ],
    });
    const prompt = mockPrompt(["1"]); // try correlate — no epics available

    const resolutions = await resolveEpiclessFeatures(
      doc,
      SINGLE_EPICLESS,
      { prompt },
    );

    expect(resolutions[0].action).toBe("skip");
  });

  it("displays child count information in prompt", async () => {
    const doc = makeDoc();
    const features: EpiclessFeature[] = [
      { itemId: "f1", title: "Feature", status: "pending", childCount: 3 },
    ];
    const prompt = mockPrompt(["3"]);

    await resolveEpiclessFeatures(doc, features, { prompt });

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("3 children");
  });

  it("displays singular child label for one child", async () => {
    const doc = makeDoc();
    const features: EpiclessFeature[] = [
      { itemId: "f1", title: "Feature", status: "pending", childCount: 1 },
    ];
    const prompt = mockPrompt(["3"]);

    await resolveEpiclessFeatures(doc, features, { prompt });

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("1 child)");
    expect(output).not.toContain("1 children");
  });

  it("omits child count in feature description when childCount is 0", async () => {
    const doc = makeDoc();
    const features: EpiclessFeature[] = [
      { itemId: "f1", title: "Feature", status: "pending", childCount: 0 },
    ];
    const prompt = mockPrompt(["3"]);

    await resolveEpiclessFeatures(doc, features, { prompt });

    // The feature description line should not contain child count info.
    // Note: the static option label "[2] Delete — remove this feature and its
    // children" always contains "children", so we check only the feature line.
    const featureLine = logSpy.mock.calls
      .map((c) => c[0] as string)
      .find((line) => line.includes("Feature:"));
    expect(featureLine).toBeDefined();
    expect(featureLine).not.toMatch(/\d+ child/);
  });

  // ── Correlation-enhanced behavior ────────────────────────────────────────

  it("displays correlation suggestions when candidates exist", async () => {
    const doc = makeDoc({
      items: [
        {
          id: "e1",
          title: "User authentication system",
          level: "epic",
          status: "pending",
          tags: ["auth"],
          children: [],
        },
        {
          id: "e2",
          title: "Payment processing",
          level: "epic",
          status: "pending",
          children: [],
        },
        {
          id: "f1",
          title: "User authentication login",
          level: "feature",
          status: "pending",
          tags: ["auth"],
        },
      ],
    });
    const features: EpiclessFeature[] = [
      {
        itemId: "f1",
        title: "User authentication login",
        status: "pending",
        childCount: 0,
      },
    ];
    const prompt = mockPrompt(["3"]); // skip

    await resolveEpiclessFeatures(doc, features, { prompt });

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Suggested parent epics");
    expect(output).toMatch(/% match/); // at least one candidate with score
  });

  it("shows recommendation hint for high-confidence match", async () => {
    const doc = makeDoc({
      items: [
        {
          id: "e1",
          title: "User authentication system",
          level: "epic",
          status: "pending",
          description: "Build user auth with OAuth",
          tags: ["auth"],
          children: [],
        },
        {
          id: "f1",
          title: "User authentication login",
          level: "feature",
          status: "pending",
          description: "Implement OAuth login flow",
          tags: ["auth"],
        },
      ],
    });
    const features: EpiclessFeature[] = [
      {
        itemId: "f1",
        title: "User authentication login",
        status: "pending",
        childCount: 0,
      },
    ];
    const prompt = mockPrompt(["3"]); // skip

    await resolveEpiclessFeatures(doc, features, { prompt });

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    // Should show "recommended" in the correlate option for high confidence
    expect(output).toContain("recommended");
  });

  it("allows accepting top suggestion with 'y' for high-confidence match", async () => {
    const doc = makeDoc({
      items: [
        {
          id: "e1",
          title: "User authentication system",
          level: "epic",
          status: "pending",
          description: "Build user auth with OAuth",
          tags: ["auth"],
          children: [],
        },
        {
          id: "f1",
          title: "User authentication login",
          level: "feature",
          status: "pending",
          description: "Implement OAuth login flow",
          tags: ["auth"],
        },
      ],
    });
    const features: EpiclessFeature[] = [
      {
        itemId: "f1",
        title: "User authentication login",
        status: "pending",
        childCount: 0,
      },
    ];
    // "1" = correlate, "y" = accept top suggestion
    const prompt = mockPrompt(["1", "y"]);

    const resolutions = await resolveEpiclessFeatures(doc, features, {
      prompt,
    });

    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]).toEqual({
      featureId: "f1",
      action: "correlate",
      targetEpicId: "e1",
    });
  });

  it("allows declining top suggestion and browsing all epics", async () => {
    const doc = makeDoc({
      items: [
        {
          id: "e1",
          title: "User authentication system",
          level: "epic",
          status: "pending",
          description: "Build user auth with OAuth",
          tags: ["auth"],
          children: [],
        },
        {
          id: "e2",
          title: "Dashboard UI",
          level: "epic",
          status: "pending",
          children: [],
        },
        {
          id: "f1",
          title: "User authentication login",
          level: "feature",
          status: "pending",
          description: "Implement OAuth login flow",
          tags: ["auth"],
        },
      ],
    });
    const features: EpiclessFeature[] = [
      {
        itemId: "f1",
        title: "User authentication login",
        status: "pending",
        childCount: 0,
      },
    ];
    // "1" = correlate, "n" = decline suggestion, "2" = pick second epic in list
    const prompt = mockPrompt(["1", "n", "2"]);

    const resolutions = await resolveEpiclessFeatures(doc, features, {
      prompt,
    });

    expect(resolutions).toHaveLength(1);
    expect(resolutions[0].action).toBe("correlate");
    // Should have picked an epic (the exact one depends on display order)
    expect(resolutions[0].targetEpicId).toBeDefined();
  });

  it("shows correlation scores in the epic list during browse", async () => {
    const doc = makeDoc({
      items: [
        {
          id: "e1",
          title: "User authentication system",
          level: "epic",
          status: "pending",
          tags: ["auth"],
          children: [],
        },
        {
          id: "f1",
          title: "User authentication login",
          level: "feature",
          status: "pending",
          tags: ["auth"],
        },
      ],
    });
    const features: EpiclessFeature[] = [
      {
        itemId: "f1",
        title: "User authentication login",
        status: "pending",
        childCount: 0,
      },
    ];
    // "1" = correlate, then select first epic
    // If high confidence: "1" → "n" → "1" (decline suggestion, pick first)
    // If not high confidence: "1" → "1" (pick first)
    // Use "n" path to ensure we see the browse list either way
    const prompt = mockPrompt(["1", "n", "1", "1"]);

    await resolveEpiclessFeatures(doc, features, { prompt });

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("% match");
  });

  // ── Integrity-protected deletion ──────────────────────────────────────────

  it("deletes safe feature without extra confirmation", async () => {
    // Feature f1 has no sync metadata and no external blockedBy refs
    const doc = makeDoc();
    const prompt = mockPrompt(["2"]);

    const resolutions = await resolveEpiclessFeatures(
      doc,
      SINGLE_EPICLESS,
      { prompt },
    );

    expect(resolutions).toHaveLength(1);
    expect(resolutions[0].action).toBe("delete");

    // Should NOT show integrity warnings for safe deletion
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).not.toContain("Integrity warnings");
    expect(output).toContain("no external dependencies");
  });

  it("shows warnings and requires confirmation for feature with external dependents", async () => {
    const doc = makeDoc({
      items: [
        { id: "e1", title: "Epic One", level: "epic", status: "pending", children: [] },
        {
          id: "f1",
          title: "Feature with deps",
          level: "feature",
          status: "pending",
          children: [
            { id: "t1", title: "Task One", level: "task", status: "pending" },
          ],
        },
        {
          id: "t-other",
          title: "Dependent Task",
          level: "task",
          status: "blocked",
          blockedBy: ["t1"],
        },
      ],
    });
    const features: EpiclessFeature[] = [
      { itemId: "f1", title: "Feature with deps", status: "pending", childCount: 1 },
    ];

    // "2" = delete, "y" = confirm
    const prompt = mockPrompt(["2", "y"]);

    const resolutions = await resolveEpiclessFeatures(doc, features, { prompt });

    expect(resolutions).toHaveLength(1);
    expect(resolutions[0].action).toBe("delete");

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    const errOutput = errSpy.mock.calls.map((c) => c[0]).join("\n");
    const combined = output + "\n" + errOutput;
    expect(combined).toContain("Integrity warnings");
    expect(combined).toContain("external");
  });

  it("cancels deletion when user declines confirmation for unsafe feature", async () => {
    const doc = makeDoc({
      items: [
        { id: "e1", title: "Epic One", level: "epic", status: "pending", children: [] },
        {
          id: "f1",
          title: "Synced Feature",
          level: "feature",
          status: "pending",
          remoteId: "notion-page-123",
        },
      ],
    });
    const features: EpiclessFeature[] = [
      { itemId: "f1", title: "Synced Feature", status: "pending", childCount: 0 },
    ];

    // "2" = delete, "n" = cancel
    const prompt = mockPrompt(["2", "n"]);

    const resolutions = await resolveEpiclessFeatures(doc, features, { prompt });

    expect(resolutions).toHaveLength(1);
    expect(resolutions[0].action).toBe("skip");

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("cancelled");
  });

  it("shows sync warnings for feature with remote sync metadata", async () => {
    const doc = makeDoc({
      items: [
        { id: "e1", title: "Epic One", level: "epic", status: "pending", children: [] },
        {
          id: "f1",
          title: "Synced Feature",
          level: "feature",
          status: "pending",
          remoteId: "notion-page-123",
          lastSyncedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    const features: EpiclessFeature[] = [
      { itemId: "f1", title: "Synced Feature", status: "pending", childCount: 0 },
    ];

    // "2" = delete, "y" = confirm
    const prompt = mockPrompt(["2", "y"]);

    const resolutions = await resolveEpiclessFeatures(doc, features, { prompt });

    expect(resolutions).toHaveLength(1);
    expect(resolutions[0].action).toBe("delete");

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    const errOutput = errSpy.mock.calls.map((c) => c[0]).join("\n");
    const combined = output + "\n" + errOutput;
    expect(combined).toContain("synced");
  });

  it("shows star marker for high confidence top suggestion", async () => {
    const doc = makeDoc({
      items: [
        {
          id: "e1",
          title: "User authentication system",
          level: "epic",
          status: "pending",
          description: "Build user auth with OAuth",
          tags: ["auth"],
          children: [],
        },
        {
          id: "f1",
          title: "User authentication login",
          level: "feature",
          status: "pending",
          description: "Implement OAuth login flow",
          tags: ["auth"],
        },
      ],
    });
    const features: EpiclessFeature[] = [
      {
        itemId: "f1",
        title: "User authentication login",
        status: "pending",
        childCount: 0,
      },
    ];
    const prompt = mockPrompt(["3"]); // skip

    await resolveEpiclessFeatures(doc, features, { prompt });

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("★");
  });
});

// ── applyEpiclessResolutions ─────────────────────────────────────────────────

describe("applyEpiclessResolutions", () => {
  it("moves feature under target epic on correlate", () => {
    const doc = makeDoc();
    const resolutions: EpiclessResolution[] = [
      { featureId: "f1", action: "correlate", targetEpicId: "e1" },
    ];

    const mutated = applyEpiclessResolutions(doc, resolutions);

    expect(mutated).toBe(1);
    // Feature should be removed from root
    expect(doc.items.find((i) => i.id === "f1")).toBeUndefined();
    // Feature should be under epic e1
    const epic = doc.items.find((i) => i.id === "e1");
    expect(epic?.children?.find((c) => c.id === "f1")).toBeDefined();
    // Children should be preserved
    const movedFeature = epic?.children?.find((c) => c.id === "f1");
    expect(movedFeature?.children).toHaveLength(1);
    expect(movedFeature?.children?.[0].id).toBe("t1");
  });

  it("removes feature on delete", () => {
    const doc = makeDoc();
    const resolutions: EpiclessResolution[] = [
      { featureId: "f1", action: "delete" },
    ];

    const mutated = applyEpiclessResolutions(doc, resolutions);

    expect(mutated).toBe(1);
    expect(doc.items.find((i) => i.id === "f1")).toBeUndefined();
    // Only the two epics remain
    expect(doc.items).toHaveLength(2);
  });

  it("does nothing for skip resolutions", () => {
    const doc = makeDoc();
    const originalLength = doc.items.length;
    const resolutions: EpiclessResolution[] = [
      { featureId: "f1", action: "skip" },
    ];

    const mutated = applyEpiclessResolutions(doc, resolutions);

    expect(mutated).toBe(0);
    expect(doc.items).toHaveLength(originalLength);
  });

  it("handles mixed resolutions", () => {
    const doc: PRDDocument = {
      schema: "rex/v1",
      title: "Test",
      items: [
        { id: "e1", title: "Epic", level: "epic", status: "pending", children: [] },
        { id: "f1", title: "Feature A", level: "feature", status: "pending" },
        { id: "f2", title: "Feature B", level: "feature", status: "pending" },
        { id: "f3", title: "Feature C", level: "feature", status: "pending" },
      ],
    };

    const resolutions: EpiclessResolution[] = [
      { featureId: "f1", action: "correlate", targetEpicId: "e1" },
      { featureId: "f2", action: "delete" },
      { featureId: "f3", action: "skip" },
    ];

    const mutated = applyEpiclessResolutions(doc, resolutions);

    expect(mutated).toBe(2); // correlate + delete
    // f1 moved under e1
    const epic = doc.items.find((i) => i.id === "e1");
    expect(epic?.children?.find((c) => c.id === "f1")).toBeDefined();
    // f2 deleted
    expect(doc.items.find((i) => i.id === "f2")).toBeUndefined();
    // f3 still at root
    expect(doc.items.find((i) => i.id === "f3")).toBeDefined();
  });

  it("restores feature to root when correlation target is invalid", () => {
    const doc = makeDoc();
    const resolutions: EpiclessResolution[] = [
      { featureId: "f1", action: "correlate", targetEpicId: "nonexistent" },
    ];

    const mutated = applyEpiclessResolutions(doc, resolutions);

    expect(mutated).toBe(0);
    // Feature should still be at root (restored after failed insert)
    expect(doc.items.find((i) => i.id === "f1")).toBeDefined();
  });

  it("handles empty resolutions array", () => {
    const doc = makeDoc();
    const mutated = applyEpiclessResolutions(doc, []);
    expect(mutated).toBe(0);
  });

  it("handles correlate without targetEpicId gracefully", () => {
    const doc = makeDoc();
    const resolutions: EpiclessResolution[] = [
      { featureId: "f1", action: "correlate" }, // no targetEpicId
    ];

    const mutated = applyEpiclessResolutions(doc, resolutions);
    expect(mutated).toBe(0);
  });

  it("cleans up blockedBy references when deleting feature", () => {
    const doc: PRDDocument = {
      schema: "rex/v1",
      title: "Test",
      items: [
        {
          id: "f1",
          title: "Feature to Delete",
          level: "feature",
          status: "pending",
          children: [
            { id: "t1", title: "Task One", level: "task", status: "pending" },
          ],
        },
        {
          id: "t-other",
          title: "Dependent Task",
          level: "task",
          status: "blocked",
          blockedBy: ["t1", "some-other-ref"],
        },
      ],
    };

    const resolutions: EpiclessResolution[] = [
      { featureId: "f1", action: "delete" },
    ];

    const mutated = applyEpiclessResolutions(doc, resolutions);

    expect(mutated).toBe(1);
    expect(doc.items.find((i) => i.id === "f1")).toBeUndefined();

    // blockedBy should have t1 removed but keep some-other-ref
    const other = doc.items.find((i) => i.id === "t-other");
    expect(other?.blockedBy).toEqual(["some-other-ref"]);
  });
});
