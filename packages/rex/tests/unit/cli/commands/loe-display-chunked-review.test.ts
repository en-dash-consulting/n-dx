import { describe, it, expect } from "vitest";
import {
  createReviewState,
  formatChunk,
} from "../../../../src/cli/commands/chunked-review-state.js";
import type { Proposal, ProposalTask } from "../../../../src/cli/commands/chunked-review-types.js";

// ─── Helpers ──────────────────────────────────────────────────────────

function makeTask(overrides: Partial<ProposalTask> = {}): ProposalTask {
  return {
    title: "Implement widget",
    source: "test",
    sourceFile: "src/widget.ts",
    priority: "medium",
    ...overrides,
  };
}

function makeProposal(tasks: ProposalTask[]): Proposal {
  return {
    epic: { title: "Widget System", source: "test" },
    features: [
      {
        title: "Widget Feature",
        source: "test",
        tasks,
      },
    ],
  };
}

// ─── formatChunk — LoE display ──────────────────────────────────────

describe("formatChunk LoE display", () => {
  it("shows LoE for tasks with loe data", () => {
    const proposals = [
      makeProposal([
        makeTask({ title: "Build API", loe: 1.5, loeRationale: "Standard REST endpoints" }),
      ]),
    ];
    const state = createReviewState(proposals, 5, 2);
    const output = formatChunk(state);

    expect(output).toContain("Build API");
    expect(output).toContain("(LoE: 1.5w)");
    expect(output).toContain("LoE rationale: Standard REST endpoints");
  });

  it("flags tasks exceeding threshold", () => {
    const proposals = [
      makeProposal([
        makeTask({ title: "Large task", loe: 4 }),
      ]),
    ];
    const state = createReviewState(proposals, 5, 2);
    const output = formatChunk(state);

    expect(output).toContain("4w");
    expect(output).toContain("exceeds 2w threshold");
  });

  it("does not flag tasks at or below threshold", () => {
    const proposals = [
      makeProposal([
        makeTask({ title: "Normal task", loe: 2 }),
      ]),
    ];
    const state = createReviewState(proposals, 5, 2);
    const output = formatChunk(state);

    expect(output).toContain("(LoE: 2w)");
    expect(output).not.toContain("exceeds");
  });

  it("displays cleanly when no LoE data", () => {
    const proposals = [
      makeProposal([
        makeTask({ title: "No LoE task" }),
      ]),
    ];
    const state = createReviewState(proposals, 5, 2);
    const output = formatChunk(state);

    expect(output).toContain("No LoE task");
    expect(output).not.toContain("LoE:");
    expect(output).not.toContain("undefined");
    expect(output).not.toContain("null");
  });

  it("shows rationale with confidence when available", () => {
    const proposals = [
      makeProposal([
        makeTask({
          title: "With confidence",
          loe: 1,
          loeRationale: "Well understood",
          loeConfidence: "high",
        }),
      ]),
    ];
    const state = createReviewState(proposals, 5, 2);
    const output = formatChunk(state);

    expect(output).toContain("LoE rationale: Well understood [high]");
  });

  it("omits rationale line when no rationale provided", () => {
    const proposals = [
      makeProposal([
        makeTask({ title: "Just loe", loe: 0.5 }),
      ]),
    ];
    const state = createReviewState(proposals, 5, 2);
    const output = formatChunk(state);

    expect(output).toContain("(LoE: 0.5w)");
    expect(output).not.toContain("LoE rationale:");
  });

  it("shows LoE without threshold parameter", () => {
    const proposals = [
      makeProposal([
        makeTask({ title: "No threshold", loe: 5 }),
      ]),
    ];
    const state = createReviewState(proposals, 5); // no thresholdWeeks
    const output = formatChunk(state);

    expect(output).toContain("(LoE: 5w)");
    expect(output).not.toContain("exceeds");
  });

  it("preserves thresholdWeeks through createReviewState", () => {
    const proposals = [makeProposal([makeTask({ loe: 3 })])];
    const state = createReviewState(proposals, 5, 2);
    expect(state.thresholdWeeks).toBe(2);
  });
});
