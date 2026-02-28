import { describe, it, expect } from "vitest";
import {
  formatProposalTree,
  formatProposalSummary,
  countProposalItems,
  filterProposalsByIndex,
  parseApprovalInput,
  parseDuplicatePromptInput,
  parseGranularityInput,
  remapDuplicateMatchesForSelectedProposals,
  formatQualityWarnings,
  classifySmartAddError,
} from "../../../../src/cli/commands/smart-add.js";
import type { Proposal, QualityIssue } from "../../../../src/analyze/index.js";
import type { ProposalDuplicateMatch } from "../../../../src/cli/commands/smart-add-duplicates.js";

const singleProposal: Proposal = {
  epic: { title: "User Authentication", source: "smart-add" },
  features: [
    {
      title: "OAuth Integration",
      source: "smart-add",
      description: "Integrate with OAuth providers",
      tasks: [
        {
          title: "Implement Google OAuth",
          source: "smart-add",
          sourceFile: "",
          priority: "high",
          acceptanceCriteria: ["Login via Google works", "Token refresh handled"],
        },
        {
          title: "Implement GitHub OAuth",
          source: "smart-add",
          sourceFile: "",
          priority: "medium",
        },
      ],
    },
    {
      title: "Session Management",
      source: "smart-add",
      tasks: [
        {
          title: "Implement JWT tokens",
          source: "smart-add",
          sourceFile: "",
          priority: "critical",
          tags: ["security"],
        },
      ],
    },
  ],
};

const multiProposals: Proposal[] = [
  singleProposal,
  {
    epic: { title: "Admin Dashboard", source: "smart-add" },
    features: [
      {
        title: "User Management UI",
        source: "smart-add",
        description: "Admin panel for managing users",
        tasks: [
          {
            title: "Build user list page",
            source: "smart-add",
            sourceFile: "",
            priority: "high",
          },
        ],
      },
    ],
  },
];

describe("formatProposalTree", () => {
  it("renders a single proposal with epic icon", () => {
    const output = formatProposalTree([singleProposal]);
    expect(output).toContain("📦 User Authentication");
    expect(output).toContain("📋 OAuth Integration");
    expect(output).toContain("○ Implement Google OAuth");
    expect(output).toContain("[high]");
  });

  it("shows feature descriptions when present", () => {
    const output = formatProposalTree([singleProposal]);
    expect(output).toContain("Integrate with OAuth providers");
  });

  it("shows acceptance criteria with check marks", () => {
    const output = formatProposalTree([singleProposal]);
    expect(output).toContain("✓ Login via Google works");
    expect(output).toContain("✓ Token refresh handled");
  });

  it("renders numbered headers when multiple proposals", () => {
    const output = formatProposalTree(multiProposals);
    expect(output).toContain("1. 📦 User Authentication");
    expect(output).toContain("2. 📦 Admin Dashboard");
  });

  it("does not number when only one proposal", () => {
    const output = formatProposalTree([singleProposal]);
    expect(output).not.toMatch(/^\s*1\.\s/m);
  });

  it("uses box-drawing characters for tree branches", () => {
    const output = formatProposalTree([singleProposal]);
    expect(output).toContain("├─");
    expect(output).toContain("└─");
  });

  it("indents features deeper than epics, tasks deeper than features", () => {
    const output = formatProposalTree([singleProposal]);
    const lines = output.split("\n");
    const epicLine = lines.find((l) => l.includes("📦"))!;
    const featureLine = lines.find((l) => l.includes("📋"))!;
    const taskLine = lines.find((l) => l.includes("○ Implement"))!;

    // Feature icons are indented deeper than epic icons
    const epicIconPos = epicLine.indexOf("📦");
    const featureIconPos = featureLine.indexOf("📋");
    const taskIconPos = taskLine.indexOf("○");
    expect(featureIconPos).toBeGreaterThan(epicIconPos);
    expect(taskIconPos).toBeGreaterThan(featureIconPos);
  });

  it("hides epic when parentLevel is 'epic'", () => {
    const output = formatProposalTree([singleProposal], "epic");
    expect(output).not.toContain("📦");
    expect(output).toContain("📋 OAuth Integration");
    expect(output).toContain("○ Implement Google OAuth");
  });

  it("shows only tasks when parentLevel is 'feature'", () => {
    const output = formatProposalTree([singleProposal], "feature");
    expect(output).not.toContain("📦");
    expect(output).not.toContain("📋");
    expect(output).toContain("○ Implement Google OAuth");
    expect(output).toContain("○ Implement GitHub OAuth");
    expect(output).toContain("○ Implement JWT tokens");
  });

  it("shows subtasks when parentLevel is 'task'", () => {
    const output = formatProposalTree([singleProposal], "task");
    expect(output).not.toContain("📦");
    expect(output).not.toContain("📋");
    expect(output).toContain("○ Implement Google OAuth");
    expect(output).toContain("○ Implement JWT tokens");
  });

  it("shows task descriptions when parentLevel is 'feature'", () => {
    const proposalWithTaskDesc: Proposal = {
      epic: { title: "Epic", source: "smart-add" },
      features: [
        {
          title: "Feature",
          source: "smart-add",
          tasks: [
            {
              title: "A task",
              source: "smart-add",
              sourceFile: "",
              description: "Task description here",
              priority: "high",
            },
          ],
        },
      ],
    };
    const output = formatProposalTree([proposalWithTaskDesc], "feature");
    expect(output).toContain("Task description here");
  });

  it("uses └─ for last feature and ├─ for non-last", () => {
    const output = formatProposalTree([singleProposal]);
    const lines = output.split("\n");
    // OAuth Integration is first feature → ├─
    const oauthLine = lines.find((l) => l.includes("OAuth Integration"))!;
    expect(oauthLine).toContain("├─");
    // Session Management is last feature → └─
    const sessionLine = lines.find((l) => l.includes("Session Management"))!;
    expect(sessionLine).toContain("└─");
  });
});

describe("countProposalItems", () => {
  it("counts all items in a single proposal", () => {
    const count = countProposalItems([singleProposal]);
    // 1 epic + 2 features + 3 tasks = 6
    expect(count).toBe(6);
  });

  it("counts items across multiple proposals", () => {
    const count = countProposalItems(multiProposals);
    // First: 1 epic + 2 features + 3 tasks = 6
    // Second: 1 epic + 1 feature + 1 task = 3
    // Total = 9
    expect(count).toBe(9);
  });

  it("returns 0 for empty array", () => {
    expect(countProposalItems([])).toBe(0);
  });

  it("counts epics and features even with no tasks", () => {
    const proposal: Proposal = {
      epic: { title: "Empty Epic", source: "smart-add" },
      features: [
        { title: "Empty Feature", source: "smart-add", tasks: [] },
      ],
    };
    // 1 epic + 1 feature = 2
    expect(countProposalItems([proposal])).toBe(2);
  });

  it("excludes epic when parentLevel is 'epic'", () => {
    // features + tasks only: 2 features + 3 tasks = 5
    expect(countProposalItems([singleProposal], "epic")).toBe(5);
  });

  it("counts only tasks when parentLevel is 'feature'", () => {
    // 3 tasks across 2 features
    expect(countProposalItems([singleProposal], "feature")).toBe(3);
  });

  it("counts only tasks when parentLevel is 'task'", () => {
    // Same flat count as feature parent
    expect(countProposalItems([singleProposal], "task")).toBe(3);
  });

  it("counts across multiple proposals with parentLevel", () => {
    // epic parent: skip epics, count features + tasks
    // First: 2 features + 3 tasks = 5
    // Second: 1 feature + 1 task = 2
    // Total = 7
    expect(countProposalItems(multiProposals, "epic")).toBe(7);
  });
});

describe("filterProposalsByIndex", () => {
  it("returns all proposals when all indices selected", () => {
    const result = filterProposalsByIndex(multiProposals, [0, 1]);
    expect(result).toHaveLength(2);
    expect(result[0].epic.title).toBe("User Authentication");
    expect(result[1].epic.title).toBe("Admin Dashboard");
  });

  it("returns subset when only some indices selected", () => {
    const result = filterProposalsByIndex(multiProposals, [1]);
    expect(result).toHaveLength(1);
    expect(result[0].epic.title).toBe("Admin Dashboard");
  });

  it("returns empty array when no indices selected", () => {
    const result = filterProposalsByIndex(multiProposals, []);
    expect(result).toHaveLength(0);
  });

  it("ignores out-of-range indices", () => {
    const result = filterProposalsByIndex(multiProposals, [0, 5, 99]);
    expect(result).toHaveLength(1);
    expect(result[0].epic.title).toBe("User Authentication");
  });

  it("preserves original proposal data", () => {
    const result = filterProposalsByIndex(multiProposals, [0]);
    expect(result[0].features).toHaveLength(2);
    expect(result[0].features[0].tasks).toHaveLength(2);
  });
});

describe("parseApprovalInput", () => {
  it("returns 'all' for 'y'", () => {
    expect(parseApprovalInput("y", 3)).toBe("all");
  });

  it("returns 'all' for 'yes'", () => {
    expect(parseApprovalInput("yes", 3)).toBe("all");
  });

  it("returns 'all' for 'a' and 'all'", () => {
    expect(parseApprovalInput("a", 3)).toBe("all");
    expect(parseApprovalInput("all", 3)).toBe("all");
  });

  it("returns 'none' for 'n'", () => {
    expect(parseApprovalInput("n", 3)).toBe("none");
  });

  it("returns 'none' for 'no' and 'none'", () => {
    expect(parseApprovalInput("no", 3)).toBe("none");
    expect(parseApprovalInput("none", 3)).toBe("none");
  });

  it("returns 'none' for empty string", () => {
    expect(parseApprovalInput("", 3)).toBe("none");
  });

  it("parses comma-separated numbers as selective approval", () => {
    const result = parseApprovalInput("1,3", 3);
    expect(result).toEqual({ approved: [0, 2] }); // 1-based → 0-based
  });

  it("parses space-separated numbers", () => {
    const result = parseApprovalInput("1 2", 3);
    expect(result).toEqual({ approved: [0, 1] });
  });

  it("parses comma+space separated numbers", () => {
    const result = parseApprovalInput("1, 3", 3);
    expect(result).toEqual({ approved: [0, 2] });
  });

  it("returns 'all' when all numbers are selected", () => {
    expect(parseApprovalInput("1,2,3", 3)).toBe("all");
  });

  it("ignores out-of-range numbers", () => {
    const result = parseApprovalInput("1,5", 3);
    expect(result).toEqual({ approved: [0] });
  });

  it("returns 'none' for invalid input", () => {
    expect(parseApprovalInput("abc", 3)).toBe("none");
  });

  it("deduplicates repeated numbers", () => {
    const result = parseApprovalInput("1,1,2", 3);
    expect(result).toEqual({ approved: [0, 1] });
  });

  it("handles whitespace padding", () => {
    expect(parseApprovalInput("  y  ", 3)).toBe("all");
    expect(parseApprovalInput("  n  ", 3)).toBe("none");
  });

  it("is case-insensitive", () => {
    expect(parseApprovalInput("Y", 3)).toBe("all");
    expect(parseApprovalInput("YES", 3)).toBe("all");
    expect(parseApprovalInput("N", 3)).toBe("none");
    expect(parseApprovalInput("All", 3)).toBe("all");
  });
});

describe("parseDuplicatePromptInput", () => {
  it("defaults to cancel for empty/invalid input", () => {
    expect(parseDuplicatePromptInput("")).toBe("cancel");
    expect(parseDuplicatePromptInput("unexpected")).toBe("cancel");
  });

  it("parses cancel aliases", () => {
    expect(parseDuplicatePromptInput("c")).toBe("cancel");
    expect(parseDuplicatePromptInput("cancel")).toBe("cancel");
  });

  it("parses merge aliases", () => {
    expect(parseDuplicatePromptInput("m")).toBe("merge");
    expect(parseDuplicatePromptInput("merge")).toBe("merge");
  });

  it("parses proceed aliases", () => {
    expect(parseDuplicatePromptInput("p")).toBe("proceed");
    expect(parseDuplicatePromptInput("proceed")).toBe("proceed");
    expect(parseDuplicatePromptInput("proceed anyway")).toBe("proceed");
    expect(parseDuplicatePromptInput("force")).toBe("proceed");
  });
});

describe("remapDuplicateMatchesForSelectedProposals", () => {
  it("keeps only selected proposal matches and remaps keys to contiguous indices", () => {
    const matches: ProposalDuplicateMatch[] = [
      {
        node: { key: "p0:epic", kind: "epic", title: "A" },
        duplicate: true,
        reason: "exact_title",
        score: 1,
        matchedItem: { id: "e1", title: "A", level: "epic", status: "pending" },
      },
      {
        node: { key: "p1:feature:0", kind: "feature", title: "B" },
        duplicate: true,
        reason: "semantic_title",
        score: 0.9,
        matchedItem: { id: "f1", title: "B", level: "feature", status: "pending" },
      },
      {
        node: { key: "p2:task:0:0", kind: "task", title: "C" },
        duplicate: false,
        reason: "none",
        score: 0,
      },
    ];

    const result = remapDuplicateMatchesForSelectedProposals(matches, [2, 0]);
    expect(result).toHaveLength(2);
    expect(result[0]?.node.key).toBe("p1:epic");
    expect(result[1]?.node.key).toBe("p0:task:0:0");
  });
});

describe("formatQualityWarnings", () => {
  it("returns empty string when no issues", () => {
    expect(formatQualityWarnings([])).toBe("");
  });

  it("formats a single warning", () => {
    const issues: QualityIssue[] = [
      {
        level: "warning",
        path: 'epic:"Auth" > feature:"Login" > task:"Do"',
        message: "Task title is too short to be actionable",
      },
    ];
    const output = formatQualityWarnings(issues);
    expect(output).toContain("Quality warnings:");
    expect(output).toContain("⚠ Task title is too short to be actionable");
    expect(output).toContain('at epic:"Auth" > feature:"Login" > task:"Do"');
  });

  it("formats multiple warnings", () => {
    const issues: QualityIssue[] = [
      {
        level: "warning",
        path: 'epic:"UI"',
        message: "Epic title is too short to be descriptive",
      },
      {
        level: "warning",
        path: 'epic:"UI" > feature:"Forms"',
        message: "Feature has no tasks",
      },
    ];
    const output = formatQualityWarnings(issues);
    const lines = output.split("\n");
    expect(lines[0]).toBe("Quality warnings:");
    expect(lines.length).toBe(5); // header + 2 * (message + path)
  });

  it("uses ✗ icon for errors", () => {
    const issues: QualityIssue[] = [
      {
        level: "error",
        path: 'epic:"Broken"',
        message: "Critical structural issue",
      },
    ];
    const output = formatQualityWarnings(issues);
    expect(output).toContain("✗ Critical structural issue");
    expect(output).not.toContain("⚠");
  });

  it("uses ⚠ icon for warnings", () => {
    const issues: QualityIssue[] = [
      {
        level: "warning",
        path: 'epic:"Auth"',
        message: "Epic has no features",
      },
    ];
    const output = formatQualityWarnings(issues);
    expect(output).toContain("⚠ Epic has no features");
    expect(output).not.toContain("✗");
  });

  it("includes path on indented line below message", () => {
    const issues: QualityIssue[] = [
      {
        level: "warning",
        path: 'epic:"Backend" > feature:"API" > task:"Fix"',
        message: "Task title is too short to be actionable",
      },
    ];
    const output = formatQualityWarnings(issues);
    const lines = output.split("\n");
    // Path should be on the line after the message, indented
    const pathLine = lines.find((l) => l.includes("at epic:"));
    expect(pathLine).toBeDefined();
    expect(pathLine!.startsWith("    at ")).toBe(true);
  });
});

// ─── parseGranularityInput ───────────────────────────────────────────

describe("parseGranularityInput", () => {
  it("returns null for non-granularity input", () => {
    expect(parseGranularityInput("y", 5)).toBeNull();
    expect(parseGranularityInput("n", 5)).toBeNull();
    expect(parseGranularityInput("1,2", 5)).toBeNull();
    expect(parseGranularityInput("all", 5)).toBeNull();
    expect(parseGranularityInput("", 5)).toBeNull();
  });

  it("parses break down with single number", () => {
    const result = parseGranularityInput("b1", 5);
    expect(result).toEqual({ direction: "break_down", indices: [0] });
  });

  it("parses break down with multiple numbers", () => {
    const result = parseGranularityInput("b1,3,5", 5);
    expect(result).toEqual({ direction: "break_down", indices: [0, 2, 4] });
  });

  it("parses break down with spaces", () => {
    const result = parseGranularityInput("b 2 4", 5);
    expect(result).toEqual({ direction: "break_down", indices: [1, 3] });
  });

  it("parses 'break down' spelled out", () => {
    const result = parseGranularityInput("break down 1", 5);
    expect(result).toEqual({ direction: "break_down", indices: [0] });
  });

  it("parses 'breakdown' as one word", () => {
    const result = parseGranularityInput("breakdown 2,3", 5);
    expect(result).toEqual({ direction: "break_down", indices: [1, 2] });
  });

  it("parses consolidate with single number", () => {
    const result = parseGranularityInput("c1", 5);
    expect(result).toEqual({ direction: "consolidate", indices: [0] });
  });

  it("parses consolidate with multiple numbers", () => {
    const result = parseGranularityInput("c1,2,3", 5);
    expect(result).toEqual({ direction: "consolidate", indices: [0, 1, 2] });
  });

  it("parses 'consolidate' spelled out", () => {
    const result = parseGranularityInput("consolidate 3,5", 5);
    expect(result).toEqual({ direction: "consolidate", indices: [2, 4] });
  });

  it("ignores out-of-range numbers", () => {
    const result = parseGranularityInput("b1,99", 5);
    expect(result).toEqual({ direction: "break_down", indices: [0] });
  });

  it("returns null when all numbers out of range", () => {
    expect(parseGranularityInput("b99", 5)).toBeNull();
  });

  it("deduplicates numbers", () => {
    const result = parseGranularityInput("c1,1,2", 5);
    expect(result).toEqual({ direction: "consolidate", indices: [0, 1] });
  });

  it("is case-insensitive for command prefix", () => {
    expect(parseGranularityInput("B1", 5)).toEqual({ direction: "break_down", indices: [0] });
    expect(parseGranularityInput("C1", 5)).toEqual({ direction: "consolidate", indices: [0] });
    expect(parseGranularityInput("Break Down 1", 5)).toEqual({ direction: "break_down", indices: [0] });
    expect(parseGranularityInput("Consolidate 1", 5)).toEqual({ direction: "consolidate", indices: [0] });
  });
});

// ─── formatProposalSummary ──────────────────────────────────────────

describe("formatProposalSummary", () => {
  it("summarizes a single proposal with all levels", () => {
    const summary = formatProposalSummary([singleProposal]);
    expect(summary).toBe("1 epic, 2 features, 3 tasks");
  });

  it("summarizes multiple proposals", () => {
    const summary = formatProposalSummary(multiProposals);
    expect(summary).toBe("2 epics, 3 features, 4 tasks");
  });

  it("returns empty string for empty array", () => {
    expect(formatProposalSummary([])).toBe("");
  });

  it("excludes epics when parentLevel is 'epic'", () => {
    const summary = formatProposalSummary([singleProposal], "epic");
    expect(summary).toBe("2 features, 3 tasks");
    expect(summary).not.toContain("epic");
  });

  it("shows only tasks when parentLevel is 'feature'", () => {
    const summary = formatProposalSummary([singleProposal], "feature");
    expect(summary).toBe("3 tasks");
    expect(summary).not.toContain("epic");
    expect(summary).not.toContain("feature");
  });

  it("uses singular form for single items", () => {
    const proposal: Proposal = {
      epic: { title: "Solo", source: "smart-add" },
      features: [
        {
          title: "One Feature",
          source: "smart-add",
          tasks: [{ title: "One Task", source: "smart-add", sourceFile: "" }],
        },
      ],
    };
    const summary = formatProposalSummary([proposal]);
    expect(summary).toBe("1 epic, 1 feature, 1 task");
  });
});

// ─── classifySmartAddError ──────────────────────────────────────────

describe("classifySmartAddError", () => {
  it("classifies 401/unauthorized errors as authentication failures", () => {
    const result = classifySmartAddError(new Error("401 Unauthorized"), "description");
    expect(result.message).toContain("Authentication failed");
    expect(result.suggestion).toContain("API key");
  });

  it("classifies rate limit errors", () => {
    const result = classifySmartAddError(new Error("429 Too Many Requests"), "description");
    expect(result.message).toContain("Rate limit");
    expect(result.suggestion).toContain("Wait");
  });

  it("classifies network errors", () => {
    const result = classifySmartAddError(new Error("fetch failed: ENOTFOUND"), "description");
    expect(result.message).toContain("Network error");
    expect(result.suggestion).toContain("internet connection");
  });

  it("classifies claude CLI not found errors", () => {
    const result = classifySmartAddError(new Error("claude CLI not found"), "description");
    expect(result.message).toContain("Claude CLI not found");
    expect(result.suggestion).toContain("install");
  });

  it("classifies JSON parsing errors", () => {
    const result = classifySmartAddError(new Error("Invalid JSON in LLM response: {broken"), "description");
    expect(result.message).toContain("unparseable response");
    expect(result.suggestion).toContain("Try again");
  });

  it("classifies server overload errors", () => {
    const result = classifySmartAddError(new Error("529 Overloaded"), "description");
    expect(result.message).toContain("overloaded");
    expect(result.suggestion).toContain("retry");
  });

  it("uses mode-specific label for generic errors", () => {
    const descResult = classifySmartAddError(new Error("something unexpected"), "description");
    expect(descResult.message).toContain("analyze description");

    const fileResult = classifySmartAddError(new Error("something unexpected"), "file");
    expect(fileResult.message).toContain("process ideas file");
  });

  it("preserves original error message in generic fallback", () => {
    const result = classifySmartAddError(new Error("specific error detail"), "description");
    expect(result.message).toContain("specific error detail");
  });
});
