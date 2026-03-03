import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProposalTask } from "../../../src/analyze/propose.js";
import type { Proposal } from "../../../src/analyze/propose.js";
import {
  buildDecompositionPrompt,
  parseDecompositionResponse,
  applyDecompositionPass,
} from "../../../src/analyze/decompose.js";

// ─── Helpers ──────────────────────────────────────────────────────────

function makeTask(overrides: Partial<ProposalTask> = {}): ProposalTask {
  return {
    title: "Implement authentication system",
    source: "test",
    sourceFile: "src/auth.ts",
    description: "Build the full auth flow",
    acceptanceCriteria: ["Login works", "Logout works"],
    priority: "high",
    tags: ["auth"],
    loe: 4,
    loeRationale: "Large feature spanning multiple components",
    loeConfidence: "medium",
    ...overrides,
  };
}

function makeProposal(
  title: string,
  tasks: ProposalTask[],
): Proposal {
  return {
    epic: { title, source: "test", description: `${title} epic` },
    features: [
      {
        title: `${title} Feature`,
        source: "test",
        description: `Feature for ${title}`,
        tasks,
      },
    ],
  };
}

// ─── buildDecompositionPrompt ─────────────────────────────────────────

describe("buildDecompositionPrompt", () => {
  it("includes the task JSON in the prompt", () => {
    const task = makeTask();
    const prompt = buildDecompositionPrompt(task, 2);

    expect(prompt).toContain('"title": "Implement authentication system"');
    expect(prompt).toContain('"loe": 4');
  });

  it("includes the threshold in the prompt", () => {
    const task = makeTask();
    const prompt = buildDecompositionPrompt(task, 2);

    expect(prompt).toContain("threshold of 2 engineer-weeks");
  });

  it("uses singular for threshold of 1", () => {
    const task = makeTask();
    const prompt = buildDecompositionPrompt(task, 1);

    expect(prompt).toContain("threshold of 1 engineer-week");
    // The threshold-specific lines should use singular form
    expect(prompt).toContain("at or below 1 engineer-week.");
  });

  it("instructs to produce LoE fields on children", () => {
    const task = makeTask();
    const prompt = buildDecompositionPrompt(task, 2);

    expect(prompt).toContain('"loe"');
    expect(prompt).toContain('"loeRationale"');
    expect(prompt).toContain('"loeConfidence"');
  });

  it("instructs children to be at or below threshold", () => {
    const task = makeTask();
    const prompt = buildDecompositionPrompt(task, 2);

    expect(prompt).toContain("at or below 2 engineer-weeks");
  });

  it("instructs to produce 2-5 child tasks", () => {
    const task = makeTask();
    const prompt = buildDecompositionPrompt(task, 2);

    expect(prompt).toContain("2-5 child tasks");
  });

  it("instructs to preserve parent priority", () => {
    const task = makeTask({ priority: "critical" });
    const prompt = buildDecompositionPrompt(task, 2);

    expect(prompt).toContain("critical");
  });

  it("mentions the parent LoE in the prompt", () => {
    const task = makeTask({ loe: 6 });
    const prompt = buildDecompositionPrompt(task, 2);

    expect(prompt).toContain("6 weeks");
  });

  it("instructs to respond with JSON only", () => {
    const task = makeTask();
    const prompt = buildDecompositionPrompt(task, 2);

    expect(prompt).toContain("ONLY a valid JSON array");
  });

  it("instructs not to add new functionality", () => {
    const task = makeTask();
    const prompt = buildDecompositionPrompt(task, 2);

    expect(prompt).toContain("Do NOT add entirely new functionality");
  });
});

// ─── parseDecompositionResponse ───────────────────────────────────────

describe("parseDecompositionResponse", () => {
  const parent = makeTask();

  it("parses a valid JSON response", () => {
    const response = JSON.stringify([
      {
        title: "Implement login flow",
        description: "Handle user login",
        acceptanceCriteria: ["Login works"],
        priority: "high",
        loe: 1,
        loeRationale: "Focused scope",
        loeConfidence: "high",
      },
      {
        title: "Implement logout flow",
        description: "Handle user logout",
        acceptanceCriteria: ["Logout works"],
        priority: "high",
        loe: 1,
        loeRationale: "Simple handler",
        loeConfidence: "high",
      },
    ]);

    const result = parseDecompositionResponse(response, parent);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("Implement login flow");
    expect(result[0].loe).toBe(1);
    expect(result[0].loeRationale).toBe("Focused scope");
    expect(result[0].loeConfidence).toBe("high");
  });

  it("inherits source and sourceFile from parent", () => {
    const response = JSON.stringify([
      {
        title: "Child task",
        description: "A child",
        loe: 1,
      },
    ]);

    const result = parseDecompositionResponse(response, parent);
    expect(result[0].source).toBe(parent.source);
    expect(result[0].sourceFile).toBe(parent.sourceFile);
  });

  it("handles markdown-fenced JSON", () => {
    const response = "```json\n" + JSON.stringify([
      { title: "Child", description: "Desc", loe: 1 },
    ]) + "\n```";

    const result = parseDecompositionResponse(response, parent);
    expect(result).toHaveLength(1);
  });

  it("throws on completely invalid JSON", () => {
    expect(() =>
      parseDecompositionResponse("not json at all", parent),
    ).toThrow();
  });

  it("uses lenient fallback for partially valid arrays", () => {
    const response = JSON.stringify([
      { title: "Valid child", description: "Desc", loe: 1 },
      { invalid: true }, // Missing required 'title'
    ]);

    const result = parseDecompositionResponse(response, parent);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Valid child");
  });

  it("accepts children without optional LoE fields", () => {
    const response = JSON.stringify([
      { title: "Simple child", description: "Just a title and desc" },
    ]);

    const result = parseDecompositionResponse(response, parent);
    expect(result).toHaveLength(1);
    expect(result[0].loe).toBeUndefined();
    expect(result[0].loeRationale).toBeUndefined();
    expect(result[0].loeConfidence).toBeUndefined();
  });
});

// ─── applyDecompositionPass ───────────────────────────────────────────

// Mock spawnClaude to avoid real LLM calls
vi.mock("../../../src/analyze/reason.js", async () => {
  const actual = await vi.importActual<typeof import("../../../src/analyze/reason.js")>(
    "../../../src/analyze/reason.js",
  );
  return {
    ...actual,
    spawnClaude: vi.fn(),
  };
});

describe("applyDecompositionPass", () => {
  let spawnClaudeMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const reason = await import("../../../src/analyze/reason.js");
    spawnClaudeMock = reason.spawnClaude as unknown as ReturnType<typeof vi.fn>;
    spawnClaudeMock.mockReset();
  });

  it("returns proposals unchanged when no tasks exceed threshold", async () => {
    const proposals = [
      makeProposal("Auth", [
        makeTask({ loe: 1 }),
        makeTask({ loe: 2 }),
      ]),
    ];

    const result = await applyDecompositionPass(proposals, { taskThresholdWeeks: 2 });

    expect(result.proposals).toEqual(proposals);
    expect(result.decomposed).toHaveLength(0);
    expect(result.tokenUsage.calls).toBe(0);
    expect(spawnClaudeMock).not.toHaveBeenCalled();
  });

  it("returns proposals unchanged when tasks have no LoE", async () => {
    const proposals = [
      makeProposal("Auth", [
        makeTask({ loe: undefined }),
      ]),
    ];

    const result = await applyDecompositionPass(proposals, { taskThresholdWeeks: 2 });

    expect(result.proposals).toEqual(proposals);
    expect(result.decomposed).toHaveLength(0);
  });

  it("decomposes tasks exceeding the threshold", async () => {
    const childResponse = JSON.stringify([
      { title: "Child 1", description: "First child", loe: 1.5, loeRationale: "Small scope", loeConfidence: "high" },
      { title: "Child 2", description: "Second child", loe: 1, loeRationale: "Tiny", loeConfidence: "high" },
    ]);

    spawnClaudeMock.mockResolvedValueOnce({
      text: childResponse,
      tokenUsage: { input: 100, output: 50 },
    });

    const proposals = [
      makeProposal("Auth", [
        makeTask({ title: "Big task", loe: 4 }),
        makeTask({ title: "Small task", loe: 1 }),
      ]),
    ];

    const result = await applyDecompositionPass(proposals, { taskThresholdWeeks: 2 });

    // Big task should be annotated with decomposition (not replaced)
    const tasks = result.proposals[0].features[0].tasks;
    expect(tasks).toHaveLength(2); // annotated big task + small task
    expect(tasks[0].title).toBe("Big task");
    expect(tasks[0].decomposition).toBeDefined();
    expect(tasks[0].decomposition!.children).toHaveLength(2);
    expect(tasks[0].decomposition!.children[0].title).toBe("Child 1");
    expect(tasks[0].decomposition!.children[1].title).toBe("Child 2");
    expect(tasks[0].decomposition!.thresholdWeeks).toBe(2);
    expect(tasks[1].title).toBe("Small task");
    expect(tasks[1].decomposition).toBeUndefined();

    expect(result.decomposed).toHaveLength(1);
    expect(result.decomposed[0].original.title).toBe("Big task");
    expect(result.decomposed[0].children).toHaveLength(2);
    expect(result.decomposed[0].depth).toBe(0);

    expect(result.tokenUsage.calls).toBe(1);
    expect(result.tokenUsage.inputTokens).toBe(100);
    expect(result.tokenUsage.outputTokens).toBe(50);
  });

  it("respects configurable threshold", async () => {
    const childResponse = JSON.stringify([
      { title: "Child 1", description: "Desc", loe: 2, loeRationale: "R", loeConfidence: "medium" },
    ]);

    spawnClaudeMock.mockResolvedValueOnce({
      text: childResponse,
      tokenUsage: { input: 100, output: 50 },
    });

    const proposals = [
      makeProposal("Auth", [
        makeTask({ title: "Medium task", loe: 3 }),
      ]),
    ];

    // With threshold of 3, the task should NOT be decomposed
    const result3 = await applyDecompositionPass(proposals, { taskThresholdWeeks: 3 });
    expect(result3.decomposed).toHaveLength(0);

    // With threshold of 2, the task SHOULD be decomposed
    const result2 = await applyDecompositionPass(proposals, { taskThresholdWeeks: 2 });
    expect(result2.decomposed).toHaveLength(1);
  });

  it("uses default threshold of 2 when no config provided", async () => {
    const childResponse = JSON.stringify([
      { title: "Child", description: "Desc", loe: 1 },
    ]);

    spawnClaudeMock.mockResolvedValueOnce({
      text: childResponse,
      tokenUsage: { input: 100, output: 50 },
    });

    const proposals = [
      makeProposal("Auth", [
        makeTask({ title: "Big task", loe: 3 }), // > 2 (default threshold)
      ]),
    ];

    const result = await applyDecompositionPass(proposals);
    expect(result.decomposed).toHaveLength(1);
  });

  it("caps recursion at maxDecompositionDepth", async () => {
    // First call: child still exceeds threshold
    const firstChildResponse = JSON.stringify([
      { title: "Still-big child", description: "Still large", loe: 3, loeRationale: "R", loeConfidence: "low" },
    ]);

    // Second call: final children at or below threshold
    const secondChildResponse = JSON.stringify([
      { title: "Grandchild 1", description: "Small", loe: 1, loeRationale: "R", loeConfidence: "high" },
      { title: "Grandchild 2", description: "Small", loe: 1, loeRationale: "R", loeConfidence: "high" },
    ]);

    spawnClaudeMock
      .mockResolvedValueOnce({ text: firstChildResponse, tokenUsage: { input: 100, output: 50 } })
      .mockResolvedValueOnce({ text: secondChildResponse, tokenUsage: { input: 100, output: 50 } });

    const proposals = [
      makeProposal("Auth", [
        makeTask({ title: "Huge task", loe: 6 }),
      ]),
    ];

    const result = await applyDecompositionPass(proposals, {
      taskThresholdWeeks: 2,
      maxDecompositionDepth: 2,
    });

    // Two decompositions: original → child → grandchildren
    expect(result.decomposed).toHaveLength(2);
    expect(result.decomposed[0].depth).toBe(0);
    expect(result.decomposed[1].depth).toBe(1);

    // Task should be annotated with nested decomposition
    const tasks = result.proposals[0].features[0].tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Huge task");
    expect(tasks[0].decomposition).toBeDefined();
    // The child is itself annotated with further decomposition
    const children = tasks[0].decomposition!.children;
    expect(children).toHaveLength(1);
    expect(children[0].title).toBe("Still-big child");
    expect(children[0].decomposition).toBeDefined();
    expect(children[0].decomposition!.children).toHaveLength(2);
    expect(children[0].decomposition!.children[0].title).toBe("Grandchild 1");
  });

  it("stops recursion at depth limit even if children still exceed threshold", async () => {
    // Only one decomposition call — child still exceeds but depth limit = 1
    const childResponse = JSON.stringify([
      { title: "Still-big child", description: "Still large", loe: 5, loeRationale: "R", loeConfidence: "low" },
    ]);

    spawnClaudeMock.mockResolvedValueOnce({
      text: childResponse,
      tokenUsage: { input: 100, output: 50 },
    });

    const proposals = [
      makeProposal("Auth", [
        makeTask({ title: "Huge task", loe: 8 }),
      ]),
    ];

    const result = await applyDecompositionPass(proposals, {
      taskThresholdWeeks: 2,
      maxDecompositionDepth: 1,
    });

    // Only one decomposition at depth 0 — should not recurse further
    expect(result.decomposed).toHaveLength(1);
    expect(spawnClaudeMock).toHaveBeenCalledTimes(1);

    // Task should be annotated with decomposition, child should NOT be further decomposed
    const tasks = result.proposals[0].features[0].tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Huge task");
    expect(tasks[0].decomposition).toBeDefined();
    expect(tasks[0].decomposition!.children).toHaveLength(1);
    expect(tasks[0].decomposition!.children[0].title).toBe("Still-big child");
    expect(tasks[0].decomposition!.children[0].decomposition).toBeUndefined();
  });

  it("preserves proposals with mixed tasks (some over, some under threshold)", async () => {
    const childResponse = JSON.stringify([
      { title: "Child A", description: "Desc", loe: 1 },
      { title: "Child B", description: "Desc", loe: 1 },
    ]);

    spawnClaudeMock.mockResolvedValueOnce({
      text: childResponse,
      tokenUsage: { input: 100, output: 50 },
    });

    const proposals = [
      makeProposal("Mixed", [
        makeTask({ title: "Small task", loe: 1 }),
        makeTask({ title: "Big task", loe: 4 }),
        makeTask({ title: "Medium task", loe: 2 }),
      ]),
    ];

    const result = await applyDecompositionPass(proposals, { taskThresholdWeeks: 2 });

    // Small stays, Big is annotated, Medium stays
    const tasks = result.proposals[0].features[0].tasks;
    expect(tasks).toHaveLength(3); // 1 + 1 annotated + 1
    expect(tasks[0].title).toBe("Small task");
    expect(tasks[0].decomposition).toBeUndefined();
    expect(tasks[1].title).toBe("Big task");
    expect(tasks[1].decomposition).toBeDefined();
    expect(tasks[1].decomposition!.children[0].title).toBe("Child A");
    expect(tasks[1].decomposition!.children[1].title).toBe("Child B");
    expect(tasks[2].title).toBe("Medium task");
    expect(tasks[2].decomposition).toBeUndefined();
  });

  it("handles multiple features in a single proposal", async () => {
    const childResponse = JSON.stringify([
      { title: "Child", description: "Desc", loe: 1 },
    ]);

    spawnClaudeMock.mockResolvedValueOnce({
      text: childResponse,
      tokenUsage: { input: 100, output: 50 },
    });

    const proposals: Proposal[] = [{
      epic: { title: "Multi-feature", source: "test" },
      features: [
        {
          title: "Feature 1",
          source: "test",
          tasks: [makeTask({ title: "F1 big task", loe: 4 })],
        },
        {
          title: "Feature 2",
          source: "test",
          tasks: [makeTask({ title: "F2 small task", loe: 1 })],
        },
      ],
    }];

    const result = await applyDecompositionPass(proposals, { taskThresholdWeeks: 2 });

    // Feature 1: big task annotated with decomposition
    expect(result.proposals[0].features[0].tasks).toHaveLength(1);
    expect(result.proposals[0].features[0].tasks[0].title).toBe("F1 big task");
    expect(result.proposals[0].features[0].tasks[0].decomposition).toBeDefined();
    expect(result.proposals[0].features[0].tasks[0].decomposition!.children[0].title).toBe("Child");

    // Feature 2: small task unchanged
    expect(result.proposals[0].features[1].tasks).toHaveLength(1);
    expect(result.proposals[0].features[1].tasks[0].title).toBe("F2 small task");
    expect(result.proposals[0].features[1].tasks[0].decomposition).toBeUndefined();
  });
});
