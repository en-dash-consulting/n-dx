import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const {
  capturedModels,
  mockComplete,
  mockCreateLLMClient,
  mockPrintVendorModelHeader,
} = vi.hoisted(() => {
  const capturedModels: string[] = [];
  const mockComplete = vi.fn(async ({ model }: { model?: string }) => {
    if (model) capturedModels.push(model);
    return {
      text: JSON.stringify([
        {
          epic: { title: "Auth" },
          features: [
            {
              title: "Login",
              tasks: [
                { title: "Implement login form", priority: "high" },
              ],
            },
          ],
        },
      ]),
      tokenUsage: { input: 12, output: 8 },
    };
  });
  const mockCreateLLMClient = vi.fn(() => ({
    mode: "api" as const,
    complete: mockComplete,
  }));
  const mockPrintVendorModelHeader = vi.fn();

  return {
    capturedModels,
    mockComplete,
    mockCreateLLMClient,
    mockPrintVendorModelHeader,
  };
});

vi.mock("@n-dx/llm-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@n-dx/llm-client")>();
  return {
    ...actual,
    createLLMClient: mockCreateLLMClient,
    printVendorModelHeader: mockPrintVendorModelHeader,
  };
});

vi.mock("../../src/analyze/scanners.js", () => ({
  scanTests: vi.fn().mockResolvedValue([]),
  scanDocs: vi.fn().mockResolvedValue([
    {
      name: "Authentication flow",
      source: "doc",
      sourceFile: "docs/auth.md",
      kind: "feature",
      description: "User authentication requirements",
      priority: "high",
    },
  ]),
  scanSourceVision: vi.fn().mockResolvedValue({ results: [], staleCount: 0 }),
  scanPackageJson: vi.fn().mockResolvedValue([]),
  scanGoMod: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/analyze/dedupe.js", () => ({
  deduplicateScanResults: vi.fn((results) => results),
}));

vi.mock("../../src/analyze/reconcile.js", () => ({
  reconcile: vi.fn((results) => ({
    results,
    stats: {
      total: results.length,
      newCount: results.length,
      alreadyTracked: 0,
    },
    updateCandidates: [],
  })),
}));

import { cmdAnalyze } from "../../src/cli/commands/analyze.js";

describe("vendor-scoped model selection in rex analyze", () => {
  let tmpDir: string;
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-vendor-model-"));
    await mkdir(join(tmpDir, ".rex"), { recursive: true });
    await writeFile(
      join(tmpDir, ".rex", "prd.json"),
      JSON.stringify({ schema: "rex/v1", title: "Test", items: [] }),
    );
    await writeFile(
      join(tmpDir, ".rex", "config.json"),
      JSON.stringify({ schema: "rex/v1", project: "test", adapter: "file" }),
    );

    capturedModels.length = 0;
    mockComplete.mockClear();
    mockCreateLLMClient.mockClear();
    mockPrintVendorModelHeader.mockClear();

    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    console.log = vi.fn();
    console.error = vi.fn();
  });

  afterEach(async () => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    await rm(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  async function runAnalyzeWithConfig(config: Record<string, unknown>): Promise<string> {
    await writeFile(join(tmpDir, ".n-dx.json"), JSON.stringify(config));

    await cmdAnalyze(tmpDir, { format: "json" });

    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(capturedModels).toHaveLength(1);
    return capturedModels[0];
  }

  it("uses a GPT-family model when vendor=codex", async () => {
    const model = await runAnalyzeWithConfig({
      llm: { vendor: "codex" },
      codex: { model: "gpt-4o" },
    });

    expect(model).toMatch(/^gpt-/i);
  });

  it("uses a Claude-family model when vendor=claude", async () => {
    const model = await runAnalyzeWithConfig({
      llm: { vendor: "claude" },
      claude: { model: "sonnet" },
    });

    expect(model).toMatch(/^claude-/i);
  });
});
