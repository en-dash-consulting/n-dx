import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Proposal, ProposalTask } from "../../../src/analyze/propose.js";
import type { LoEConfig } from "../../../src/schema/v1.js";
import {
  countProposalTasks,
  buildConsolidationGuardPrompt,
  applyConsolidationGuard,
} from "../../../src/analyze/consolidation-guard.js";

// ─── Helpers ──────────────────────────────────────────────────────────

function makeTask(overrides: Partial<ProposalTask> = {}): ProposalTask {
  return {
    title: "Implement feature",
    source: "test",
    sourceFile: "src/feature.ts",
    description: "Build the feature",
    acceptanceCriteria: ["Works correctly"],
    priority: "medium",
    loe: 1,
    loeRationale: "Standard effort",
    loeConfidence: "medium",
    ...overrides,
  };
}

function makeProposal(title: string, taskCount: number): Proposal {
  const tasks: ProposalTask[] = [];
  for (let i = 0; i < taskCount; i++) {
    tasks.push(makeTask({ title: `Task ${i + 1} for ${title}` }));
  }
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

// ─── countProposalTasks ───────────────────────────────────────────────

describe("countProposalTasks", () => {
  it("counts zero for empty proposals", () => {
    expect(countProposalTasks([])).toBe(0);
  });

  it("counts tasks across multiple features and proposals", () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "Epic 1", source: "test" },
        features: [
          { title: "F1", source: "test", tasks: [makeTask(), makeTask()] },
          { title: "F2", source: "test", tasks: [makeTask()] },
        ],
      },
      {
        epic: { title: "Epic 2", source: "test" },
        features: [
          { title: "F3", source: "test", tasks: [makeTask(), makeTask(), makeTask()] },
        ],
      },
    ];

    expect(countProposalTasks(proposals)).toBe(6);
  });

  it("counts zero for proposals with no tasks", () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "Empty", source: "test" },
        features: [{ title: "F1", source: "test", tasks: [] }],
      },
    ];
    expect(countProposalTasks(proposals)).toBe(0);
  });
});

// ─── buildConsolidationGuardPrompt ────────────────────────────────────

describe("buildConsolidationGuardPrompt", () => {
  it("includes the current task count and ceiling in the prompt", () => {
    const proposals = [makeProposal("Auth", 12)];
    const prompt = buildConsolidationGuardPrompt(proposals, 10, 12);

    expect(prompt).toContain("12 tasks");
    expect(prompt).toContain("ceiling of 10 tasks");
    expect(prompt).toContain("at most 10 tasks total");
  });

  it("includes the proposals JSON", () => {
    const proposals = [makeProposal("Auth", 2)];
    const prompt = buildConsolidationGuardPrompt(proposals, 10, 2);

    expect(prompt).toContain('"title": "Auth"');
  });

  it("includes task quality rules and few-shot example", () => {
    const proposals = [makeProposal("Auth", 2)];
    const prompt = buildConsolidationGuardPrompt(proposals, 10, 2);

    expect(prompt).toContain("Task quality:");
    expect(prompt).toContain("Example output");
  });

  it("instructs to preserve LoE fields", () => {
    const proposals = [makeProposal("Auth", 2)];
    const prompt = buildConsolidationGuardPrompt(proposals, 10, 2);

    expect(prompt).toContain("LoE");
    expect(prompt).toContain("loeRationale");
  });
});

// ─── applyConsolidationGuard ──────────────────────────────────────────

// We mock spawnClaude so we don't make real LLM calls
vi.mock("../../../src/analyze/reason.js", async () => {
  const actual = await vi.importActual<typeof import("../../../src/analyze/reason.js")>("../../../src/analyze/reason.js");
  return {
    ...actual,
    spawnClaude: vi.fn(),
  };
});

import { spawnClaude } from "../../../src/analyze/reason.js";
const mockSpawnClaude = vi.mocked(spawnClaude);

describe("applyConsolidationGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not trigger when task count is within ceiling", async () => {
    const proposals = [makeProposal("Auth", 5)];
    const result = await applyConsolidationGuard(proposals, { proposalCeiling: 10 });

    expect(result.triggered).toBe(false);
    expect(result.proposals).toBe(proposals); // same reference
    expect(result.originalTaskCount).toBe(5);
    expect(result.finalTaskCount).toBe(5);
    expect(result.ceiling).toBe(10);
    expect(result.tokenUsage.calls).toBe(0);
  });

  it("does not trigger when task count equals ceiling", async () => {
    const proposals = [makeProposal("Auth", 10)];
    const result = await applyConsolidationGuard(proposals, { proposalCeiling: 10 });

    expect(result.triggered).toBe(false);
  });

  it("uses default ceiling of 10 when no config provided", async () => {
    const proposals = [makeProposal("Auth", 8)];
    const result = await applyConsolidationGuard(proposals);

    expect(result.triggered).toBe(false);
    expect(result.ceiling).toBe(10);
  });

  it("triggers consolidation when task count exceeds ceiling", async () => {
    const proposals = [makeProposal("Auth", 15)];

    // Mock a consolidated response with 8 tasks
    const consolidated: Proposal[] = [makeProposal("Auth", 8)];
    mockSpawnClaude.mockResolvedValueOnce({
      text: JSON.stringify(consolidated),
      tokenUsage: { input: 100, output: 50 },
    });

    const result = await applyConsolidationGuard(proposals, { proposalCeiling: 10 });

    expect(result.triggered).toBe(true);
    expect(result.reduced).toBe(true);
    expect(result.originalTaskCount).toBe(15);
    expect(result.finalTaskCount).toBe(8);
    expect(result.ceiling).toBe(10);
    expect(result.warning).toBeUndefined();
    expect(result.tokenUsage.calls).toBe(1);
  });

  it("returns warning when consolidation cannot reduce below ceiling", async () => {
    const proposals = [makeProposal("Auth", 15)];

    // Mock a response that still has too many tasks
    const stillTooMany: Proposal[] = [makeProposal("Auth", 12)];
    mockSpawnClaude.mockResolvedValueOnce({
      text: JSON.stringify(stillTooMany),
      tokenUsage: { input: 100, output: 50 },
    });

    const result = await applyConsolidationGuard(proposals, { proposalCeiling: 10 });

    expect(result.triggered).toBe(true);
    expect(result.reduced).toBe(false);
    expect(result.warning).toContain("reduced from 15 to 12");
    expect(result.warning).toContain("ceiling of 10");
    expect(result.finalTaskCount).toBe(12);
  });

  it("returns warning when LLM returns empty proposals", async () => {
    const proposals = [makeProposal("Auth", 15)];

    mockSpawnClaude.mockResolvedValueOnce({
      text: "[]",
      tokenUsage: { input: 100, output: 10 },
    });

    const result = await applyConsolidationGuard(proposals, { proposalCeiling: 10 });

    expect(result.triggered).toBe(true);
    expect(result.reduced).toBe(false);
    expect(result.warning).toContain("LLM returned no proposals");
    // Should keep original proposals
    expect(result.proposals).toBe(proposals);
    expect(result.finalTaskCount).toBe(15);
  });

  it("respects custom ceiling from config", async () => {
    const proposals = [makeProposal("Auth", 6)];

    const consolidated: Proposal[] = [makeProposal("Auth", 4)];
    mockSpawnClaude.mockResolvedValueOnce({
      text: JSON.stringify(consolidated),
      tokenUsage: { input: 100, output: 50 },
    });

    const config: LoEConfig = { proposalCeiling: 5 };
    const result = await applyConsolidationGuard(proposals, config);

    expect(result.triggered).toBe(true);
    expect(result.ceiling).toBe(5);
    expect(result.reduced).toBe(true);
  });
});
