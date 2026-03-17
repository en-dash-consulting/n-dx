/**
 * Tests for LLM disambiguation with mocked spawnClaude.
 *
 * Uses vi.hoisted + vi.mock at module level to intercept spawnClaude calls.
 * Tests are separated from extract-llm.test.ts because the mock must be
 * declared at the top level and affects all tests in the file.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Proposal } from "../../../src/analyze/propose.js";

// ── Module-level mock (vi.hoisted ensures the variable is available when vi.mock runs) ──

const { mockSpawnClaude } = vi.hoisted(() => ({
  mockSpawnClaude: vi.fn(),
}));

vi.mock("../../../src/analyze/llm-bridge.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/analyze/llm-bridge.js")>();
  return {
    ...actual,
    spawnClaude: mockSpawnClaude,
  };
});

// Import AFTER mock declaration
import {
  maybeDisambiguate,
  extractFromText,
} from "../../../src/analyze/extract.js";

// ── Helpers ──

function epicTitles(proposals: Proposal[]): string[] {
  return proposals.map((p) => p.epic.title);
}

function featureTitles(proposals: Proposal[]): string[] {
  return proposals.flatMap((p) => p.features.map((f) => f.title));
}

function taskTitles(proposals: Proposal[]): string[] {
  return proposals.flatMap((p) =>
    p.features.flatMap((f) => f.tasks.map((t) => t.title)),
  );
}

/** Prose content that produces an ambiguous pattern-based result. */
const AMBIGUOUS_PROSE =
  "The system must handle user authentication securely. " +
  "It should support multi-factor authentication. " +
  "The platform must integrate with third-party OAuth providers. " +
  "Sessions must expire after 30 minutes of inactivity. " +
  "The application must log all authentication attempts for audit. " +
  "Password policies must enforce minimum complexity requirements.";

/** Valid LLM response JSON with structured proposals. */
const VALID_LLM_RESPONSE = JSON.stringify([
  {
    epic: { title: "User Authentication" },
    features: [
      {
        title: "Login System",
        description: "Implement secure login",
        tasks: [
          { title: "Implement OAuth2 flow", description: "Add OAuth2 support" },
          {
            title: "Add password hashing",
            acceptanceCriteria: ["Use bcrypt", "Salt passwords"],
          },
        ],
      },
      {
        title: "Session Management",
        tasks: [{ title: "Implement JWT tokens" }],
      },
    ],
  },
]);

// ── Tests ──

describe("maybeDisambiguate — LLM integration (mocked)", () => {
  beforeEach(() => {
    mockSpawnClaude.mockReset();
  });

  it("calls LLM when structure is ambiguous and useLLM is true", async () => {
    mockSpawnClaude.mockResolvedValue({
      text: VALID_LLM_RESPONSE,
      tokenUsage: { input: 500, output: 200 },
    });

    const patternResult = extractFromText(AMBIGUOUS_PROSE);
    const result = await maybeDisambiguate(AMBIGUOUS_PROSE, patternResult, {
      useLLM: true,
    });

    expect(mockSpawnClaude).toHaveBeenCalledOnce();
    expect(result.usedLLM).toBe(true);
    expect(result.tokenUsage).toBeDefined();
    expect(result.tokenUsage!.calls).toBe(1);
    expect(result.tokenUsage!.inputTokens).toBe(500);
    expect(result.tokenUsage!.outputTokens).toBe(200);
  });

  it("produces correct proposal structure from LLM response", async () => {
    mockSpawnClaude.mockResolvedValue({
      text: VALID_LLM_RESPONSE,
      tokenUsage: { input: 500, output: 200 },
    });

    const patternResult = extractFromText(AMBIGUOUS_PROSE);
    const result = await maybeDisambiguate(AMBIGUOUS_PROSE, patternResult, {
      useLLM: true,
    });

    expect(epicTitles(result.proposals)).toEqual(["User Authentication"]);
    expect(featureTitles(result.proposals)).toEqual([
      "Login System",
      "Session Management",
    ]);
    expect(taskTitles(result.proposals)).toEqual([
      "Implement OAuth2 flow",
      "Add password hashing",
      "Implement JWT tokens",
    ]);
  });

  it("sets source to file-import on all LLM-generated items", async () => {
    mockSpawnClaude.mockResolvedValue({
      text: VALID_LLM_RESPONSE,
      tokenUsage: { input: 500, output: 200 },
    });

    const patternResult = extractFromText(AMBIGUOUS_PROSE);
    const result = await maybeDisambiguate(AMBIGUOUS_PROSE, patternResult, {
      useLLM: true,
    });

    expect(result.proposals[0].epic.source).toBe("file-import");
    expect(result.proposals[0].features[0].source).toBe("file-import");
    expect(result.proposals[0].features[0].tasks[0].source).toBe("file-import");
    expect(result.proposals[0].features[1].source).toBe("file-import");
  });

  it("preserves acceptance criteria from LLM response", async () => {
    mockSpawnClaude.mockResolvedValue({
      text: VALID_LLM_RESPONSE,
      tokenUsage: { input: 500, output: 200 },
    });

    const patternResult = extractFromText(AMBIGUOUS_PROSE);
    const result = await maybeDisambiguate(AMBIGUOUS_PROSE, patternResult, {
      useLLM: true,
    });

    const hashTask = result.proposals[0].features[0].tasks.find(
      (t) => t.title === "Add password hashing",
    );
    expect(hashTask).toBeDefined();
    expect(hashTask!.acceptanceCriteria).toEqual([
      "Use bcrypt",
      "Salt passwords",
    ]);
  });

  it("preserves task descriptions from LLM response", async () => {
    mockSpawnClaude.mockResolvedValue({
      text: VALID_LLM_RESPONSE,
      tokenUsage: { input: 500, output: 200 },
    });

    const patternResult = extractFromText(AMBIGUOUS_PROSE);
    const result = await maybeDisambiguate(AMBIGUOUS_PROSE, patternResult, {
      useLLM: true,
    });

    const oauthTask = result.proposals[0].features[0].tasks.find(
      (t) => t.title === "Implement OAuth2 flow",
    );
    expect(oauthTask).toBeDefined();
    expect(oauthTask!.description).toBe("Add OAuth2 support");
  });

  it("preserves feature descriptions from LLM response", async () => {
    mockSpawnClaude.mockResolvedValue({
      text: VALID_LLM_RESPONSE,
      tokenUsage: { input: 500, output: 200 },
    });

    const patternResult = extractFromText(AMBIGUOUS_PROSE);
    const result = await maybeDisambiguate(AMBIGUOUS_PROSE, patternResult, {
      useLLM: true,
    });

    expect(result.proposals[0].features[0].description).toBe(
      "Implement secure login",
    );
  });

  it("passes model option to spawnClaude", async () => {
    mockSpawnClaude.mockResolvedValue({
      text: VALID_LLM_RESPONSE,
      tokenUsage: { input: 500, output: 200 },
    });

    const patternResult = extractFromText(AMBIGUOUS_PROSE);
    await maybeDisambiguate(AMBIGUOUS_PROSE, patternResult, {
      useLLM: true,
      model: "claude-opus-4",
    });

    expect(mockSpawnClaude).toHaveBeenCalledWith(
      expect.any(String),
      "claude-opus-4",
    );
  });
});

describe("maybeDisambiguate — LLM failure resilience (mocked)", () => {
  beforeEach(() => {
    mockSpawnClaude.mockReset();
  });

  it("falls back to pattern result when LLM returns invalid JSON", async () => {
    mockSpawnClaude.mockResolvedValue({
      text: "This is not JSON at all, just random text without any brackets.",
      tokenUsage: { input: 100, output: 50 },
    });

    const patternResult = extractFromText(AMBIGUOUS_PROSE);
    const result = await maybeDisambiguate(AMBIGUOUS_PROSE, patternResult, {
      useLLM: true,
    });

    // Should fall back to pattern result, not crash
    expect(result.proposals).toEqual(patternResult.proposals);
    expect(result.usedLLM).toBe(false);
  });

  it("falls back to pattern result when LLM call throws", async () => {
    mockSpawnClaude.mockRejectedValue(new Error("API rate limit"));

    const patternResult = extractFromText(AMBIGUOUS_PROSE);
    const result = await maybeDisambiguate(AMBIGUOUS_PROSE, patternResult, {
      useLLM: true,
    });

    // Should return the pattern result, not throw
    expect(result.proposals).toEqual(patternResult.proposals);
    expect(result.usedLLM).toBe(false);
  });

  it("falls back when LLM returns empty proposals array", async () => {
    mockSpawnClaude.mockResolvedValue({
      text: "[]",
      tokenUsage: { input: 100, output: 10 },
    });

    const patternResult = extractFromText(AMBIGUOUS_PROSE);
    const result = await maybeDisambiguate(AMBIGUOUS_PROSE, patternResult, {
      useLLM: true,
    });

    expect(result.proposals).toEqual(patternResult.proposals);
    expect(result.usedLLM).toBe(false);
  });

  it("falls back when LLM returns proposals with no features", async () => {
    mockSpawnClaude.mockResolvedValue({
      text: JSON.stringify([
        { epic: { title: "Empty Epic" }, features: [] },
      ]),
      tokenUsage: { input: 100, output: 30 },
    });

    const patternResult = extractFromText(AMBIGUOUS_PROSE);
    const result = await maybeDisambiguate(AMBIGUOUS_PROSE, patternResult, {
      useLLM: true,
    });

    expect(result.proposals).toEqual(patternResult.proposals);
    expect(result.usedLLM).toBe(false);
  });

  it("falls back when LLM returns malformed schema (missing required fields)", async () => {
    mockSpawnClaude.mockResolvedValue({
      text: JSON.stringify([
        { name: "Not a valid proposal" },
      ]),
      tokenUsage: { input: 100, output: 30 },
    });

    const patternResult = extractFromText(AMBIGUOUS_PROSE);
    const result = await maybeDisambiguate(AMBIGUOUS_PROSE, patternResult, {
      useLLM: true,
    });

    expect(result.proposals).toEqual(patternResult.proposals);
    expect(result.usedLLM).toBe(false);
  });

  it("handles LLM response wrapped in markdown code fence", async () => {
    const fencedResponse = "```json\n" + VALID_LLM_RESPONSE + "\n```";
    mockSpawnClaude.mockResolvedValue({
      text: fencedResponse,
      tokenUsage: { input: 500, output: 200 },
    });

    const patternResult = extractFromText(AMBIGUOUS_PROSE);
    const result = await maybeDisambiguate(AMBIGUOUS_PROSE, patternResult, {
      useLLM: true,
    });

    expect(result.usedLLM).toBe(true);
    expect(epicTitles(result.proposals)).toEqual(["User Authentication"]);
  });

  it("handles LLM response as single object (not array)", async () => {
    const singleObjectResponse = JSON.stringify({
      epic: { title: "Platform" },
      features: [
        {
          title: "Core",
          tasks: [{ title: "Setup project" }],
        },
      ],
    });
    mockSpawnClaude.mockResolvedValue({
      text: singleObjectResponse,
      tokenUsage: { input: 300, output: 100 },
    });

    const patternResult = extractFromText(AMBIGUOUS_PROSE);
    const result = await maybeDisambiguate(AMBIGUOUS_PROSE, patternResult, {
      useLLM: true,
    });

    expect(result.usedLLM).toBe(true);
    expect(epicTitles(result.proposals)).toEqual(["Platform"]);
    expect(taskTitles(result.proposals)).toEqual(["Setup project"]);
  });
});

describe("maybeDisambiguate — deduplication with LLM (mocked)", () => {
  beforeEach(() => {
    mockSpawnClaude.mockReset();
  });

  it("does not call LLM when useLLM is false even for ambiguous content", async () => {
    const patternResult = extractFromText(AMBIGUOUS_PROSE);
    await maybeDisambiguate(AMBIGUOUS_PROSE, patternResult, {
      useLLM: false,
    });

    expect(mockSpawnClaude).not.toHaveBeenCalled();
  });

  it("includes existing items in dedup context for the prompt", async () => {
    mockSpawnClaude.mockResolvedValue({
      text: VALID_LLM_RESPONSE,
      tokenUsage: { input: 500, output: 200 },
    });

    const patternResult = extractFromText(AMBIGUOUS_PROSE);
    await maybeDisambiguate(AMBIGUOUS_PROSE, patternResult, {
      useLLM: true,
      existingItems: [
        {
          id: "1",
          title: "Existing Task",
          level: "task",
          status: "completed",
        } as any,
      ],
    });

    // The prompt should contain the existing item for dedup
    const promptArg = mockSpawnClaude.mock.calls[0][0] as string;
    expect(promptArg).toContain("existing task");
  });
});
