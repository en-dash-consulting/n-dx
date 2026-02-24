import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Proposal } from "../../../src/analyze/propose.js";

// Shared mock client — all tests control LLM responses through this
const mockComplete = vi.fn().mockResolvedValue({ text: "[]", tokenUsage: undefined });

vi.mock("@n-dx/llm-client", () => ({
  createClient: () => ({
    mode: "api",
    complete: mockComplete,
  }),
  detectAuthMode: () => "api",
}));

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

// ─── buildModifyPrompt ──────────────────────────────────────────────

describe("buildModifyPrompt", () => {
  let buildModifyPrompt: typeof import("../../../src/analyze/modify-reason.js").buildModifyPrompt;

  beforeEach(async () => {
    const mod = await import("../../../src/analyze/modify-reason.js");
    buildModifyPrompt = mod.buildModifyPrompt;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("includes the proposal JSON in the prompt", () => {
    const proposals = [makeProposal("User Auth")];
    const prompt = buildModifyPrompt(proposals, "Add rate limiting");

    expect(prompt).toContain('"title": "User Auth"');
    expect(prompt).toContain("Feature 1 of User Auth");
    expect(prompt).toContain("Task 1 for User Auth F1");
  });

  it("includes the modification request in the prompt", () => {
    const proposals = [makeProposal("Auth")];
    const prompt = buildModifyPrompt(proposals, "Split the auth tasks into separate login and signup flows");

    expect(prompt).toContain("Split the auth tasks into separate login and signup flows");
  });

  it("includes the modification request under the correct heading", () => {
    const proposals = [makeProposal("Auth")];
    const prompt = buildModifyPrompt(proposals, "Add caching layer");

    expect(prompt).toContain("## Modification Request");
    expect(prompt).toContain("Add caching layer");
  });

  it("includes output format instructions", () => {
    const proposals = [makeProposal("Auth")];
    const prompt = buildModifyPrompt(proposals, "Change priorities");

    expect(prompt).toContain("ONLY a valid JSON array");
  });

  it("includes PRD schema definition", () => {
    const proposals = [makeProposal("Auth")];
    const prompt = buildModifyPrompt(proposals, "Modify");

    expect(prompt).toContain('"epic"');
    expect(prompt).toContain('"features"');
    expect(prompt).toContain('"tasks"');
  });

  it("includes few-shot example", () => {
    const proposals = [makeProposal("Auth")];
    const prompt = buildModifyPrompt(proposals, "Modify");

    expect(prompt).toContain("Example output");
  });

  it("includes task quality rules", () => {
    const proposals = [makeProposal("Auth")];
    const prompt = buildModifyPrompt(proposals, "Modify");

    expect(prompt).toContain("Task quality");
    expect(prompt).toContain("acceptanceCriteria");
  });

  it("includes anti-patterns guidance", () => {
    const proposals = [makeProposal("Auth")];
    const prompt = buildModifyPrompt(proposals, "Modify");

    expect(prompt).toContain("Avoid these common mistakes");
  });

  it("instructs to preserve metadata not affected by the request", () => {
    const proposals = [makeProposal("Auth")];
    const prompt = buildModifyPrompt(proposals, "Change title");

    expect(prompt).toMatch(/[Pp]reserve/);
    expect(prompt).toMatch(/metadata|descriptions|acceptance criteria|priorities|tags/);
  });

  it("instructs to preserve hierarchy unless explicitly asked to change", () => {
    const proposals = [makeProposal("Auth")];
    const prompt = buildModifyPrompt(proposals, "Restructure");

    expect(prompt).toMatch(/hierarchy/);
    expect(prompt).toMatch(/explicitly/);
  });

  it("handles multiple proposals", () => {
    const proposals = [makeProposal("Auth"), makeProposal("Dashboard")];
    const prompt = buildModifyPrompt(proposals, "Merge these");

    expect(prompt).toContain('"title": "Auth"');
    expect(prompt).toContain('"title": "Dashboard"');
  });

  it("includes existing PRD summary when provided", () => {
    const proposals = [makeProposal("Auth")];
    const prompt = buildModifyPrompt(proposals, "Modify", {
      existingSummary: "- [epic] API Gateway (pending)",
    });

    expect(prompt).toContain("API Gateway");
    expect(prompt).toContain("deduplication");
  });

  it("includes project context when provided", () => {
    const proposals = [makeProposal("Auth")];
    const prompt = buildModifyPrompt(proposals, "Modify", {
      projectContext: "This is a billing microservice using Node.js",
    });

    expect(prompt).toContain("billing microservice");
    expect(prompt).toContain("Project context");
  });

  it("omits existing PRD block when not provided", () => {
    const proposals = [makeProposal("Auth")];
    const prompt = buildModifyPrompt(proposals, "Modify");

    expect(prompt).not.toContain("Existing PRD");
  });

  it("omits project context block when not provided", () => {
    const proposals = [makeProposal("Auth")];
    const prompt = buildModifyPrompt(proposals, "Modify");

    expect(prompt).not.toContain("Project context");
  });

  it("instructs not to invent changes beyond the request", () => {
    const proposals = [makeProposal("Auth")];
    const prompt = buildModifyPrompt(proposals, "Change priority to high");

    expect(prompt).toMatch(/[Dd]o NOT invent changes beyond/);
  });

  it("instructs to handle additions", () => {
    const proposals = [makeProposal("Auth")];
    const prompt = buildModifyPrompt(proposals, "Add caching");

    expect(prompt).toMatch(/add items/i);
  });

  it("instructs to handle removals", () => {
    const proposals = [makeProposal("Auth")];
    const prompt = buildModifyPrompt(proposals, "Remove login");

    expect(prompt).toMatch(/remove items/i);
  });
});

// ─── modifyProposals ────────────────────────────────────────────────

describe("modifyProposals", () => {
  let tmpDir: string;
  let modifyProposals: typeof import("../../../src/analyze/modify-reason.js").modifyProposals;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-modify-test-"));
    mockComplete.mockReset();
    mockComplete.mockResolvedValue({ text: "[]", tokenUsage: undefined });

    const mod = await import("../../../src/analyze/modify-reason.js");
    modifyProposals = mod.modifyProposals;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty result for empty proposals", async () => {
    const result = await modifyProposals([], "Add something");

    expect(result.proposals).toEqual([]);
    expect(result.originalProposals).toEqual([]);
    expect(result.tokenUsage.calls).toBe(0);
    expect(result.qualityIssues).toEqual([]);
  });

  it("returns original proposals when modification request is empty", async () => {
    const proposals = [makeProposal("Auth")];
    const result = await modifyProposals(proposals, "");

    expect(result.proposals).toEqual(proposals);
    expect(result.originalProposals).toEqual(proposals);
    expect(result.tokenUsage.calls).toBe(0);
  });

  it("returns original proposals when modification request is whitespace only", async () => {
    const proposals = [makeProposal("Auth")];
    const result = await modifyProposals(proposals, "   ");

    expect(result.proposals).toEqual(proposals);
    expect(result.originalProposals).toEqual(proposals);
    expect(result.tokenUsage.calls).toBe(0);
  });

  it("sends proposals and modification request to LLM and returns parsed result", async () => {
    const modifiedJson = JSON.stringify([{
      epic: { title: "User Auth (Updated)" },
      features: [{
        title: "OAuth2 Login",
        tasks: [{
          title: "Implement Google OAuth2 callback",
          description: "Handle the OAuth2 callback from Google",
          acceptanceCriteria: ["Google login works end-to-end"],
          priority: "high",
        }],
      }],
    }]);

    mockComplete.mockResolvedValueOnce({
      text: modifiedJson,
      tokenUsage: { input: 1000, output: 500 },
    });

    const proposals = [makeProposal("User Auth")];
    const result = await modifyProposals(proposals, "Rename the epic and focus on OAuth2");

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].epic.title).toBe("User Auth (Updated)");
    expect(result.proposals[0].features[0].title).toBe("OAuth2 Login");
    expect(result.originalProposals).toEqual(proposals);
    expect(result.tokenUsage.calls).toBe(1);
    expect(result.tokenUsage.inputTokens).toBe(1000);
    expect(result.tokenUsage.outputTokens).toBe(500);
  });

  it("preserves original proposals reference for comparison", async () => {
    const modifiedJson = JSON.stringify([{
      epic: { title: "Modified" },
      features: [{
        title: "F1",
        tasks: [{ title: "T1", description: "d", acceptanceCriteria: ["c"] }],
      }],
    }]);

    mockComplete.mockResolvedValueOnce({ text: modifiedJson, tokenUsage: undefined });

    const originals = [makeProposal("Original")];
    const result = await modifyProposals(originals, "Change the epic title to Modified");

    expect(result.originalProposals).toBe(originals);
    expect(result.proposals[0].epic.title).toBe("Modified");
  });

  it("validates quality of modified proposals", async () => {
    // Return a proposal with a short task title (triggers quality warning)
    const modifiedJson = JSON.stringify([{
      epic: { title: "Auth" },
      features: [{
        title: "Login",
        tasks: [{ title: "Fix" }],  // Too short, no description/criteria
      }],
    }]);

    mockComplete.mockResolvedValueOnce({ text: modifiedJson, tokenUsage: undefined });

    const result = await modifyProposals(
      [makeProposal("Auth")],
      "Simplify all tasks to be shorter and simpler",
    );

    expect(result.qualityIssues.length).toBeGreaterThan(0);
    // Should flag the short task title
    expect(result.qualityIssues.some(i => i.message.includes("too short"))).toBe(true);
  });

  it("handles LLM returning response with markdown fences", async () => {
    const json = JSON.stringify([{
      epic: { title: "Auth" },
      features: [{
        title: "Login",
        tasks: [{
          title: "Implement login form",
          description: "Build the login form UI",
          acceptanceCriteria: ["Form renders correctly"],
        }],
      }],
    }]);
    const wrappedJson = `\`\`\`json\n${json}\n\`\`\``;

    mockComplete.mockResolvedValueOnce({ text: wrappedJson, tokenUsage: undefined });

    const result = await modifyProposals(
      [makeProposal("Auth")],
      "Focus on login",
    );

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].epic.title).toBe("Auth");
  });

  it("handles LLM returning single object instead of array", async () => {
    const json = JSON.stringify({
      epic: { title: "Auth" },
      features: [{
        title: "Login",
        tasks: [{
          title: "Implement login form",
          description: "Build the login form UI",
          acceptanceCriteria: ["Form renders correctly"],
        }],
      }],
    });

    mockComplete.mockResolvedValueOnce({ text: json, tokenUsage: undefined });

    const result = await modifyProposals(
      [makeProposal("Auth")],
      "Focus on login",
    );

    expect(result.proposals).toHaveLength(1);
  });

  it("retries on parse failure", async () => {
    // First call returns bad JSON, second returns valid
    mockComplete
      .mockResolvedValueOnce({ text: "invalid json garbage", tokenUsage: { input: 100, output: 50 } })
      .mockResolvedValueOnce({
        text: JSON.stringify([{
          epic: { title: "Auth" },
          features: [{
            title: "Login",
            tasks: [{ title: "Implement login", description: "d", acceptanceCriteria: ["c"] }],
          }],
        }]),
        tokenUsage: { input: 200, output: 100 },
      });

    const result = await modifyProposals(
      [makeProposal("Auth")],
      "Focus on login",
      { maxRetries: 1 },
    );

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].epic.title).toBe("Auth");
    // Both calls should be counted in token usage
    expect(result.tokenUsage.calls).toBe(2);
    expect(result.tokenUsage.inputTokens).toBe(300);
    expect(result.tokenUsage.outputTokens).toBe(150);
  });

  it("throws after exhausting retries", async () => {
    mockComplete.mockResolvedValue({ text: "not json at all", tokenUsage: undefined });

    await expect(
      modifyProposals(
        [makeProposal("Auth")],
        "Focus on login",
        { maxRetries: 1 },
      ),
    ).rejects.toThrow("Invalid JSON");
  });

  it("does not retry on non-parse errors", async () => {
    mockComplete.mockRejectedValueOnce(new Error("Network timeout"));

    await expect(
      modifyProposals(
        [makeProposal("Auth")],
        "Focus on login",
        { maxRetries: 2 },
      ),
    ).rejects.toThrow("Network timeout");

    // Should only be called once — no retry on network errors
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  it("loads project context from directory when dir is provided", async () => {
    await writeFile(join(tmpDir, "CLAUDE.md"), "# My Project\nA billing system");

    const modifiedJson = JSON.stringify([{
      epic: { title: "Auth" },
      features: [{
        title: "Login",
        tasks: [{ title: "Implement login", description: "d", acceptanceCriteria: ["c"] }],
      }],
    }]);

    mockComplete.mockResolvedValueOnce({ text: modifiedJson, tokenUsage: undefined });

    const result = await modifyProposals(
      [makeProposal("Auth")],
      "Focus on login",
      { dir: tmpDir },
    );

    expect(result.proposals).toHaveLength(1);
    // Verify the LLM was called
    expect(mockComplete).toHaveBeenCalledTimes(1);
    // The prompt should contain the project context
    const promptArg = mockComplete.mock.calls[0][0].prompt;
    expect(promptArg).toContain("billing system");
  });

  it("includes existing items context when provided", async () => {
    const existing = [{
      id: "e1",
      title: "API Gateway",
      level: "epic" as const,
      status: "pending" as const,
    }];

    const modifiedJson = JSON.stringify([{
      epic: { title: "Auth" },
      features: [{
        title: "Login",
        tasks: [{ title: "Implement login", description: "d", acceptanceCriteria: ["c"] }],
      }],
    }]);

    mockComplete.mockResolvedValueOnce({ text: modifiedJson, tokenUsage: undefined });

    const result = await modifyProposals(
      [makeProposal("Auth")],
      "Focus on login",
      { existingItems: existing },
    );

    expect(result.proposals).toHaveLength(1);
    // The prompt should contain the existing item
    const promptArg = mockComplete.mock.calls[0][0].prompt;
    expect(promptArg).toContain("API Gateway");
  });

  it("accumulates token usage correctly across calls", async () => {
    const modifiedJson = JSON.stringify([{
      epic: { title: "Auth" },
      features: [{
        title: "Login",
        tasks: [{ title: "Implement login", description: "d", acceptanceCriteria: ["c"] }],
      }],
    }]);

    mockComplete.mockResolvedValueOnce({
      text: modifiedJson,
      tokenUsage: {
        input: 500,
        output: 200,
        cacheCreationInput: 100,
        cacheReadInput: 50,
      },
    });

    const result = await modifyProposals(
      [makeProposal("Auth")],
      "Focus on login",
    );

    expect(result.tokenUsage.calls).toBe(1);
    expect(result.tokenUsage.inputTokens).toBe(500);
    expect(result.tokenUsage.outputTokens).toBe(200);
    expect(result.tokenUsage.cacheCreationInputTokens).toBe(100);
    expect(result.tokenUsage.cacheReadInputTokens).toBe(50);
  });

  it("sets source to 'llm' on modified proposals", async () => {
    const modifiedJson = JSON.stringify([{
      epic: { title: "Auth" },
      features: [{
        title: "Login",
        tasks: [{
          title: "Implement login form",
          description: "Build the login form",
          acceptanceCriteria: ["Form renders"],
          priority: "high",
          tags: ["frontend"],
        }],
      }],
    }]);

    mockComplete.mockResolvedValueOnce({ text: modifiedJson, tokenUsage: undefined });

    const result = await modifyProposals(
      [makeProposal("Auth")],
      "Focus on login",
    );

    // parseProposalResponse normalizes source to "llm"
    expect(result.proposals[0].epic.source).toBe("llm");
    expect(result.proposals[0].features[0].source).toBe("llm");
    expect(result.proposals[0].features[0].tasks[0].source).toBe("llm");
  });

  // ─── Validation integration ────────────────────────────────────────

  it("returns validation error for vague single-word requests without calling LLM", async () => {
    const proposals = [makeProposal("Auth")];
    const result = await modifyProposals(proposals, "change");

    expect(result.validationError).toBeDefined();
    expect(result.validationError).toMatch(/vague|specific/i);
    expect(result.validationSuggestion).toBeDefined();
    expect(result.proposals).toEqual(proposals); // originals unchanged
    expect(result.tokenUsage.calls).toBe(0); // no LLM call
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("returns validation error for known vague phrases without calling LLM", async () => {
    const proposals = [makeProposal("Auth")];
    const result = await modifyProposals(proposals, "make it better");

    expect(result.validationError).toBeDefined();
    expect(result.validationError).toMatch(/vague|specific/i);
    expect(result.tokenUsage.calls).toBe(0);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("skips validation when skipValidation option is set", async () => {
    const modifiedJson = JSON.stringify([{
      epic: { title: "Auth" },
      features: [{
        title: "Login",
        tasks: [{ title: "Implement login form", description: "d", acceptanceCriteria: ["c"] }],
      }],
    }]);

    mockComplete.mockResolvedValueOnce({ text: modifiedJson, tokenUsage: undefined });

    const proposals = [makeProposal("Auth")];
    // "change" would normally fail validation, but skipValidation bypasses it
    const result = await modifyProposals(proposals, "change", { skipValidation: true });

    expect(result.validationError).toBeUndefined();
    expect(result.proposals).toHaveLength(1);
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  it("passes validation for specific requests and calls LLM", async () => {
    const modifiedJson = JSON.stringify([{
      epic: { title: "User Authentication" },
      features: [{
        title: "OAuth2 Login",
        tasks: [{ title: "Add Google OAuth2", description: "d", acceptanceCriteria: ["c"] }],
      }],
    }]);

    mockComplete.mockResolvedValueOnce({
      text: modifiedJson,
      tokenUsage: { input: 500, output: 200 },
    });

    const proposals = [makeProposal("Auth")];
    const result = await modifyProposals(proposals, "Rename the epic to User Authentication and add OAuth2 login");

    expect(result.validationError).toBeUndefined();
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].epic.title).toBe("User Authentication");
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });
});
