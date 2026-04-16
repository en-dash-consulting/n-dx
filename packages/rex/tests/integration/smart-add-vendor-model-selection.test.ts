import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NEWEST_MODELS } from "@n-dx/llm-client";
import { cmdInit } from "../../src/cli/commands/init.js";

const {
  capturedModels,
  mockReasonFromDescriptions,
} = vi.hoisted(() => {
  const capturedModels: string[] = [];
  const mockReasonFromDescriptions = vi.fn(async (
    _descriptions: string[],
    _existing: unknown[],
    options?: { model?: string },
  ) => {
    capturedModels.push(options?.model ?? "");
    return {
      proposals: [
        {
          epic: { title: "Auth", source: "smart-add" },
          features: [
            {
              title: "Login",
              source: "smart-add",
              tasks: [
                {
                  title: "Implement login form",
                  source: "smart-add",
                  sourceFile: "",
                  priority: "high",
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

  return {
    capturedModels,
    mockReasonFromDescriptions,
  };
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

describe("vendor-scoped model selection in rex add", () => {
  let tmpDir: string;
  let originalIsTTY: boolean | undefined;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-smart-add-vendor-model-"));
    await cmdInit(tmpDir, {});
    capturedModels.length = 0;
    mockReasonFromDescriptions.mockClear();
    originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  });

  afterEach(async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
    await rm(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("uses the codex default when legacy Claude rex config model is incompatible with vendor=codex", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ llm: { vendor: "codex" } }),
      "utf-8",
    );
    await writeFile(
      join(tmpDir, ".rex", "config.json"),
      JSON.stringify({
        schema: "rex/v1",
        project: "test",
        adapter: "file",
        model: "sonnet",  // Claude model incompatible with codex vendor
      }),
      "utf-8",
    );

    await cmdSmartAdd(tmpDir, "Add authentication", {}, {});

    expect(mockReasonFromDescriptions).toHaveBeenCalledTimes(1);
    expect(capturedModels).toEqual([NEWEST_MODELS.codex]);
  });

  it("keeps compatible rex config model for the active vendor", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ llm: { vendor: "codex" } }),
      "utf-8",
    );
    await writeFile(
      join(tmpDir, ".rex", "config.json"),
      JSON.stringify({
        schema: "rex/v1",
        project: "test",
        adapter: "file",
        model: "gpt-4o",
      }),
      "utf-8",
    );

    await cmdSmartAdd(tmpDir, "Add authentication", {}, {});

    expect(mockReasonFromDescriptions).toHaveBeenCalledTimes(1);
    expect(capturedModels).toEqual(["gpt-4o"]);
  });

  it("uses Claude Sonnet by default for base smart-add requests", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ llm: { vendor: "claude" } }),
      "utf-8",
    );

    await cmdSmartAdd(tmpDir, "Add authentication", {}, {});

    expect(mockReasonFromDescriptions).toHaveBeenCalledTimes(1);
    expect(capturedModels).toEqual(["claude-sonnet-4-6"]);
  });
});
