import { describe, expect, it } from "vitest";
import {
  buildDuplicateOverrideMarker,
  buildDuplicateOverrideMarkerIndex,
  buildDuplicateReasonMetadata,
  attachDuplicateReasonsToProposals,
  matchProposalNodeToPRD,
  matchProposalNodesToPRD,
} from "../../../../src/cli/commands/smart-add-duplicates.js";
import type { PRDItem } from "../../../../src/schema/index.js";
import type { Proposal } from "../../../../src/analyze/index.js";

describe("matchProposalNodeToPRD", () => {
  it("returns duplicate match with referenced id for an existing open item", () => {
    const existing: PRDItem[] = [
      {
        id: "task-open-1",
        title: "Implement OAuth callback handler",
        level: "task",
        status: "in_progress",
      },
    ];

    const result = matchProposalNodeToPRD(
      {
        key: "p0:task:0:0",
        kind: "task",
        title: "Implement OAuth callback handler",
      },
      existing,
    );

    expect(result.duplicate).toBe(true);
    expect(result.matchedItem?.id).toBe("task-open-1");
    expect(result.matchedItem?.status).toBe("in_progress");
  });

  it("returns duplicate match with completed status context", () => {
    const existing: PRDItem[] = [
      {
        id: "epic-done-1",
        title: "User Authentication",
        level: "epic",
        status: "completed",
        children: [
          {
            id: "feature-done-1",
            title: "OAuth Integration",
            level: "feature",
            status: "completed",
            children: [
              {
                id: "task-done-1",
                title: "Implement Google OAuth",
                level: "task",
                status: "completed",
              },
            ],
          },
        ],
      },
    ];

    const result = matchProposalNodeToPRD(
      {
        key: "p0:task:0:0",
        kind: "task",
        title: "Implement Google OAuth",
      },
      existing,
    );

    expect(result.duplicate).toBe(true);
    expect(result.matchedItem?.id).toBe("task-done-1");
    expect(result.matchedItem?.status).toBe("completed");
  });

  it("returns non-duplicate when there is no meaningful overlap", () => {
    const existing: PRDItem[] = [
      {
        id: "task-1",
        title: "Set up OAuth callback endpoint",
        level: "task",
        status: "pending",
      },
    ];

    const result = matchProposalNodeToPRD(
      {
        key: "p0:task:0:0",
        kind: "task",
        title: "Create invoice export CSV pipeline",
        description: "Build finance export pipeline for monthly reports.",
      },
      existing,
    );

    expect(result.duplicate).toBe(false);
    expect(result.matchedItem).toBeUndefined();
    expect(result.reason).toBe("none");
  });
});

describe("matchProposalNodesToPRD", () => {
  it("matches nested proposal nodes against nested PRD hierarchy", () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "Auth Platform", source: "smart-add" },
        features: [
          {
            title: "OAuth Integration",
            source: "smart-add",
            tasks: [
              {
                title: "Implement Google OAuth",
                source: "smart-add",
                sourceFile: "",
              },
            ],
          },
        ],
      },
    ];

    const existing: PRDItem[] = [
      {
        id: "epic-1",
        title: "Auth Platform",
        level: "epic",
        status: "pending",
        children: [
          {
            id: "feature-1",
            title: "OAuth Integration",
            level: "feature",
            status: "pending",
            children: [
              {
                id: "task-1",
                title: "Implement Google OAuth",
                level: "task",
                status: "completed",
              },
            ],
          },
        ],
      },
    ];

    const matches = matchProposalNodesToPRD(proposals, existing);

    expect(matches).toHaveLength(3);
    expect(matches.every((m) => m.duplicate)).toBe(true);
    expect(matches.some((m) => m.matchedItem?.id === "task-1")).toBe(true);
    expect(matches.some((m) => m.matchedItem?.status === "completed")).toBe(true);
  });
});

describe("buildDuplicateOverrideMarker", () => {
  it("builds marker metadata for duplicate matches", () => {
    const marker = buildDuplicateOverrideMarker(
      {
        node: {
          key: "p0:task:0:0",
          kind: "task",
          title: "Implement Google OAuth",
        },
        duplicate: true,
        reason: "exact_title",
        score: 1,
        matchedItem: {
          id: "task-1",
          title: "Implement Google OAuth",
          level: "task",
          status: "completed",
        },
      },
      "2026-02-22T20:30:44.000Z",
    );

    expect(marker).toEqual({
      type: "duplicate_guard_override",
      reason: "exact_title",
      reasonRef: "exact_title:task-1",
      matchedItemId: "task-1",
      matchedItemTitle: "Implement Google OAuth",
      matchedItemLevel: "task",
      matchedItemStatus: "completed",
      createdAt: "2026-02-22T20:30:44.000Z",
    });
  });

  it("returns undefined for non-duplicate matches", () => {
    const marker = buildDuplicateOverrideMarker(
      {
        node: {
          key: "p0:task:0:0",
          kind: "task",
          title: "Create invoice export CSV pipeline",
        },
        duplicate: false,
        reason: "none",
        score: 0,
      },
      "2026-02-22T20:30:44.000Z",
    );

    expect(marker).toBeUndefined();
  });
});

describe("buildDuplicateOverrideMarkerIndex", () => {
  it("indexes only duplicate matches keyed by proposal node", () => {
    const markers = buildDuplicateOverrideMarkerIndex(
      [
        {
          node: {
            key: "p0:task:0:0",
            kind: "task",
            title: "Implement Google OAuth",
          },
          duplicate: true,
          reason: "semantic_title",
          score: 0.95,
          matchedItem: {
            id: "task-1",
            title: "Implement Google OAuth",
            level: "task",
            status: "pending",
          },
        },
        {
          node: {
            key: "p0:task:0:1",
            kind: "task",
            title: "Build CSV export",
          },
          duplicate: false,
          reason: "none",
          score: 0,
        },
      ],
      "2026-02-22T20:30:44.000Z",
    );

    expect(Object.keys(markers)).toEqual(["p0:task:0:0"]);
    expect(markers["p0:task:0:0"]?.reasonRef).toBe("semantic_title:task-1");
  });
});

describe("buildDuplicateReasonMetadata", () => {
  it("returns exact title reason metadata for active-item matches", () => {
    const reason = buildDuplicateReasonMetadata({
      node: { key: "p0:task:0:0", kind: "task", title: "Implement Google OAuth" },
      duplicate: true,
      reason: "exact_title",
      score: 1,
      matchedItem: {
        id: "task-1",
        title: "Implement Google OAuth",
        level: "task",
        status: "pending",
      },
    });

    expect(reason).toEqual({
      type: "exact_title_match",
      matchedItem: {
        id: "task-1",
        title: "Implement Google OAuth",
        level: "task",
        status: "pending",
      },
      explanation: 'Exact title match with existing task "Implement Google OAuth".',
    });
  });

  it("returns completed-item match context when matched item is completed", () => {
    const reason = buildDuplicateReasonMetadata({
      node: { key: "p0:task:0:0", kind: "task", title: "Implement Google OAuth" },
      duplicate: true,
      reason: "semantic_title",
      score: 0.91,
      matchedItem: {
        id: "task-done-1",
        title: "Implement Google OAuth",
        level: "task",
        status: "completed",
      },
    });

    expect(reason?.type).toBe("completed_item_match");
    expect(reason?.explanation).toBe('Matches completed task "Implement Google OAuth".');
  });

  it("returns undefined for non-duplicate matches", () => {
    const reason = buildDuplicateReasonMetadata({
      node: { key: "p0:task:0:0", kind: "task", title: "Brand new task" },
      duplicate: false,
      reason: "none",
      score: 0,
    });

    expect(reason).toBeUndefined();
  });
});

describe("attachDuplicateReasonsToProposals", () => {
  it("attaches reasons only to duplicate nodes", () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "Auth Platform", source: "smart-add" },
        features: [
          {
            title: "OAuth Integration",
            source: "smart-add",
            tasks: [
              {
                title: "Implement Google OAuth",
                source: "smart-add",
                sourceFile: "",
              },
              {
                title: "Build monthly billing export",
                source: "smart-add",
                sourceFile: "",
              },
            ],
          },
        ],
      },
    ];

    const matches = matchProposalNodesToPRD(proposals, [
      {
        id: "task-1",
        title: "Implement Google OAuth",
        level: "task",
        status: "completed",
      },
    ]);

    const enriched = attachDuplicateReasonsToProposals(proposals, matches);

    expect(enriched[0].features[0].tasks[0]?.duplicateReason).toEqual({
      type: "completed_item_match",
      matchedItem: {
        id: "task-1",
        title: "Implement Google OAuth",
        level: "task",
        status: "completed",
      },
      explanation: 'Matches completed task "Implement Google OAuth".',
    });
    expect(enriched[0].features[0].tasks[1]?.duplicateReason).toBeUndefined();
    expect(enriched[0].epic.duplicateReason).toBeUndefined();
    expect(enriched[0].features[0]?.duplicateReason).toBeUndefined();
  });
});
