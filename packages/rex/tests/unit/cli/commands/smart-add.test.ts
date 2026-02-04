import { describe, it, expect } from "vitest";
import {
  formatProposalTree,
  countProposalItems,
  filterProposalsByIndex,
  parseApprovalInput,
  formatQualityWarnings,
} from "../../../../src/cli/commands/smart-add.js";
import type { Proposal, QualityIssue } from "../../../../src/analyze/index.js";

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
  it("renders a single proposal with numbered header", () => {
    const output = formatProposalTree([singleProposal]);
    expect(output).toContain("[epic] User Authentication");
    expect(output).toContain("[feature] OAuth Integration");
    expect(output).toContain("[task] Implement Google OAuth");
    expect(output).toContain("[high]");
  });

  it("shows feature descriptions when present", () => {
    const output = formatProposalTree([singleProposal]);
    expect(output).toContain("Integrate with OAuth providers");
  });

  it("shows acceptance criteria when present", () => {
    const output = formatProposalTree([singleProposal]);
    expect(output).toContain("- Login via Google works");
    expect(output).toContain("- Token refresh handled");
  });

  it("renders numbered headers when multiple proposals", () => {
    const output = formatProposalTree(multiProposals);
    expect(output).toContain("1. [epic] User Authentication");
    expect(output).toContain("2. [epic] Admin Dashboard");
  });

  it("does not number when only one proposal", () => {
    const output = formatProposalTree([singleProposal]);
    expect(output).not.toMatch(/^\s*1\.\s/m);
  });

  it("indents features and tasks correctly", () => {
    const output = formatProposalTree([singleProposal]);
    const lines = output.split("\n");
    const epicLine = lines.find((l) => l.includes("[epic]"))!;
    const featureLine = lines.find((l) => l.includes("[feature]"))!;
    const taskLine = lines.find((l) => l.includes("[task]"))!;

    // Features are indented more than epics, tasks more than features
    const epicIndent = epicLine.search(/\S/);
    const featureIndent = featureLine.search(/\S/);
    const taskIndent = taskLine.search(/\S/);
    expect(featureIndent).toBeGreaterThan(epicIndent);
    expect(taskIndent).toBeGreaterThan(featureIndent);
  });

  it("hides epic label when parentLevel is 'epic'", () => {
    const output = formatProposalTree([singleProposal], "epic");
    expect(output).not.toContain("[epic]");
    expect(output).toContain("[feature] OAuth Integration");
    expect(output).toContain("[task] Implement Google OAuth");
  });

  it("shows only tasks when parentLevel is 'feature'", () => {
    const output = formatProposalTree([singleProposal], "feature");
    expect(output).not.toContain("[epic]");
    expect(output).not.toContain("[feature]");
    expect(output).toContain("[task] Implement Google OAuth");
    expect(output).toContain("[task] Implement GitHub OAuth");
    expect(output).toContain("[task] Implement JWT tokens");
  });

  it("shows subtasks when parentLevel is 'task'", () => {
    const output = formatProposalTree([singleProposal], "task");
    expect(output).not.toContain("[epic]");
    expect(output).not.toContain("[feature]");
    expect(output).not.toContain("[task]");
    expect(output).toContain("[subtask] Implement Google OAuth");
    expect(output).toContain("[subtask] Implement JWT tokens");
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
