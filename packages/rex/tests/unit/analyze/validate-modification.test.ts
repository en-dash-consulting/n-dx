import { describe, it, expect } from "vitest";
import {
  validateModificationRequest,
  classifyModificationRequest,
} from "../../../src/analyze/validate-modification.js";
import type { Proposal } from "../../../src/analyze/propose.js";

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

// ─── validateModificationRequest ──────────────────────────────────

describe("validateModificationRequest", () => {
  it("rejects empty requests", () => {
    const result = validateModificationRequest("", [makeProposal("Auth")]);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/empty|provide/i);
    expect(result.suggestion).toBeDefined();
  });

  it("rejects whitespace-only requests", () => {
    const result = validateModificationRequest("   \n\t  ", [makeProposal("Auth")]);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/empty|provide/i);
  });

  it("rejects single-word requests as too vague", () => {
    const result = validateModificationRequest("change", [makeProposal("Auth")]);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/vague|specific/i);
    expect(result.suggestion).toBeDefined();
  });

  it("rejects very short requests (two words) as too vague", () => {
    const result = validateModificationRequest("fix it", [makeProposal("Auth")]);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/vague|specific/i);
  });

  it("accepts specific modification requests", () => {
    const result = validateModificationRequest(
      "Rename the Auth epic to User Authentication and add a password reset feature",
      [makeProposal("Auth")],
    );
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("accepts requests with action verbs and targets", () => {
    const result = validateModificationRequest(
      "Remove the login task and split signup into separate steps",
      [makeProposal("Auth")],
    );
    expect(result.valid).toBe(true);
  });

  it("accepts requests that reference proposal content", () => {
    const result = validateModificationRequest(
      "Change priority of Task 1 for Auth F1 to high",
      [makeProposal("Auth")],
    );
    expect(result.valid).toBe(true);
  });

  it("provides a suggestion for ambiguous requests", () => {
    const result = validateModificationRequest(
      "make better",
      [makeProposal("Auth")],
    );
    expect(result.valid).toBe(false);
    expect(result.suggestion).toMatch(/try|example|specific/i);
  });

  it("accepts medium-length specific requests", () => {
    const result = validateModificationRequest(
      "Add a caching layer feature to the Auth epic",
      [makeProposal("Auth")],
    );
    expect(result.valid).toBe(true);
  });

  it("accepts requests that describe structural changes", () => {
    const result = validateModificationRequest(
      "Merge the two features into a single feature with all their tasks",
      [makeProposal("Auth", 2, 3)],
    );
    expect(result.valid).toBe(true);
  });

  it("rejects empty proposals gracefully", () => {
    const result = validateModificationRequest(
      "Add a new feature for caching",
      [],
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/no proposals/i);
  });
});

// ─── classifyModificationRequest ──────────────────────────────────

describe("classifyModificationRequest", () => {
  it("classifies addition requests", () => {
    const result = classifyModificationRequest("Add a new feature for error handling");
    expect(result.intent).toBe("add");
  });

  it("classifies removal requests", () => {
    const result = classifyModificationRequest("Remove the login task");
    expect(result.intent).toBe("remove");
  });

  it("classifies modification requests", () => {
    const result = classifyModificationRequest("Change the priority of auth tasks to high");
    expect(result.intent).toBe("modify");
  });

  it("classifies restructuring requests", () => {
    const result = classifyModificationRequest("Split the Auth epic into Login and Signup epics");
    expect(result.intent).toBe("restructure");
  });

  it("classifies renaming requests as modify", () => {
    const result = classifyModificationRequest("Rename the epic from Auth to User Authentication");
    expect(result.intent).toBe("modify");
  });

  it("returns unknown for truly ambiguous inputs", () => {
    const result = classifyModificationRequest("yes");
    expect(result.intent).toBe("unknown");
  });

  it("classifies consolidation requests as restructure", () => {
    const result = classifyModificationRequest("Merge the two features together");
    expect(result.intent).toBe("restructure");
  });

  it("identifies the target when referencing specific items", () => {
    const result = classifyModificationRequest("Remove the OAuth2 feature");
    expect(result.target).toMatch(/OAuth2/i);
  });

  it("handles mixed case", () => {
    const result = classifyModificationRequest("DELETE the old authentication tasks");
    expect(result.intent).toBe("remove");
  });
});
