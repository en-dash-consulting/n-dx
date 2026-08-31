import { describe, it, expect } from "vitest";
import {
  buildBreakdownPrompt,
  buildConsolidatePrompt,
} from "../../../src/analyze/reason.js";
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

// ─── buildBreakdownPrompt ────────────────────────────────────────────

describe("buildBreakdownPrompt", () => {
  it("includes the proposal JSON in the prompt", () => {
    const proposals = [makeProposal("User Auth")];
    const prompt = buildBreakdownPrompt(proposals);

    expect(prompt).toContain('"title":"User Auth"');
    expect(prompt).toContain("Feature 1 of User Auth");
    expect(prompt).toContain("Task 1 for User Auth F1");
  });

  it("instructs to break down into finer-grained tasks", () => {
    const proposals = [makeProposal("Auth")];
    const prompt = buildBreakdownPrompt(proposals);

    expect(prompt.toLowerCase()).toContain("break down");
    expect(prompt).toContain("finer-grained");
    expect(prompt).toContain("2-4 smaller");
  });

  it("instructs to preserve epic and feature structure", () => {
    const proposals = [makeProposal("Auth")];
    const prompt = buildBreakdownPrompt(proposals);

    expect(prompt).toContain("Preserve the epic and feature structure");
    expect(prompt).toContain("do NOT change epic or feature titles");
  });

  it("instructs to preserve original intent", () => {
    const proposals = [makeProposal("Auth")];
    const prompt = buildBreakdownPrompt(proposals);

    // Must instruct to preserve original acceptance criteria
    expect(prompt).toContain("original acceptance criteria");
    expect(prompt).toMatch(/do not lose|distribute|preserve/i);
  });

  it("instructs not to add new functionality", () => {
    const proposals = [makeProposal("Auth")];
    const prompt = buildBreakdownPrompt(proposals);

    expect(prompt).toContain("Do NOT add entirely new functionality");
  });

  it("includes few-shot example", () => {
    const proposals = [makeProposal("Auth")];
    const prompt = buildBreakdownPrompt(proposals);

    expect(prompt).toContain("Example output");
  });

  it("instructs to respond with JSON only", () => {
    const proposals = [makeProposal("Auth")];
    const prompt = buildBreakdownPrompt(proposals);

    expect(prompt).toContain("ONLY a valid, minified JSON array");
  });

  it("handles multiple proposals", () => {
    const proposals = [makeProposal("Auth"), makeProposal("Dashboard")];
    const prompt = buildBreakdownPrompt(proposals);

    expect(prompt).toContain('"title":"Auth"');
    expect(prompt).toContain('"title":"Dashboard"');
  });
});

// ─── buildConsolidatePrompt ──────────────────────────────────────────

describe("buildConsolidatePrompt", () => {
  it("includes the proposal JSON in the prompt", () => {
    const proposals = [makeProposal("User Auth", 2, 3)];
    const prompt = buildConsolidatePrompt(proposals);

    expect(prompt).toContain('"title":"User Auth"');
    expect(prompt).toContain("Feature 1 of User Auth");
    expect(prompt).toContain("Task 1 for User Auth F1");
  });

  it("instructs to consolidate into coarser-grained tasks", () => {
    const proposals = [makeProposal("Auth")];
    const prompt = buildConsolidatePrompt(proposals);

    expect(prompt).toContain("consolidate");
    expect(prompt).toContain("coarser-grained");
    expect(prompt).toContain("reduce the total task count");
  });

  it("instructs to merge related tasks", () => {
    const proposals = [makeProposal("Auth")];
    const prompt = buildConsolidatePrompt(proposals);

    expect(prompt).toContain("Merge related tasks");
    expect(prompt).toContain("merged acceptance criteria");
  });

  it("instructs to preserve epic structure", () => {
    const proposals = [makeProposal("Auth")];
    const prompt = buildConsolidatePrompt(proposals);

    expect(prompt).toContain("Preserve the epic structure");
    expect(prompt).toContain("do NOT change epic titles");
  });

  it("instructs not to remove functionality", () => {
    const proposals = [makeProposal("Auth")];
    const prompt = buildConsolidatePrompt(proposals);

    expect(prompt).toContain("Do NOT remove functionality");
  });

  it("includes few-shot example", () => {
    const proposals = [makeProposal("Auth")];
    const prompt = buildConsolidatePrompt(proposals);

    expect(prompt).toContain("Example output");
  });

  it("instructs to respond with JSON only", () => {
    const proposals = [makeProposal("Auth")];
    const prompt = buildConsolidatePrompt(proposals);

    expect(prompt).toContain("ONLY a valid, minified JSON array");
  });
});
