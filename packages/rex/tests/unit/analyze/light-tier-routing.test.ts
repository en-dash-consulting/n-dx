/**
 * Unit tests for light-tier model routing of mechanical single-shot LLM calls.
 *
 * Verifies that:
 * - Sibling renames, group renames, body merges, the consolidation guard,
 *   and the granularity assessment pass resolve the vendor's light-tier
 *   model when no explicit model override is given.
 * - An explicit model (CLI --model flag or upstream-resolved model) always
 *   wins over weight-based tier resolution.
 * - `spawnClaude` itself resolves the tier-appropriate model from the weight
 *   parameter at the single LLM choke point.
 *
 * @see packages/llm-client/tests/unit/config.test.ts for the underlying
 *   resolveVendorModel tier-resolution tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TIER_MODELS } from "@n-dx/llm-client";
import type { PRDItem } from "../../../src/schema/index.js";
import type { Proposal, ProposalTask } from "../../../src/analyze/propose.js";

// Mock spawnClaude at the llm-bridge choke point before importing the modules
// under test. reason.js re-exports the bridge, so both the helpers that import
// spawnClaude from "./reason.js" and reason.ts's own internal bridge import
// resolve to this mock. The real resolveConfiguredModel (and module-level LLM
// config state) is kept so the weight-aware resolution path is exercised for
// helpers that resolve the model themselves before calling spawnClaude.
vi.mock("../../../src/analyze/llm-bridge.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/analyze/llm-bridge.js")>();
  return {
    ...actual,
    spawnClaude: vi.fn(),
  };
});

import { spawnClaude, setLLMConfig } from "../../../src/analyze/llm-bridge.js";
import { proposeSiblingRenames } from "../../../src/analyze/rename-resolve.js";
import { proposeGroupRenames } from "../../../src/analyze/propose-group-renames.js";
import { reasonForBodyMerge } from "../../../src/analyze/reshape-reason.js";
import { applyConsolidationGuard } from "../../../src/analyze/consolidation-guard.js";
import { assessGranularity } from "../../../src/analyze/reason.js";

const mockSpawnClaude = vi.mocked(spawnClaude);

const CLAUDE_LIGHT = TIER_MODELS.claude.light; // claude-haiku-4-5

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeItem(id: string, title: string): PRDItem {
  return {
    id,
    title,
    level: "task",
    status: "pending",
    description: `Description for ${title}`,
  } as PRDItem;
}

function makeTask(title: string): ProposalTask {
  return {
    title,
    source: "test",
    sourceFile: "src/x.ts",
    description: "d",
    acceptanceCriteria: ["ok"],
    priority: "medium",
  };
}

function makeProposal(title: string, taskCount: number): Proposal {
  const tasks: ProposalTask[] = [];
  for (let i = 0; i < taskCount; i++) tasks.push(makeTask(`Task ${i + 1} of ${title}`));
  return {
    epic: { title, source: "test" },
    features: [{ title: `${title} Feature`, source: "test", tasks }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset module-level LLM config to a bare claude setup (no model overrides).
  setLLMConfig({ vendor: "claude" });
});

// ── Sibling renames (rename-resolve.ts) ────────────────────────────────────────

describe("proposeSiblingRenames light-tier routing", () => {
  const renameResponse = {
    text: JSON.stringify({ titleA: "New A", titleB: "New B", reasoning: "distinct" }),
  };

  it("resolves the light-tier model when no explicit model is given", async () => {
    mockSpawnClaude.mockResolvedValue(renameResponse);

    await proposeSiblingRenames(makeItem("a", "Same"), makeItem("b", "Same"));

    expect(mockSpawnClaude).toHaveBeenCalledTimes(1);
    expect(mockSpawnClaude.mock.calls[0][1]).toBe(CLAUDE_LIGHT);
  });

  it("honors an explicit model override", async () => {
    mockSpawnClaude.mockResolvedValue(renameResponse);

    await proposeSiblingRenames(makeItem("a", "Same"), makeItem("b", "Same"), "claude-opus-4-7");

    expect(mockSpawnClaude.mock.calls[0][1]).toBe("claude-opus-4-7");
  });

  it("honors a configured lightModel override for the light tier", async () => {
    setLLMConfig({ vendor: "claude", claude: { lightModel: "claude-custom-light" } });
    mockSpawnClaude.mockResolvedValue(renameResponse);

    await proposeSiblingRenames(makeItem("a", "Same"), makeItem("b", "Same"));

    expect(mockSpawnClaude.mock.calls[0][1]).toBe("claude-custom-light");
  });

  it("does not let the standard-tier model config affect the light tier", async () => {
    setLLMConfig({ vendor: "claude", claude: { model: "claude-opus-4-7" } });
    mockSpawnClaude.mockResolvedValue(renameResponse);

    await proposeSiblingRenames(makeItem("a", "Same"), makeItem("b", "Same"));

    // Standard-tier `model` config applies to the standard tier only.
    expect(mockSpawnClaude.mock.calls[0][1]).toBe(CLAUDE_LIGHT);
  });
});

// ── Group renames (propose-group-renames.ts) ───────────────────────────────────

describe("proposeGroupRenames light-tier routing", () => {
  const groupResponse = {
    text: JSON.stringify({
      renames: [
        { id: "m1", title: "First distinct" },
        { id: "m2", title: "Second distinct" },
      ],
      reasoning: "split",
    }),
  };
  const group = {
    baseTitle: "Do the thing",
    members: [
      { id: "m1", title: "Do the thing" },
      { id: "m2", title: "Do the thing" },
    ],
  };

  it("resolves the light-tier model when no explicit model is given", async () => {
    mockSpawnClaude.mockResolvedValue(groupResponse);

    await proposeGroupRenames(group);

    expect(mockSpawnClaude).toHaveBeenCalledTimes(1);
    expect(mockSpawnClaude.mock.calls[0][1]).toBe(CLAUDE_LIGHT);
  });

  it("honors an explicit model override", async () => {
    mockSpawnClaude.mockResolvedValue(groupResponse);

    await proposeGroupRenames(group, "claude-opus-4-7");

    expect(mockSpawnClaude.mock.calls[0][1]).toBe("claude-opus-4-7");
  });
});

// ── Body merges (reshape-reason.ts) ────────────────────────────────────────────

describe("reasonForBodyMerge light-tier routing", () => {
  it("declares the prd.merge task class (light by registry default)", async () => {
    mockSpawnClaude.mockResolvedValue({ text: "Merged description." });

    await reasonForBodyMerge([makeItem("a", "Dup (abc123)"), makeItem("b", "Dup (def456)")]);

    expect(mockSpawnClaude).toHaveBeenCalledTimes(1);
    expect(mockSpawnClaude.mock.calls[0][1]).toBeUndefined();
    expect(mockSpawnClaude.mock.calls[0][3]).toEqual({ taskClass: "prd.merge" });
  });

  it("forwards an explicit model, which wins over the weight", async () => {
    mockSpawnClaude.mockResolvedValue({ text: "Merged description." });

    await reasonForBodyMerge([makeItem("a", "Dup")], "claude-opus-4-7");

    expect(mockSpawnClaude.mock.calls[0][1]).toBe("claude-opus-4-7");
  });
});

// ── Consolidation guard (consolidation-guard.ts) ───────────────────────────────

describe("applyConsolidationGuard light-tier routing", () => {
  it("declares the prd.consolidate-check task class when triggered without a model", async () => {
    mockSpawnClaude.mockResolvedValue({
      text: JSON.stringify([makeProposal("Auth", 1)]),
      tokenUsage: { input: 10, output: 5 },
    });

    await applyConsolidationGuard([makeProposal("Auth", 5)], { proposalCeiling: 2 });

    expect(mockSpawnClaude).toHaveBeenCalledTimes(1);
    expect(mockSpawnClaude.mock.calls[0][1]).toBeUndefined();
    expect(mockSpawnClaude.mock.calls[0][3]).toEqual({ taskClass: "prd.consolidate-check" });
  });

  it("forwards an explicit model, which wins over the weight", async () => {
    mockSpawnClaude.mockResolvedValue({
      text: JSON.stringify([makeProposal("Auth", 1)]),
      tokenUsage: { input: 10, output: 5 },
    });

    await applyConsolidationGuard([makeProposal("Auth", 5)], { proposalCeiling: 2 }, "claude-opus-4-7");

    expect(mockSpawnClaude.mock.calls[0][1]).toBe("claude-opus-4-7");
  });
});

// ── Granularity assessment (reason.ts) ─────────────────────────────────────────

describe("assessGranularity light-tier routing", () => {
  const assessmentResponse = {
    text: JSON.stringify([
      { proposalIndex: 0, recommendation: "keep", reasoning: "fine", issues: [] },
    ]),
  };

  it("declares the prd.assess task class when no model is given", async () => {
    mockSpawnClaude.mockResolvedValue(assessmentResponse);

    await assessGranularity([makeProposal("Auth", 2)]);

    expect(mockSpawnClaude).toHaveBeenCalledTimes(1);
    expect(mockSpawnClaude.mock.calls[0][1]).toBeUndefined();
    expect(mockSpawnClaude.mock.calls[0][3]).toEqual({ taskClass: "prd.assess" });
  });

  it("forwards an explicit model, which wins over the weight", async () => {
    mockSpawnClaude.mockResolvedValue(assessmentResponse);

    await assessGranularity([makeProposal("Auth", 2)], "claude-opus-4-7");

    expect(mockSpawnClaude.mock.calls[0][1]).toBe("claude-opus-4-7");
  });
});
