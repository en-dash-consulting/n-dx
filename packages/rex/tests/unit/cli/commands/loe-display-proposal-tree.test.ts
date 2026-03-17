import { describe, it, expect } from "vitest";
import { formatProposalTree } from "../../../../src/cli/commands/smart-add.js";
import type { Proposal, ProposalTask } from "../../../../src/analyze/index.js";

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

// ─── formatProposalTree — LoE display ────────────────────────────────

describe("formatProposalTree LoE display", () => {
  it("shows LoE for tasks with loe data", () => {
    const proposals = [
      makeProposal([
        makeTask({ title: "Build API", loe: 1.5, loeRationale: "Standard REST endpoints" }),
      ]),
    ];
    const output = formatProposalTree(proposals, undefined, 2);

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
    const output = formatProposalTree(proposals, undefined, 2);

    expect(output).toContain("4w");
    expect(output).toContain("exceeds 2w threshold");
  });

  it("displays cleanly when no LoE data", () => {
    const proposals = [
      makeProposal([
        makeTask({ title: "No LoE task" }),
      ]),
    ];
    const output = formatProposalTree(proposals, undefined, 2);

    expect(output).toContain("No LoE task");
    expect(output).not.toContain("LoE:");
    expect(output).not.toContain("undefined");
    expect(output).not.toContain("null");
  });

  it("shows LoE in feature-parent mode", () => {
    const proposals = [
      makeProposal([
        makeTask({ title: "Under feature", loe: 0.5 }),
      ]),
    ];
    const output = formatProposalTree(proposals, "feature", 2);

    expect(output).toContain("Under feature");
    expect(output).toContain("(LoE: 0.5w)");
  });

  it("shows LoE in task-parent mode", () => {
    const proposals = [
      makeProposal([
        makeTask({ title: "Subtask item", loe: 0.25 }),
      ]),
    ];
    const output = formatProposalTree(proposals, "task", 2);

    expect(output).toContain("Subtask item");
    expect(output).toContain("(LoE: 0.25w)");
  });

  it("works without threshold", () => {
    const proposals = [
      makeProposal([
        makeTask({ title: "No threshold", loe: 5 }),
      ]),
    ];
    const output = formatProposalTree(proposals);

    expect(output).toContain("(LoE: 5w)");
    expect(output).not.toContain("exceeds");
  });

  it("handles mix of tasks with and without LoE", () => {
    const proposals = [
      makeProposal([
        makeTask({ title: "With LoE", loe: 1, loeRationale: "Reason" }),
        makeTask({ title: "Without LoE" }),
        makeTask({ title: "Over threshold", loe: 5 }),
      ]),
    ];
    const output = formatProposalTree(proposals, undefined, 2);

    // Task with LoE shows it
    expect(output).toContain("With LoE");
    expect(output).toContain("(LoE: 1w)");
    expect(output).toContain("LoE rationale: Reason");

    // Task without LoE is clean
    const lines = output.split("\n");
    const withoutLoeLine = lines.find((l) => l.includes("Without LoE"));
    expect(withoutLoeLine).toBeDefined();
    expect(withoutLoeLine).not.toContain("LoE:");

    // Over-threshold task is flagged
    expect(output).toContain("Over threshold");
    expect(output).toContain("exceeds 2w threshold");
  });
});
