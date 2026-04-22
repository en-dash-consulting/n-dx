/**
 * Integration tests: model resolution precedence and vendor header output
 * for reshape, reorganize, and prune commands.
 *
 * Verifies: explicit --model flag > .n-dx.json config > default
 * for all three commands, matching the smart-add/analyze pattern.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_CLAUDE_MODEL } from "@n-dx/llm-client";

// ── Mocks ────────────────────────────────────────────────────────────

const {
  capturedModels,
  mockReasonForReshape,
  mockPrintVendorModelHeader,
  printHeaderCallOrder,
  reshapeCallOrder,
} = vi.hoisted(() => {
  let callCounter = 0;
  const capturedModels: (string | undefined)[] = [];
  const printHeaderCallOrder: number[] = [];
  const reshapeCallOrder: number[] = [];

  const mockPrintVendorModelHeader = vi.fn(() => {
    printHeaderCallOrder.push(++callCounter);
  });

  const mockReasonForReshape = vi.fn(async (
    _items: unknown[],
    options?: { model?: string },
  ) => {
    capturedModels.push(options?.model);
    reshapeCallOrder.push(++callCounter);
    return {
      proposals: [],
      tokenUsage: { calls: 1, inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCostUsd: 0.001 },
    };
  });

  return {
    capturedModels,
    mockReasonForReshape,
    mockPrintVendorModelHeader,
    printHeaderCallOrder,
    reshapeCallOrder,
  };
});

vi.mock("@n-dx/llm-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@n-dx/llm-client")>();
  return {
    ...actual,
    printVendorModelHeader: mockPrintVendorModelHeader,
  };
});

vi.mock("../../src/analyze/reshape-reason.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/analyze/reshape-reason.js")>();
  return {
    ...actual,
    reasonForReshape: mockReasonForReshape,
  };
});

// Suppress budget check to isolate model resolution
vi.mock("../../src/cli/commands/token-format.js", () => ({
  preflightBudgetCheck: vi.fn().mockResolvedValue(null),
  formatBudgetWarnings: vi.fn().mockReturnValue([]),
}));

import { cmdReshape } from "../../src/cli/commands/reshape.js";
import { cmdReorganize } from "../../src/cli/commands/reorganize.js";

// ── Helpers ──────────────────────────────────────────────────────────

let tmpDir: string;
let rexDir: string;

async function setupTmpDir(ndxConfig?: Record<string, unknown>): Promise<void> {
  tmpDir = await mkdtemp(join(tmpdir(), "rex-model-resolution-"));
  rexDir = join(tmpDir, ".rex");
  await mkdir(rexDir, { recursive: true });

  // Minimal PRD with one item so commands don't bail early
  await writeFile(
    join(rexDir, "prd.json"),
    JSON.stringify({
      schema: "rex/v1",
      title: "Test",
      items: [
        {
          id: "epic-1",
          title: "Test Epic",
          level: "epic",
          status: "in_progress",
          priority: "high",
          children: [],
        },
      ],
    }),
  );
  await writeFile(
    join(rexDir, "config.json"),
    JSON.stringify({ schema: "rex/v1", project: "test", adapter: "file" }),
  );

  if (ndxConfig) {
    await writeFile(join(tmpDir, ".n-dx.json"), JSON.stringify(ndxConfig));
  }
}

function resetMocks(): void {
  capturedModels.length = 0;
  printHeaderCallOrder.length = 0;
  reshapeCallOrder.length = 0;
  mockReasonForReshape.mockClear();
  mockPrintVendorModelHeader.mockClear();
}

// ── Setup / teardown ─────────────────────────────────────────────────

let originalLog: typeof console.log;
let originalError: typeof console.error;

beforeEach(() => {
  resetMocks();
  originalLog = console.log;
  originalError = console.error;
  console.log = vi.fn();
  console.error = vi.fn();
});

afterEach(async () => {
  console.log = originalLog;
  console.error = originalError;
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
  }
  vi.clearAllMocks();
});

// ── reshape ──────────────────────────────────────────────────────────

describe("cmdReshape model resolution", () => {
  it("uses default model when no flag and no config", async () => {
    await setupTmpDir();
    await cmdReshape(tmpDir, {});

    expect(mockReasonForReshape).toHaveBeenCalledTimes(1);
    expect(capturedModels[0]).toBe(DEFAULT_CLAUDE_MODEL);
  });

  it("uses configured model from .n-dx.json", async () => {
    await setupTmpDir({
      llm: { vendor: "claude", claude: { model: "claude-opus-4-6" } },
      claude: { model: "claude-opus-4-6" },
    });
    await cmdReshape(tmpDir, {});

    expect(capturedModels[0]).toBe("claude-opus-4-6");
  });

  it("explicit --model flag takes precedence over config", async () => {
    await setupTmpDir({
      llm: { vendor: "claude", claude: { model: "claude-opus-4-6" } },
      claude: { model: "claude-opus-4-6" },
    });
    await cmdReshape(tmpDir, { model: "claude-haiku-4-6" });

    expect(capturedModels[0]).toBe("claude-haiku-4-6");
  });

  it("calls printVendorModelHeader before reasonForReshape", async () => {
    await setupTmpDir();
    await cmdReshape(tmpDir, {});

    expect(mockPrintVendorModelHeader).toHaveBeenCalledTimes(1);
    expect(mockReasonForReshape).toHaveBeenCalledTimes(1);
    expect(printHeaderCallOrder[0]).toBeLessThan(reshapeCallOrder[0]);
  });

  it("reports cli-override source when --model flag is used", async () => {
    await setupTmpDir();
    await cmdReshape(tmpDir, { model: "claude-haiku-4-6" });

    expect(mockPrintVendorModelHeader).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ modelSource: "cli-override" }),
    );
  });

  it("reports configured source when .n-dx.json has model", async () => {
    await setupTmpDir({
      llm: { vendor: "claude", claude: { model: "claude-opus-4-6" } },
      claude: { model: "claude-opus-4-6" },
    });
    await cmdReshape(tmpDir, {});

    expect(mockPrintVendorModelHeader).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ modelSource: "configured" }),
    );
  });

  it("reports default source when no model configured", async () => {
    await setupTmpDir();
    await cmdReshape(tmpDir, {});

    expect(mockPrintVendorModelHeader).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ modelSource: "default" }),
    );
  });

  it("suppresses header in json format", async () => {
    await setupTmpDir();
    await cmdReshape(tmpDir, { format: "json" });

    expect(mockPrintVendorModelHeader).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ format: "json" }),
    );
  });
});

// ── reorganize ───────────────────────────────────────────────────────

describe("cmdReorganize model resolution", () => {
  it("uses default model when no flag and no config", async () => {
    await setupTmpDir();
    await cmdReorganize(tmpDir, {});

    expect(mockReasonForReshape).toHaveBeenCalledTimes(1);
    expect(capturedModels[0]).toBe(DEFAULT_CLAUDE_MODEL);
  });

  it("uses configured model from .n-dx.json", async () => {
    await setupTmpDir({
      llm: { vendor: "claude", claude: { model: "claude-opus-4-6" } },
      claude: { model: "claude-opus-4-6" },
    });
    await cmdReorganize(tmpDir, {});

    expect(capturedModels[0]).toBe("claude-opus-4-6");
  });

  it("explicit --model flag takes precedence over config", async () => {
    await setupTmpDir({
      llm: { vendor: "claude", claude: { model: "claude-opus-4-6" } },
      claude: { model: "claude-opus-4-6" },
    });
    await cmdReorganize(tmpDir, { model: "claude-haiku-4-6" });

    expect(capturedModels[0]).toBe("claude-haiku-4-6");
  });

  it("calls printVendorModelHeader before reasonForReshape", async () => {
    await setupTmpDir();
    await cmdReorganize(tmpDir, {});

    expect(mockPrintVendorModelHeader).toHaveBeenCalledTimes(1);
    expect(mockReasonForReshape).toHaveBeenCalledTimes(1);
    expect(printHeaderCallOrder[0]).toBeLessThan(reshapeCallOrder[0]);
  });

  it("reports cli-override source when --model flag is used", async () => {
    await setupTmpDir();
    await cmdReorganize(tmpDir, { model: "claude-haiku-4-6" });

    expect(mockPrintVendorModelHeader).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ modelSource: "cli-override" }),
    );
  });

  it("skips LLM analysis (and header) with --fast", async () => {
    await setupTmpDir();
    await cmdReorganize(tmpDir, { fast: "true" });

    expect(mockPrintVendorModelHeader).not.toHaveBeenCalled();
    expect(mockReasonForReshape).not.toHaveBeenCalled();
  });
});

// ── prune (smart) ────────────────────────────────────────────────────

// smartPrune is tested via cmdPrune with smart=true.
// We need a separate dynamic import to avoid module cache issues with prune.
describe("smartPrune model resolution", () => {
  it("uses default model when no flag and no config", async () => {
    await setupTmpDir();
    const { cmdPrune } = await import("../../src/cli/commands/prune.js");
    await cmdPrune(tmpDir, { smart: "true" });

    expect(mockReasonForReshape).toHaveBeenCalledTimes(1);
    expect(capturedModels[0]).toBe(DEFAULT_CLAUDE_MODEL);
  });

  it("uses configured model from .n-dx.json", async () => {
    await setupTmpDir({
      llm: { vendor: "claude", claude: { model: "claude-opus-4-6" } },
      claude: { model: "claude-opus-4-6" },
    });
    const { cmdPrune } = await import("../../src/cli/commands/prune.js");
    await cmdPrune(tmpDir, { smart: "true" });

    expect(capturedModels[0]).toBe("claude-opus-4-6");
  });

  it("explicit --model flag takes precedence over config", async () => {
    await setupTmpDir({
      llm: { vendor: "claude", claude: { model: "claude-opus-4-6" } },
      claude: { model: "claude-opus-4-6" },
    });
    const { cmdPrune } = await import("../../src/cli/commands/prune.js");
    await cmdPrune(tmpDir, { smart: "true", model: "claude-haiku-4-6" });

    expect(capturedModels[0]).toBe("claude-haiku-4-6");
  });

  it("calls printVendorModelHeader before reasonForReshape", async () => {
    await setupTmpDir();
    const { cmdPrune } = await import("../../src/cli/commands/prune.js");
    await cmdPrune(tmpDir, { smart: "true" });

    expect(mockPrintVendorModelHeader).toHaveBeenCalledTimes(1);
    expect(mockReasonForReshape).toHaveBeenCalledTimes(1);
    expect(printHeaderCallOrder[0]).toBeLessThan(reshapeCallOrder[0]);
  });

  it("reports cli-override source when --model flag is used", async () => {
    await setupTmpDir();
    const { cmdPrune } = await import("../../src/cli/commands/prune.js");
    await cmdPrune(tmpDir, { smart: "true", model: "claude-haiku-4-6" });

    expect(mockPrintVendorModelHeader).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ modelSource: "cli-override" }),
    );
  });
});
