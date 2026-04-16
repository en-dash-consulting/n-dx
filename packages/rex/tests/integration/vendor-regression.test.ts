/**
 * Cross-vendor regression tests for PRD authoring CLI commands.
 *
 * Exercises reasonFromDescription (rex add), reasonFromScanResults (rex analyze),
 * and reasonFromScanResults (rex recommend/analyze) against both Claude and Codex
 * vendor response formats using mocked LLM responses.
 *
 * Why this file exists:
 *  - Claude returns clean JSON arrays; Codex often returns inline JSON after prose.
 *  - The extractJson fix (analyze-shared.ts inline-array fallback) prevents Codex
 *    regressions. These tests verify the fix stays in place.
 *  - Rate-limit tests verify errors are classified retryable and the command
 *    succeeds once the caller retries.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClaudeClientError } from "@n-dx/llm-client";

// ── Module-level mock ──────────────────────────────────────────────────────
// Must be declared before any import that transitively loads llm-bridge.ts.

const { mockSpawnClaude } = vi.hoisted(() => ({
  mockSpawnClaude: vi.fn(),
}));

vi.mock("../../src/analyze/llm-bridge.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/analyze/llm-bridge.js")>();
  return { ...actual, spawnClaude: mockSpawnClaude };
});

// ── Imports (after mock declaration) ──────────────────────────────────────

import {
  reasonFromDescription,
  reasonFromScanResults,
} from "../../src/analyze/reason.js";
import type { ReasonResult } from "../../src/analyze/reason.js";
import type { ScanResult } from "../../src/analyze/scanners.js";

// ── Fixtures ──────────────────────────────────────────────────────────────

/** Minimal valid proposal that satisfies the ProposalArraySchema. */
const PROPOSAL_PAYLOAD = [
  {
    epic: { title: "User Authentication" },
    features: [
      {
        title: "Login Flow",
        description: "Handle secure user login",
        tasks: [
          {
            title: "Implement password validation",
            description: "Add server-side password strength checks",
            acceptanceCriteria: [
              "Minimum 8 characters enforced",
              "Common passwords rejected",
            ],
            priority: "high",
          },
        ],
      },
    ],
  },
];

/** Claude-style response: clean JSON array (no leading prose, no fences). */
const CLAUDE_RESPONSE = JSON.stringify(PROPOSAL_PAYLOAD);

/** Codex-style response: JSON array placed inline after introductory prose,
 *  with NO preceding newline — the pattern that triggered the original bug. */
const CODEX_INLINE_RESPONSE = `Here are the proposed PRD items: ${JSON.stringify(PROPOSAL_PAYLOAD)}`;

/** Codex-style response: JSON array on its own line after prose. */
const CODEX_NEWLINE_RESPONSE = `Here are the proposed PRD items:\n${JSON.stringify(PROPOSAL_PAYLOAD)}`;

/** Claude markdown-fence response variant. */
const CLAUDE_FENCED_RESPONSE = "```json\n" + CLAUDE_RESPONSE + "\n```";

/** Minimal scan results suitable for reasonFromScanResults. */
const SCAN_RESULTS: ScanResult[] = [
  {
    name: "User registration",
    source: "test",
    sourceFile: "tests/auth.test.ts",
    kind: "feature",
    description: "Registers a new user with email and password",
  },
];

// ── Test helper ────────────────────────────────────────────────────────────

/**
 * Retry wrapper that catches rate-limit errors and retries once.
 *
 * Represents the retry-on-rate-limit behaviour that calling code (or the
 * sibling "Implement Codex rate limiting detection and retry" task) is
 * expected to implement. Placed here to keep the test self-contained and
 * to document the expected error-handling contract.
 */
async function withRetry(fn: () => Promise<ReasonResult>): Promise<ReasonResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ClaudeClientError && err.retryable) {
      // Backoff fires: brief pause before retry (kept short in tests).
      await new Promise((r) => setTimeout(r, 0));
      return await fn();
    }
    throw err;
  }
}

// ── Test suite ─────────────────────────────────────────────────────────────

describe("vendor: claude — reasonFromDescription (rex add)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-vendor-regression-"));
    mockSpawnClaude.mockReset();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns proposals from clean JSON array response", async () => {
    mockSpawnClaude.mockResolvedValueOnce({
      text: CLAUDE_RESPONSE,
      tokenUsage: { input: 500, output: 200 },
    });

    const result = await reasonFromDescription("Add user authentication", [], {
      dir: tmpDir,
    });

    expect(mockSpawnClaude).toHaveBeenCalledTimes(1);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].epic.title).toBe("User Authentication");
    expect(result.proposals[0].features[0].title).toBe("Login Flow");
    expect(result.proposals[0].features[0].tasks[0].title).toBe(
      "Implement password validation",
    );
  });

  it("returns proposals from markdown-fenced JSON response", async () => {
    mockSpawnClaude.mockResolvedValueOnce({
      text: CLAUDE_FENCED_RESPONSE,
      tokenUsage: { input: 500, output: 200 },
    });

    const result = await reasonFromDescription("Add user authentication", [], {
      dir: tmpDir,
    });

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].epic.title).toBe("User Authentication");
  });

  it("accumulates token usage", async () => {
    mockSpawnClaude.mockResolvedValueOnce({
      text: CLAUDE_RESPONSE,
      tokenUsage: { input: 400, output: 150 },
    });

    const result = await reasonFromDescription("Add auth", [], { dir: tmpDir });

    expect(result.tokenUsage.calls).toBe(1);
    expect(result.tokenUsage.inputTokens).toBe(400);
    expect(result.tokenUsage.outputTokens).toBe(150);
  });

  it("accepts priority and acceptanceCriteria from response", async () => {
    mockSpawnClaude.mockResolvedValueOnce({
      text: CLAUDE_RESPONSE,
    });

    const result = await reasonFromDescription("Add auth", [], { dir: tmpDir });

    const task = result.proposals[0].features[0].tasks[0];
    expect(task.priority).toBe("high");
    expect(task.acceptanceCriteria).toEqual([
      "Minimum 8 characters enforced",
      "Common passwords rejected",
    ]);
  });
});

describe("vendor: codex — reasonFromDescription (rex add)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-vendor-regression-codex-"));
    mockSpawnClaude.mockReset();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns proposals when JSON appears inline after prose (no leading newline)", async () => {
    // This tests the inline-array fallback in extractJson that was added to
    // fix Codex compatibility. Codex frequently outputs JSON after a sentence
    // on the same line without a preceding newline.
    mockSpawnClaude.mockResolvedValueOnce({
      text: CODEX_INLINE_RESPONSE,
    });

    const result = await reasonFromDescription("Add user authentication", [], {
      dir: tmpDir,
    });

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].epic.title).toBe("User Authentication");
    expect(result.proposals[0].features[0].tasks[0].title).toBe(
      "Implement password validation",
    );
  });

  it("returns proposals when JSON appears after prose on a new line", async () => {
    mockSpawnClaude.mockResolvedValueOnce({
      text: CODEX_NEWLINE_RESPONSE,
    });

    const result = await reasonFromDescription("Add user authentication", [], {
      dir: tmpDir,
    });

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].epic.title).toBe("User Authentication");
  });

  it("handles multiple proposals inline", async () => {
    const multiPayload = [
      ...PROPOSAL_PAYLOAD,
      {
        epic: { title: "Dashboard" },
        features: [
          {
            title: "Analytics",
            tasks: [
              {
                title: "Add usage charts",
                description: "Display usage statistics",
                acceptanceCriteria: ["Chart renders within 1s"],
              },
            ],
          },
        ],
      },
    ];
    mockSpawnClaude.mockResolvedValueOnce({
      text: `Based on the description, here are the proposals: ${JSON.stringify(multiPayload)}`,
    });

    const result = await reasonFromDescription(
      "Add auth and dashboard",
      [],
      { dir: tmpDir },
    );

    expect(result.proposals).toHaveLength(2);
    const epicTitles = result.proposals.map((p) => p.epic.title);
    expect(epicTitles).toContain("User Authentication");
    expect(epicTitles).toContain("Dashboard");
  });
});

describe("vendor: claude — reasonFromScanResults (rex analyze)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-vendor-regression-scan-claude-"));
    mockSpawnClaude.mockReset();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns proposals from clean JSON array response", async () => {
    mockSpawnClaude.mockResolvedValueOnce({
      text: CLAUDE_RESPONSE,
      tokenUsage: { input: 800, output: 300 },
    });

    const result = await reasonFromScanResults(SCAN_RESULTS, [], {
      dir: tmpDir,
    });

    expect(mockSpawnClaude).toHaveBeenCalledTimes(1);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].epic.title).toBe("User Authentication");
  });

  it("accumulates token usage across chunks", async () => {
    // Return valid proposals for each chunk call
    mockSpawnClaude.mockResolvedValue({
      text: CLAUDE_RESPONSE,
      tokenUsage: { input: 200, output: 80 },
    });

    const result = await reasonFromScanResults(SCAN_RESULTS, [], {
      dir: tmpDir,
    });

    expect(result.tokenUsage.calls).toBeGreaterThanOrEqual(1);
    expect(result.tokenUsage.inputTokens).toBeGreaterThan(0);
    expect(result.tokenUsage.outputTokens).toBeGreaterThan(0);
  });
});

describe("vendor: codex — reasonFromScanResults (rex analyze)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-vendor-regression-scan-codex-"));
    mockSpawnClaude.mockReset();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns proposals when JSON appears inline after prose (no leading newline)", async () => {
    mockSpawnClaude.mockResolvedValueOnce({
      text: CODEX_INLINE_RESPONSE,
    });

    const result = await reasonFromScanResults(SCAN_RESULTS, [], {
      dir: tmpDir,
    });

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].epic.title).toBe("User Authentication");
  });

  it("returns proposals when JSON appears after prose on a new line", async () => {
    mockSpawnClaude.mockResolvedValueOnce({
      text: CODEX_NEWLINE_RESPONSE,
    });

    const result = await reasonFromScanResults(SCAN_RESULTS, [], {
      dir: tmpDir,
    });

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].epic.title).toBe("User Authentication");
  });
});

describe("rate-limit retry — vendor: claude and codex", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-vendor-regression-retry-"));
    mockSpawnClaude.mockReset();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("propagates rate-limit error as retryable ClaudeClientError", async () => {
    mockSpawnClaude.mockRejectedValue(
      new ClaudeClientError("429 Too Many Requests", "rate-limit", true),
    );

    let caughtError: unknown;
    try {
      await reasonFromDescription("Add auth", [], { dir: tmpDir });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(ClaudeClientError);
    const clientErr = caughtError as ClaudeClientError;
    expect(clientErr.retryable).toBe(true);
    // Identify vendor + command in failure output
    expect(clientErr.message).toContain("429");
  });

  it("[vendor: claude] succeeds on retry after rate-limit — clean JSON response", async () => {
    // First call: rate-limited; second call (after backoff): succeeds
    mockSpawnClaude
      .mockRejectedValueOnce(
        new ClaudeClientError("429 Too Many Requests", "rate-limit", true),
      )
      .mockResolvedValueOnce({ text: CLAUDE_RESPONSE });

    const result = await withRetry(() =>
      reasonFromDescription("Add user authentication", [], { dir: tmpDir }),
    );

    expect(mockSpawnClaude).toHaveBeenCalledTimes(2);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].epic.title).toBe("User Authentication");
  });

  it("[vendor: codex] succeeds on retry after rate-limit — inline JSON response", async () => {
    // Codex format: rate-limit on first attempt, inline JSON on retry
    mockSpawnClaude
      .mockRejectedValueOnce(
        new ClaudeClientError("429 Too Many Requests", "rate-limit", true),
      )
      .mockResolvedValueOnce({ text: CODEX_INLINE_RESPONSE });

    const result = await withRetry(() =>
      reasonFromDescription("Add user authentication", [], { dir: tmpDir }),
    );

    expect(mockSpawnClaude).toHaveBeenCalledTimes(2);
    expect(result.proposals).toHaveLength(1);
    // Codex inline JSON must parse correctly after retry
    expect(result.proposals[0].epic.title).toBe("User Authentication");
    expect(result.proposals[0].features[0].tasks[0].title).toBe(
      "Implement password validation",
    );
  });

  it("[vendor: codex] reasonFromScanResults succeeds on retry after rate-limit", async () => {
    mockSpawnClaude
      .mockRejectedValueOnce(
        new ClaudeClientError("rate limit exceeded", "rate-limit", true),
      )
      .mockResolvedValueOnce({ text: CODEX_INLINE_RESPONSE });

    const result = await withRetry(() =>
      reasonFromScanResults(SCAN_RESULTS, [], { dir: tmpDir }),
    );

    expect(mockSpawnClaude).toHaveBeenCalledTimes(2);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].epic.title).toBe("User Authentication");
  });

  it("does not retry non-retryable errors", async () => {
    const authError = new ClaudeClientError(
      "401 Unauthorized — invalid API key",
      "auth",
      false,
    );
    mockSpawnClaude.mockRejectedValue(authError);

    let caughtError: unknown;
    try {
      await withRetry(() =>
        reasonFromDescription("Add auth", [], { dir: tmpDir }),
      );
    } catch (err) {
      caughtError = err;
    }

    // Auth errors must NOT trigger a retry
    expect(mockSpawnClaude).toHaveBeenCalledTimes(1);
    expect(caughtError).toBeInstanceOf(ClaudeClientError);
    expect((caughtError as ClaudeClientError).retryable).toBe(false);
  });
});
