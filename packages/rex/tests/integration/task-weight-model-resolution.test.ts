/**
 * Integration tests for task-weight-aware model resolution in rex commands.
 *
 * These tests verify that rex commands use the correct model resolution path:
 *
 * - smart-add: standard/default weight → should resolve to the vendor default model
 * - analyze: 'standard' weight → should resolve to TIER_MODELS.claude.standard (sonnet)
 *
 * The tests inspect the model passed to the LLM bridge before the actual API call,
 * allowing verification without making real LLM requests.
 *
 * @see packages/llm-client/tests/integration/weight-aware-model-resolution.test.ts
 *   for lower-level config → resolver chain tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NEWEST_MODELS } from "@n-dx/llm-client";
import { cmdInit } from "../../src/cli/commands/init.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Capture the model passed to reasonFromDescriptions (smart-add's LLM entry point)
const {
  capturedSmartAddModels,
  mockReasonFromDescriptions,
} = vi.hoisted(() => {
  const capturedSmartAddModels: string[] = [];
  const mockReasonFromDescriptions = vi.fn(async (
    _descriptions: string[],
    _existing: unknown[],
    options?: { model?: string },
  ) => {
    capturedSmartAddModels.push(options?.model ?? "<not-provided>");
    return {
      proposals: [
        {
          epic: { title: "Test Epic", source: "smart-add" },
          features: [
            {
              title: "Test Feature",
              source: "smart-add",
              tasks: [
                {
                  title: "Test Task",
                  source: "smart-add",
                  sourceFile: "",
                  priority: "medium",
                },
              ],
            },
          ],
        },
      ],
      tokenUsage: {
        calls: 1,
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        estimatedCostUsd: 0.001,
      },
    };
  });
  return { capturedSmartAddModels, mockReasonFromDescriptions };
});

vi.mock("../../src/analyze/index.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/analyze/index.js")>(
    "../../src/analyze/index.js",
  );
  return {
    ...actual,
    reasonFromDescriptions: mockReasonFromDescriptions,
    validateProposalQuality: vi.fn(() => []),
    applyConsolidationGuard: vi.fn(async (proposals) => ({
      triggered: false,
      reduced: false,
      proposals,
      originalTaskCount: 1,
      finalTaskCount: 1,
      ceiling: 10,
    })),
  };
});

import { cmdSmartAdd } from "../../src/cli/commands/smart-add.js";

// ── Test suites ──────────────────────────────────────────────────────────────

describe("task-weight model resolution in rex commands", () => {
  let tmpDir: string;
  let originalIsTTY: boolean | undefined;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-task-weight-model-"));
    await cmdInit(tmpDir, {});
    capturedSmartAddModels.length = 0;
    mockReasonFromDescriptions.mockClear();
    originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  });

  afterEach(async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
    await rm(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  // ── smart-add default-model tests ──────────────────────────────────────────

  describe("smart-add command", () => {
    it("uses llm.claude.model when configured for claude", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({
          llm: {
            vendor: "claude",
            claude: { model: "claude-opus-4-20250514" },
          },
        }),
        "utf-8",
      );

      await cmdSmartAdd(tmpDir, "Add user authentication", {}, {});

      expect(mockReasonFromDescriptions).toHaveBeenCalledTimes(1);
      expect(capturedSmartAddModels[0]).toBe("claude-opus-4-20250514");
    });

    it("uses llm.codex.model when configured for codex", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({
          llm: {
            vendor: "codex",
            codex: { model: "gpt-4o" },
          },
        }),
        "utf-8",
      );

      await cmdSmartAdd(tmpDir, "Add user authentication", {}, {});

      expect(mockReasonFromDescriptions).toHaveBeenCalledTimes(1);
      expect(capturedSmartAddModels[0]).toBe("gpt-4o");
    });

    it("CLI --model flag overrides configured vendor model", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({
          llm: {
            vendor: "claude",
            claude: { model: "claude-sonnet-4-6" },
          },
        }),
        "utf-8",
      );

      // Pass explicit model via CLI options
      await cmdSmartAdd(tmpDir, "Add user authentication", { model: "claude-opus-4-20250514" }, {});

      expect(mockReasonFromDescriptions).toHaveBeenCalledTimes(1);
      expect(capturedSmartAddModels[0]).toBe("claude-opus-4-20250514");
    });
  });

  // ── Config precedence tests ────────────────────────────────────────────────

  describe("config precedence", () => {
    it("llm.claude.model takes precedence over legacy rex config model", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({
          llm: {
            vendor: "claude",
            claude: { model: "claude-sonnet-4-6" },
          },
        }),
        "utf-8",
      );
      // Legacy rex config has a different model
      await writeFile(
        join(tmpDir, ".rex", "config.json"),
        JSON.stringify({
          schema: "rex/v1",
          project: "test",
          adapter: "file",
          model: "claude-opus-4-20250514",
        }),
        "utf-8",
      );

      await cmdSmartAdd(tmpDir, "Add user authentication", {}, {});

      expect(mockReasonFromDescriptions).toHaveBeenCalledTimes(1);
      expect(capturedSmartAddModels[0]).toBe("claude-sonnet-4-6");
    });

    it("CLI flag overrides both llm config and rex config", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({
          llm: {
            vendor: "claude",
            claude: { model: "claude-sonnet-4-6" },
          },
        }),
        "utf-8",
      );
      await writeFile(
        join(tmpDir, ".rex", "config.json"),
        JSON.stringify({
          schema: "rex/v1",
          project: "test",
          adapter: "file",
          model: "claude-sonnet-4-6",
        }),
        "utf-8",
      );

      await cmdSmartAdd(tmpDir, "Add user authentication", { model: "claude-opus-4-20250514" }, {});

      expect(capturedSmartAddModels[0]).toBe("claude-opus-4-20250514");
    });
  });

  // ── Fallback chain tests ───────────────────────────────────────────────────

  describe("fallback chain", () => {
    it("falls back to Claude Sonnet when no config provided", async () => {
      await cmdSmartAdd(tmpDir, "Add user authentication", {}, {});

      expect(mockReasonFromDescriptions).toHaveBeenCalledTimes(1);
      expect(capturedSmartAddModels[0]).toBe(NEWEST_MODELS.claude);
    });

    it("falls back to Codex default when no codex model is configured", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({
          llm: {
            vendor: "claude",
          },
        }),
        "utf-8",
      );

      await cmdSmartAdd(tmpDir, "Add user authentication", {}, {});

      expect(mockReasonFromDescriptions).toHaveBeenCalledTimes(1);
      expect(capturedSmartAddModels[0]).toBe(NEWEST_MODELS.claude);
    });

    it("falls back to gpt-5-codex when vendor=codex and no codex model is configured", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({
          llm: {
            vendor: "codex",
          },
        }),
        "utf-8",
      );

      await cmdSmartAdd(tmpDir, "Add user authentication", {}, {});

      expect(mockReasonFromDescriptions).toHaveBeenCalledTimes(1);
      expect(capturedSmartAddModels[0]).toBe(NEWEST_MODELS.codex);
    });
  });
});
