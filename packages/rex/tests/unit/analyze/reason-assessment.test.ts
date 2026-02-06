import { describe, it, expect } from "vitest";
import {
  buildAssessmentPrompt,
  parseAssessmentResponse,
  formatAssessment,
} from "../../../src/analyze/reason.js";
import type { Proposal } from "../../../src/analyze/propose.js";
import type { GranularityAssessment } from "../../../src/analyze/reason.js";

function makeProposal(title: string, featureCount = 1, taskCount = 2): Proposal {
  const features = [];
  for (let f = 0; f < featureCount; f++) {
    const tasks = [];
    for (let t = 0; t < taskCount; t++) {
      tasks.push({
        title: `Task ${t + 1} for ${title} F${f + 1}`,
        source: "test",
        sourceFile: "test.ts",
        description: `Description for task ${t + 1}`,
        acceptanceCriteria: [`Criterion ${t + 1}`],
        priority: "medium" as const,
        tags: ["test"],
      });
    }
    features.push({
      title: `Feature ${f + 1} of ${title}`,
      source: "test",
      description: `Feature ${f + 1} description`,
      tasks,
    });
  }
  return {
    epic: { title, source: "test", description: `${title} description` },
    features,
  };
}

// ─── buildAssessmentPrompt ───────────────────────────────────────────

describe("buildAssessmentPrompt", () => {
  it("includes the proposal JSON with proposalIndex in the prompt", () => {
    const proposals = [makeProposal("User Auth")];
    const prompt = buildAssessmentPrompt(proposals);

    expect(prompt).toContain('"proposalIndex": 0');
    expect(prompt).toContain('"title": "User Auth"');
    expect(prompt).toContain("Feature 1 of User Auth");
    expect(prompt).toContain("Task 1 for User Auth F1");
  });

  it("instructs to assess granularity", () => {
    const proposals = [makeProposal("Auth")];
    const prompt = buildAssessmentPrompt(proposals);

    expect(prompt).toContain("assess");
    expect(prompt).toContain("granularity");
  });

  it("defines the three recommendation options", () => {
    const proposals = [makeProposal("Auth")];
    const prompt = buildAssessmentPrompt(proposals);

    expect(prompt).toContain('"break_down"');
    expect(prompt).toContain('"consolidate"');
    expect(prompt).toContain('"keep"');
  });

  it("includes assessment criteria for task sizing", () => {
    const proposals = [makeProposal("Auth")];
    const prompt = buildAssessmentPrompt(proposals);

    expect(prompt).toContain("single unit of work");
    expect(prompt).toContain("acceptance criteria");
    expect(prompt).toContain("independently testable");
  });

  it("provides example response format", () => {
    const proposals = [makeProposal("Auth")];
    const prompt = buildAssessmentPrompt(proposals);

    expect(prompt).toContain('"recommendation"');
    expect(prompt).toContain('"reasoning"');
    expect(prompt).toContain('"issues"');
  });

  it("instructs to respond with JSON only", () => {
    const proposals = [makeProposal("Auth")];
    const prompt = buildAssessmentPrompt(proposals);

    expect(prompt).toContain("ONLY");
    expect(prompt).toContain("JSON array");
  });

  it("handles multiple proposals with correct indices", () => {
    const proposals = [makeProposal("Auth"), makeProposal("Dashboard")];
    const prompt = buildAssessmentPrompt(proposals);

    expect(prompt).toContain('"proposalIndex": 0');
    expect(prompt).toContain('"proposalIndex": 1');
    expect(prompt).toContain('"title": "Auth"');
    expect(prompt).toContain('"title": "Dashboard"');
  });
});

// ─── parseAssessmentResponse ─────────────────────────────────────────

describe("parseAssessmentResponse", () => {
  const proposals = [
    makeProposal("User Auth"),
    makeProposal("Dashboard"),
  ];

  it("parses a valid assessment response", () => {
    const raw = JSON.stringify([
      {
        proposalIndex: 0,
        recommendation: "break_down",
        reasoning: "Tasks are too broad.",
        issues: ["Task covers too many areas"],
      },
      {
        proposalIndex: 1,
        recommendation: "keep",
        reasoning: "Tasks are well-sized.",
        issues: [],
      },
    ]);

    const result = parseAssessmentResponse(raw, proposals);
    expect(result).toHaveLength(2);
    expect(result[0].recommendation).toBe("break_down");
    expect(result[0].epicTitle).toBe("User Auth");
    expect(result[0].reasoning).toBe("Tasks are too broad.");
    expect(result[0].issues).toEqual(["Task covers too many areas"]);
    expect(result[1].recommendation).toBe("keep");
    expect(result[1].epicTitle).toBe("Dashboard");
  });

  it("parses consolidate recommendation", () => {
    const raw = JSON.stringify([
      {
        proposalIndex: 0,
        recommendation: "consolidate",
        reasoning: "Too many small tasks.",
        issues: ["Multiple tasks would naturally be done together"],
      },
    ]);

    const result = parseAssessmentResponse(raw, proposals);
    expect(result[0].recommendation).toBe("consolidate");
    expect(result[0].issues).toHaveLength(1);
  });

  it("enriches with epic title from proposals", () => {
    const raw = JSON.stringify([
      {
        proposalIndex: 1,
        recommendation: "keep",
        reasoning: "Fine.",
        issues: [],
      },
    ]);

    const result = parseAssessmentResponse(raw, proposals);
    expect(result[0].epicTitle).toBe("Dashboard");
  });

  it("handles out-of-range proposalIndex gracefully", () => {
    const raw = JSON.stringify([
      {
        proposalIndex: 99,
        recommendation: "keep",
        reasoning: "Fine.",
        issues: [],
      },
    ]);

    const result = parseAssessmentResponse(raw, proposals);
    expect(result[0].epicTitle).toBe("Proposal 100");
  });

  it("handles response with markdown fences", () => {
    const json = JSON.stringify([
      {
        proposalIndex: 0,
        recommendation: "keep",
        reasoning: "Good size.",
        issues: [],
      },
    ]);
    const raw = `\`\`\`json\n${json}\n\`\`\``;

    const result = parseAssessmentResponse(raw, proposals);
    expect(result).toHaveLength(1);
    expect(result[0].recommendation).toBe("keep");
  });

  it("handles response with leading prose", () => {
    const json = JSON.stringify([
      {
        proposalIndex: 0,
        recommendation: "break_down",
        reasoning: "Too broad.",
        issues: ["Issue 1"],
      },
    ]);
    const raw = `Here is the assessment:\n${json}`;

    const result = parseAssessmentResponse(raw, proposals);
    expect(result).toHaveLength(1);
    expect(result[0].recommendation).toBe("break_down");
  });

  it("throws on invalid JSON", () => {
    expect(() => parseAssessmentResponse("not json", proposals)).toThrow(
      "Invalid JSON",
    );
  });

  it("throws on invalid schema", () => {
    const raw = JSON.stringify([{ bad: "data" }]);
    expect(() => parseAssessmentResponse(raw, proposals)).toThrow(
      "schema validation",
    );
  });

  it("uses lenient fallback for partially valid responses", () => {
    const raw = JSON.stringify([
      {
        proposalIndex: 0,
        recommendation: "keep",
        reasoning: "Fine.",
        issues: [],
      },
      { bad: "data" },
    ]);

    const result = parseAssessmentResponse(raw, proposals);
    expect(result).toHaveLength(1);
    expect(result[0].recommendation).toBe("keep");
  });
});

// ─── formatAssessment ────────────────────────────────────────────────

describe("formatAssessment", () => {
  it("formats empty assessments", () => {
    const result = formatAssessment([]);
    expect(result).toBe("No proposals to assess.");
  });

  it("formats break_down recommendations", () => {
    const assessments: GranularityAssessment[] = [
      {
        proposalIndex: 0,
        epicTitle: "User Auth",
        recommendation: "break_down",
        reasoning: "Tasks are too broad.",
        issues: ["Task 1 covers too many areas", "Task 2 is vague"],
      },
    ];

    const result = formatAssessment(assessments);
    expect(result).toContain("Granularity Assessment");
    expect(result).toContain("User Auth");
    expect(result).toContain("Break down");
    expect(result).toContain("Tasks are too broad.");
    expect(result).toContain("• Task 1 covers too many areas");
    expect(result).toContain("• Task 2 is vague");
  });

  it("formats consolidate recommendations", () => {
    const assessments: GranularityAssessment[] = [
      {
        proposalIndex: 0,
        epicTitle: "Config",
        recommendation: "consolidate",
        reasoning: "Too granular.",
        issues: ["Tasks are trivially small"],
      },
    ];

    const result = formatAssessment(assessments);
    expect(result).toContain("Config");
    expect(result).toContain("Consolidate");
    expect(result).toContain("Too granular.");
  });

  it("formats keep recommendations separately", () => {
    const assessments: GranularityAssessment[] = [
      {
        proposalIndex: 0,
        epicTitle: "User Auth",
        recommendation: "keep",
        reasoning: "Good size.",
        issues: [],
      },
    ];

    const result = formatAssessment(assessments);
    expect(result).toContain("✓ Appropriately sized: User Auth");
  });

  it("formats mixed recommendations", () => {
    const assessments: GranularityAssessment[] = [
      {
        proposalIndex: 0,
        epicTitle: "Auth",
        recommendation: "break_down",
        reasoning: "Too broad.",
        issues: ["Broad task"],
      },
      {
        proposalIndex: 1,
        epicTitle: "Config",
        recommendation: "keep",
        reasoning: "Fine.",
        issues: [],
      },
      {
        proposalIndex: 2,
        epicTitle: "Logging",
        recommendation: "consolidate",
        reasoning: "Too small.",
        issues: ["Trivial tasks"],
      },
    ];

    const result = formatAssessment(assessments);

    // Actionable items shown first
    expect(result).toContain("Auth");
    expect(result).toContain("Break down");
    expect(result).toContain("Logging");
    expect(result).toContain("Consolidate");
    // Keep items at end
    expect(result).toContain("✓ Appropriately sized: Config");
  });

  it("lists multiple keep recommendations together", () => {
    const assessments: GranularityAssessment[] = [
      {
        proposalIndex: 0,
        epicTitle: "Auth",
        recommendation: "keep",
        reasoning: "Fine.",
        issues: [],
      },
      {
        proposalIndex: 1,
        epicTitle: "Dashboard",
        recommendation: "keep",
        reasoning: "Good.",
        issues: [],
      },
    ];

    const result = formatAssessment(assessments);
    expect(result).toContain("✓ Appropriately sized: Auth, Dashboard");
  });
});
