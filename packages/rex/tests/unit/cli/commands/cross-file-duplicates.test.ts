import { describe, expect, it } from "vitest";
import {
  matchProposalNodeToPRD,
  matchProposalNodesToPRD,
  comparePRDFileAge,
} from "../../../../src/cli/commands/smart-add-duplicates.js";
import type { ItemFileMap } from "../../../../src/cli/commands/smart-add-duplicates.js";
import type { PRDItem } from "../../../../src/schema/index.js";
import type { Proposal } from "../../../../src/analyze/index.js";
import { parsePRDFileDate } from "../../../../src/store/prd-discovery.js";

// ---------------------------------------------------------------------------
// parsePRDFileDate
// ---------------------------------------------------------------------------

describe("parsePRDFileDate", () => {
  it("extracts date from standard branch-scoped filename", () => {
    expect(parsePRDFileDate("prd_main_2024-01-15.json")).toBe("2024-01-15");
  });

  it("extracts date from filename with underscores in branch segment", () => {
    expect(parsePRDFileDate("prd_feature_auth_flow_2024-03-01.json")).toBe("2024-03-01");
  });

  it("returns null for legacy prd.json", () => {
    expect(parsePRDFileDate("prd.json")).toBeNull();
  });

  it("returns null for non-matching filenames", () => {
    expect(parsePRDFileDate("config.json")).toBeNull();
    expect(parsePRDFileDate("prd_nodate.json")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// comparePRDFileAge
// ---------------------------------------------------------------------------

describe("comparePRDFileAge", () => {
  it("legacy prd.json is oldest", () => {
    expect(comparePRDFileAge("prd.json", "prd_main_2024-01-01.json")).toBeLessThan(0);
    expect(comparePRDFileAge("prd_main_2024-01-01.json", "prd.json")).toBeGreaterThan(0);
  });

  it("two legacy prd.json compare equal", () => {
    expect(comparePRDFileAge("prd.json", "prd.json")).toBe(0);
  });

  it("older date sorts before newer date", () => {
    expect(comparePRDFileAge("prd_a_2024-01-15.json", "prd_b_2024-03-01.json")).toBeLessThan(0);
    expect(comparePRDFileAge("prd_b_2024-03-01.json", "prd_a_2024-01-15.json")).toBeGreaterThan(0);
  });

  it("same date compares equal", () => {
    expect(comparePRDFileAge("prd_a_2024-01-15.json", "prd_b_2024-01-15.json")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Cross-file duplicate matching
// ---------------------------------------------------------------------------

describe("cross-file duplicate detection", () => {
  const olderFile = "prd_main_2024-01-15.json";
  const newerFile = "prd_feature-auth_2024-06-01.json";

  it("prefers match from older file when both score above threshold", () => {
    const existing: PRDItem[] = [
      {
        id: "task-older",
        title: "Implement user authentication",
        level: "task",
        status: "pending",
      },
      {
        id: "task-newer",
        title: "Implement user authentication",
        level: "task",
        status: "pending",
      },
    ];

    const itemFileMap: ItemFileMap = new Map([
      ["task-older", olderFile],
      ["task-newer", newerFile],
    ]);

    const result = matchProposalNodeToPRD(
      {
        key: "p0:task:0:0",
        kind: "task",
        title: "Implement user authentication",
      },
      existing,
      itemFileMap,
    );

    expect(result.duplicate).toBe(true);
    expect(result.matchedItem?.id).toBe("task-older");
    expect(result.matchedItem?.sourceFile).toBe(olderFile);
  });

  it("prefers older file even when newer file has slightly higher score", () => {
    // The older item has a less precise title, but older-file preference wins
    const existing: PRDItem[] = [
      {
        id: "task-older",
        title: "Implement OAuth callback handler",
        level: "task",
        status: "pending",
        description: "Handle the OAuth callback endpoint for user authentication.",
      },
      {
        id: "task-newer",
        title: "Implement OAuth callback handler for user auth",
        level: "task",
        status: "pending",
        description: "Handle the OAuth callback endpoint for user authentication flow.",
      },
    ];

    const itemFileMap: ItemFileMap = new Map([
      ["task-older", olderFile],
      ["task-newer", newerFile],
    ]);

    const result = matchProposalNodeToPRD(
      {
        key: "p0:task:0:0",
        kind: "task",
        title: "Implement OAuth callback handler for user auth",
        description: "Handle the OAuth callback endpoint for user authentication flow.",
      },
      existing,
      itemFileMap,
    );

    expect(result.duplicate).toBe(true);
    expect(result.matchedItem?.id).toBe("task-older");
    expect(result.matchedItem?.sourceFile).toBe(olderFile);
  });

  it("treats legacy prd.json as oldest file", () => {
    const existing: PRDItem[] = [
      {
        id: "task-legacy",
        title: "Build authentication system",
        level: "task",
        status: "pending",
      },
      {
        id: "task-branch",
        title: "Build authentication system",
        level: "task",
        status: "pending",
      },
    ];

    const itemFileMap: ItemFileMap = new Map([
      ["task-legacy", "prd.json"],
      ["task-branch", "prd_main_2024-01-15.json"],
    ]);

    const result = matchProposalNodeToPRD(
      {
        key: "p0:task:0:0",
        kind: "task",
        title: "Build authentication system",
      },
      existing,
      itemFileMap,
    );

    expect(result.duplicate).toBe(true);
    expect(result.matchedItem?.id).toBe("task-legacy");
    expect(result.matchedItem?.sourceFile).toBe("prd.json");
  });

  it("falls back to highest score without itemFileMap (backward compat)", () => {
    const existing: PRDItem[] = [
      {
        id: "task-1",
        title: "Implement user authentication",
        level: "task",
        status: "pending",
      },
    ];

    const result = matchProposalNodeToPRD(
      {
        key: "p0:task:0:0",
        kind: "task",
        title: "Implement user authentication",
      },
      existing,
    );

    expect(result.duplicate).toBe(true);
    expect(result.matchedItem?.id).toBe("task-1");
    expect(result.matchedItem?.sourceFile).toBeUndefined();
  });

  it("returns sourceFile in matchedItem when itemFileMap is provided", () => {
    const existing: PRDItem[] = [
      {
        id: "epic-1",
        title: "User Authentication",
        level: "epic",
        status: "pending",
      },
    ];

    const itemFileMap: ItemFileMap = new Map([
      ["epic-1", olderFile],
    ]);

    const result = matchProposalNodeToPRD(
      {
        key: "p0:epic",
        kind: "epic",
        title: "User Authentication",
      },
      existing,
      itemFileMap,
    );

    expect(result.duplicate).toBe(true);
    expect(result.matchedItem?.sourceFile).toBe(olderFile);
  });

  it("non-duplicate proposals have no sourceFile", () => {
    const existing: PRDItem[] = [
      {
        id: "task-1",
        title: "Set up OAuth callback endpoint",
        level: "task",
        status: "pending",
      },
    ];

    const itemFileMap: ItemFileMap = new Map([
      ["task-1", olderFile],
    ]);

    const result = matchProposalNodeToPRD(
      {
        key: "p0:task:0:0",
        kind: "task",
        title: "Create invoice export CSV pipeline",
      },
      existing,
      itemFileMap,
    );

    expect(result.duplicate).toBe(false);
    expect(result.matchedItem).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// matchProposalNodesToPRD with cross-file context
// ---------------------------------------------------------------------------

describe("matchProposalNodesToPRD with itemFileMap", () => {
  it("passes itemFileMap through to all node matches", () => {
    const olderFile = "prd_main_2024-01-15.json";
    const newerFile = "prd_feature-auth_2024-06-01.json";

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
        id: "epic-older",
        title: "Auth Platform",
        level: "epic",
        status: "pending",
        children: [
          {
            id: "feature-older",
            title: "OAuth Integration",
            level: "feature",
            status: "pending",
            children: [
              {
                id: "task-older",
                title: "Implement Google OAuth",
                level: "task",
                status: "pending",
              },
            ],
          },
        ],
      },
      {
        id: "epic-newer",
        title: "Auth Platform",
        level: "epic",
        status: "pending",
        children: [
          {
            id: "feature-newer",
            title: "OAuth Integration",
            level: "feature",
            status: "pending",
            children: [
              {
                id: "task-newer",
                title: "Implement Google OAuth",
                level: "task",
                status: "pending",
              },
            ],
          },
        ],
      },
    ];

    const itemFileMap: ItemFileMap = new Map([
      ["epic-older", olderFile],
      ["feature-older", olderFile],
      ["task-older", olderFile],
      ["epic-newer", newerFile],
      ["feature-newer", newerFile],
      ["task-newer", newerFile],
    ]);

    const matches = matchProposalNodesToPRD(proposals, existing, itemFileMap);

    expect(matches).toHaveLength(3);
    expect(matches.every((m) => m.duplicate)).toBe(true);

    // All matches should prefer the older file
    for (const match of matches) {
      expect(match.matchedItem?.sourceFile).toBe(olderFile);
      expect(match.matchedItem?.id).toMatch(/-older$/);
    }
  });

  it("handles single candidate without file map (backward compat)", () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "Auth Platform", source: "smart-add" },
        features: [],
      },
    ];

    const existing: PRDItem[] = [
      {
        id: "epic-1",
        title: "Auth Platform",
        level: "epic",
        status: "pending",
      },
    ];

    const matches = matchProposalNodesToPRD(proposals, existing);

    expect(matches).toHaveLength(1);
    expect(matches[0].duplicate).toBe(true);
    expect(matches[0].matchedItem?.id).toBe("epic-1");
    expect(matches[0].matchedItem?.sourceFile).toBeUndefined();
  });
});
