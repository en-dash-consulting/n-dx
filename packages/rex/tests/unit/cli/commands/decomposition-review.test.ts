import { describe, it, expect } from "vitest";
import type { Proposal, ProposalTask, TaskDecomposition } from "../../../../src/analyze/index.js";
import {
  formatDecomposedTask,
  formatProposalsWithDecomposition,
  countDecomposedTasks,
  applyDecompositionChoice,
  resolveDecompositions,
  autoResolveDecompositions,
  parseDecompositionInput,
  formatDecompositionSummary,
} from "../../../../src/cli/commands/decomposition-review.js";

// ─── Helpers ─────────────────────────────────────────────────────────

function makeTask(overrides: Partial<ProposalTask> = {}): ProposalTask {
  return {
    title: "Implement auth",
    source: "test",
    sourceFile: "src/auth.ts",
    description: "Build auth flow",
    priority: "high",
    loe: 4,
    loeRationale: "Complex feature",
    loeConfidence: "medium",
    ...overrides,
  };
}

function makeDecomposedTask(overrides: Partial<ProposalTask> = {}): ProposalTask {
  return makeTask({
    decomposition: {
      children: [
        makeTask({ title: "Child A", loe: 1.5, description: "First child" }),
        makeTask({ title: "Child B", loe: 2, description: "Second child" }),
      ],
      thresholdWeeks: 2,
    },
    ...overrides,
  });
}

function makeProposal(
  title: string,
  tasks: ProposalTask[],
): Proposal {
  return {
    epic: { title, source: "test" },
    features: [
      {
        title: `${title} Feature`,
        source: "test",
        tasks,
      },
    ],
  };
}

// ─── formatDecomposedTask ────────────────────────────────────────────

describe("formatDecomposedTask", () => {
  it("shows LoE threshold annotation", () => {
    const task = makeDecomposedTask();
    const output = formatDecomposedTask(task, "Feature A");

    expect(output).toContain("LoE: 4w > 2w threshold");
  });

  it("shows the parent task title", () => {
    const task = makeDecomposedTask();
    const output = formatDecomposedTask(task, "Feature A");

    expect(output).toContain("[task] Implement auth");
  });

  it("shows children indented with arrow", () => {
    const task = makeDecomposedTask();
    const output = formatDecomposedTask(task, "Feature A");

    expect(output).toContain("↳ Child A");
    expect(output).toContain("↳ Child B");
  });

  it("shows child LoE values", () => {
    const task = makeDecomposedTask();
    const output = formatDecomposedTask(task, "Feature A");

    expect(output).toContain("(LoE: 1.5w)");
    expect(output).toContain("(LoE: 2w)");
  });

  it("shows child count", () => {
    const task = makeDecomposedTask();
    const output = formatDecomposedTask(task, "Feature A");

    expect(output).toContain("2 child tasks");
  });

  it("returns empty string for non-decomposed task", () => {
    const task = makeTask();
    expect(formatDecomposedTask(task, "Feature A")).toBe("");
  });

  it("handles task without LoE", () => {
    const task = makeDecomposedTask({ loe: undefined });
    const output = formatDecomposedTask(task, "Feature A");

    expect(output).toContain("LoE: ? > 2w threshold");
  });

  it("uses singular for single child", () => {
    const task = makeDecomposedTask({
      decomposition: {
        children: [makeTask({ title: "Only child", loe: 1 })],
        thresholdWeeks: 2,
      },
    });
    const output = formatDecomposedTask(task, "Feature A");

    expect(output).toContain("1 child task:");
    expect(output).not.toContain("1 child tasks");
  });
});

// ─── formatProposalsWithDecomposition ────────────────────────────────

describe("formatProposalsWithDecomposition", () => {
  it("shows decomposed tasks with threshold annotation", () => {
    const proposals = [
      makeProposal("Auth", [makeDecomposedTask()]),
    ];

    const output = formatProposalsWithDecomposition(proposals);

    expect(output).toContain("[epic] Auth");
    expect(output).toContain("⚡ decomposed (LoE: 4w > 2w threshold)");
    expect(output).toContain("↳ Child A");
    expect(output).toContain("↳ Child B");
  });

  it("shows non-decomposed tasks normally", () => {
    const proposals = [
      makeProposal("Auth", [makeTask({ title: "Normal task" })]),
    ];

    const output = formatProposalsWithDecomposition(proposals);

    expect(output).toContain("[task] Normal task [high] (from: src/auth.ts)");
    expect(output).not.toContain("⚡");
  });

  it("handles mix of decomposed and normal tasks", () => {
    const proposals = [
      makeProposal("Auth", [
        makeTask({ title: "Normal task" }),
        makeDecomposedTask({ title: "Big task" }),
      ]),
    ];

    const output = formatProposalsWithDecomposition(proposals);

    expect(output).toContain("[task] Normal task [high] (from: src/auth.ts)");
    expect(output).toContain("[task] Big task [high] ⚡ decomposed");
    expect(output).toContain("↳ Child A");
  });
});

// ─── countDecomposedTasks ────────────────────────────────────────────

describe("countDecomposedTasks", () => {
  it("returns 0 for proposals without decomposition", () => {
    const proposals = [makeProposal("Auth", [makeTask()])];
    expect(countDecomposedTasks(proposals)).toBe(0);
  });

  it("counts decomposed tasks across features and proposals", () => {
    const proposals = [
      makeProposal("Auth", [makeDecomposedTask(), makeTask()]),
      makeProposal("API", [makeDecomposedTask(), makeDecomposedTask()]),
    ];
    expect(countDecomposedTasks(proposals)).toBe(3);
  });
});

// ─── applyDecompositionChoice ────────────────────────────────────────

describe("applyDecompositionChoice", () => {
  it("accept_decomposed returns children", () => {
    const task = makeDecomposedTask();
    const result = applyDecompositionChoice(task, "accept_decomposed");

    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("Child A");
    expect(result[1].title).toBe("Child B");
  });

  it("keep_original returns task without decomposition", () => {
    const task = makeDecomposedTask();
    const result = applyDecompositionChoice(task, "keep_original");

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Implement auth");
    expect(result[0].decomposition).toBeUndefined();
  });

  it("skip returns empty array", () => {
    const task = makeDecomposedTask();
    const result = applyDecompositionChoice(task, "skip");

    expect(result).toHaveLength(0);
  });

  it("non-decomposed task is returned as-is for any choice", () => {
    const task = makeTask();
    const result = applyDecompositionChoice(task, "accept_decomposed");

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(task);
  });
});

// ─── resolveDecompositions ───────────────────────────────────────────

describe("resolveDecompositions", () => {
  it("replaces decomposed tasks with children when chooser returns accept_decomposed", async () => {
    const proposals = [
      makeProposal("Auth", [
        makeDecomposedTask({ title: "Big task" }),
        makeTask({ title: "Normal task" }),
      ]),
    ];

    const result = await resolveDecompositions(proposals, () => "accept_decomposed");

    const tasks = result.proposals[0].features[0].tasks;
    expect(tasks).toHaveLength(3); // 2 children + 1 normal
    expect(tasks[0].title).toBe("Child A");
    expect(tasks[1].title).toBe("Child B");
    expect(tasks[2].title).toBe("Normal task");
  });

  it("keeps original when chooser returns keep_original", async () => {
    const proposals = [
      makeProposal("Auth", [makeDecomposedTask({ title: "Big task" })]),
    ];

    const result = await resolveDecompositions(proposals, () => "keep_original");

    const tasks = result.proposals[0].features[0].tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Big task");
    expect(tasks[0].decomposition).toBeUndefined();
  });

  it("removes task when chooser returns skip", async () => {
    const proposals = [
      makeProposal("Auth", [
        makeDecomposedTask({ title: "Big task" }),
        makeTask({ title: "Normal task" }),
      ]),
    ];

    const result = await resolveDecompositions(proposals, () => "skip");

    const tasks = result.proposals[0].features[0].tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Normal task");
  });

  it("tracks summary correctly", async () => {
    const choices: Record<string, "accept_decomposed" | "keep_original" | "skip"> = {
      "Task 1": "accept_decomposed",
      "Task 2": "keep_original",
      "Task 3": "skip",
    };

    const proposals = [
      makeProposal("Mixed", [
        makeDecomposedTask({ title: "Task 1" }),
        makeDecomposedTask({ title: "Task 2" }),
        makeDecomposedTask({ title: "Task 3" }),
      ]),
    ];

    const result = await resolveDecompositions(
      proposals,
      (task) => choices[task.title] ?? "accept_decomposed",
    );

    expect(result.summary.total).toBe(3);
    expect(result.summary.acceptedDecomposed).toBe(1);
    expect(result.summary.keptOriginal).toBe(1);
    expect(result.summary.skipped).toBe(1);
  });

  it("passes non-decomposed tasks through unchanged", async () => {
    const normalTask = makeTask({ title: "Normal" });
    const proposals = [makeProposal("Auth", [normalTask])];

    const result = await resolveDecompositions(proposals, () => "accept_decomposed");

    expect(result.proposals[0].features[0].tasks).toHaveLength(1);
    expect(result.proposals[0].features[0].tasks[0].title).toBe("Normal");
    expect(result.summary.total).toBe(0);
  });

  it("provides feature and epic context to chooser", async () => {
    const captured: Array<{ feature: string; epic: string }> = [];

    const proposals: Proposal[] = [{
      epic: { title: "My Epic", source: "test" },
      features: [{
        title: "My Feature",
        source: "test",
        tasks: [makeDecomposedTask()],
      }],
    }];

    await resolveDecompositions(proposals, (_task, feature, epic) => {
      captured.push({ feature, epic });
      return "accept_decomposed";
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].feature).toBe("My Feature");
    expect(captured[0].epic).toBe("My Epic");
  });
});

// ─── autoResolveDecompositions ───────────────────────────────────────

describe("autoResolveDecompositions", () => {
  it("accepts all decomposed versions by default", async () => {
    const proposals = [
      makeProposal("Auth", [
        makeDecomposedTask({ title: "Big task" }),
        makeTask({ title: "Normal" }),
      ]),
    ];

    const result = await autoResolveDecompositions(proposals);

    const tasks = result.proposals[0].features[0].tasks;
    expect(tasks).toHaveLength(3); // 2 children + 1 normal
    expect(tasks[0].title).toBe("Child A");
    expect(tasks[1].title).toBe("Child B");
    expect(tasks[2].title).toBe("Normal");
    expect(result.summary.acceptedDecomposed).toBe(1);
    expect(result.summary.keptOriginal).toBe(0);
    expect(result.summary.skipped).toBe(0);
  });

  it("handles proposals with no decompositions", async () => {
    const proposals = [makeProposal("Auth", [makeTask()])];
    const result = await autoResolveDecompositions(proposals);

    expect(result.proposals).toEqual(proposals);
    expect(result.summary.total).toBe(0);
  });
});

// ─── parseDecompositionInput ─────────────────────────────────────────

describe("parseDecompositionInput", () => {
  it.each([
    ["d", "accept_decomposed"],
    ["decomposed", "accept_decomposed"],
    ["accept", "accept_decomposed"],
    ["y", "accept_decomposed"],
    ["yes", "accept_decomposed"],
    ["D", "accept_decomposed"],
    ["  d  ", "accept_decomposed"],
  ] as const)("parses '%s' as accept_decomposed", (input, expected) => {
    expect(parseDecompositionInput(input)).toBe(expected);
  });

  it.each([
    ["k", "keep_original"],
    ["keep", "keep_original"],
    ["original", "keep_original"],
    ["K", "keep_original"],
  ] as const)("parses '%s' as keep_original", (input, expected) => {
    expect(parseDecompositionInput(input)).toBe(expected);
  });

  it.each([
    ["s", "skip"],
    ["skip", "skip"],
    ["n", "skip"],
    ["no", "skip"],
    ["S", "skip"],
  ] as const)("parses '%s' as skip", (input, expected) => {
    expect(parseDecompositionInput(input)).toBe(expected);
  });

  it("returns null for invalid input", () => {
    expect(parseDecompositionInput("")).toBeNull();
    expect(parseDecompositionInput("xyz")).toBeNull();
    expect(parseDecompositionInput("accept all")).toBeNull();
  });
});

// ─── formatDecompositionSummary ──────────────────────────────────────

describe("formatDecompositionSummary", () => {
  it("returns empty string for zero total", () => {
    expect(formatDecompositionSummary({
      total: 0,
      acceptedDecomposed: 0,
      keptOriginal: 0,
      skipped: 0,
    })).toBe("");
  });

  it("shows all categories when mixed", () => {
    const output = formatDecompositionSummary({
      total: 3,
      acceptedDecomposed: 1,
      keptOriginal: 1,
      skipped: 1,
    });

    expect(output).toContain("1 decomposed");
    expect(output).toContain("1 kept original");
    expect(output).toContain("1 skipped");
    expect(output).toContain("3 total");
  });

  it("omits zero categories", () => {
    const output = formatDecompositionSummary({
      total: 2,
      acceptedDecomposed: 2,
      keptOriginal: 0,
      skipped: 0,
    });

    expect(output).toContain("2 decomposed");
    expect(output).not.toContain("kept original");
    expect(output).not.toContain("skipped");
  });
});
