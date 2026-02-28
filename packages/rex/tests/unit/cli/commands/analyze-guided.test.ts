import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock the guided module
vi.mock("../../../../src/analyze/guided.js", () => ({
  runGuidedSpec: vi.fn(),
}));

// Mock scanners and LLM reasoning to return empty results
vi.mock("../../../../src/analyze/scanners.js", () => ({
  scanTests: vi.fn().mockResolvedValue([]),
  scanDocs: vi.fn().mockResolvedValue([]),
  scanSourceVision: vi.fn().mockResolvedValue([]),
  scanPackageJson: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../../src/analyze/dedupe.js", () => ({
  deduplicateScanResults: vi.fn().mockReturnValue([]),
}));

vi.mock("../../../../src/analyze/reconcile.js", () => ({
  reconcile: vi.fn().mockReturnValue({
    results: [],
    stats: { total: 0, newCount: 0, alreadyTracked: 0 },
  }),
}));

vi.mock("../../../../src/analyze/propose.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/analyze/propose.js")>();
  return {
    ...actual,
    buildProposals: vi.fn().mockReturnValue([]),
  };
});

vi.mock("../../../../src/analyze/reason.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/analyze/reason.js")>();
  return {
    ...actual,
    reasonFromScanResults: vi.fn().mockResolvedValue({
      proposals: [],
      tokenUsage: { calls: 0, inputTokens: 0, outputTokens: 0 },
    }),
  };
});

import { cmdAnalyze } from "../../../../src/cli/commands/analyze.js";
import { runGuidedSpec } from "../../../../src/analyze/guided.js";
import type { Proposal } from "../../../../src/analyze/propose.js";

const mockRunGuidedSpec = vi.mocked(runGuidedSpec);

// Capture console output
let consoleOutput: string[];
const origLog = console.log;
const origError = console.error;

function captureConsole() {
  consoleOutput = [];
  console.log = (...args: unknown[]) => consoleOutput.push(args.join(" "));
  console.error = (...args: unknown[]) => consoleOutput.push(args.join(" "));
}

function restoreConsole() {
  console.log = origLog;
  console.error = origError;
}

describe("analyze --guided integration", () => {
  let tmpDir: string;
  let origIsTTY: boolean | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await mkdtemp(join(tmpdir(), "rex-analyze-guided-"));
    await mkdir(join(tmpDir, ".rex"), { recursive: true });
    // Create a minimal valid PRD document (empty items)
    await writeFile(
      join(tmpDir, ".rex", "prd.json"),
      JSON.stringify({ schema: "rex/v1", title: "Test", items: [] }),
    );
    // Create config so store operations work
    await writeFile(
      join(tmpDir, ".rex", "config.json"),
      JSON.stringify({ schema: "rex/v1", project: "test", adapter: "file" }),
    );
    origIsTTY = process.stdin.isTTY;
    captureConsole();
  });

  afterEach(async () => {
    restoreConsole();
    process.stdin.isTTY = origIsTTY as boolean;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("invokes guided flow when empty PRD + no scan results + isTTY", async () => {
    process.stdin.isTTY = true;
    mockRunGuidedSpec.mockResolvedValue({
      proposals: [],
      tokenUsage: { calls: 0, inputTokens: 0, outputTokens: 0 },
    });

    await cmdAnalyze(tmpDir, {});

    expect(mockRunGuidedSpec).toHaveBeenCalledWith(tmpDir, undefined);
  });

  it("invokes guided flow when --guided flag is set", async () => {
    process.stdin.isTTY = true;
    mockRunGuidedSpec.mockResolvedValue({
      proposals: [],
      tokenUsage: { calls: 0, inputTokens: 0, outputTokens: 0 },
    });

    await cmdAnalyze(tmpDir, { guided: "true" });

    expect(mockRunGuidedSpec).toHaveBeenCalledWith(tmpDir, undefined);
  });

  it("does NOT invoke guided flow when --no-llm is set", async () => {
    process.stdin.isTTY = true;

    await cmdAnalyze(tmpDir, { "no-llm": "true" });

    expect(mockRunGuidedSpec).not.toHaveBeenCalled();
    const output = consoleOutput.join("\n");
    expect(output).toContain("No new proposals found.");
  });

  it("prints hint when non-TTY without --guided flag", async () => {
    process.stdin.isTTY = false;

    await cmdAnalyze(tmpDir, {});

    expect(mockRunGuidedSpec).not.toHaveBeenCalled();
    const output = consoleOutput.join("\n");
    expect(output).toContain("n-dx plan --guided");
  });

  it("throws CLIError when --guided in non-TTY", async () => {
    process.stdin.isTTY = false;

    await expect(
      cmdAnalyze(tmpDir, { guided: "true" }),
    ).rejects.toThrow("interactive terminal");
  });

  it("displays proposals when guided flow returns results", async () => {
    process.stdin.isTTY = true;

    const mockProposals: Proposal[] = [
      {
        epic: { title: "Auth System", source: "llm" },
        features: [
          {
            title: "Login",
            source: "llm",
            tasks: [
              {
                title: "Implement login form",
                source: "llm",
                sourceFile: "",
                priority: "high",
              },
            ],
          },
        ],
      },
    ];
    mockRunGuidedSpec.mockResolvedValue({
      proposals: mockProposals,
      tokenUsage: { calls: 1, inputTokens: 1000, outputTokens: 500 },
    });

    await cmdAnalyze(tmpDir, { guided: "true", accept: "true" });

    // Should have displayed and accepted the proposals
    const output = consoleOutput.join("\n");
    expect(output).toContain("Auth System");

    const logPath = join(tmpDir, ".rex", "execution-log.jsonl");
    const lines = (await readFile(logPath, "utf-8"))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const entries = lines.map((line) => JSON.parse(line) as { event: string; detail?: string });
    const tokenEntry = entries.find((entry) => entry.event === "analyze_token_usage");
    expect(tokenEntry).toBeDefined();
    const detail = JSON.parse(tokenEntry!.detail ?? "{}") as { vendor?: string; model?: string };
    expect(detail.vendor).toBeTruthy();
    expect(detail.model).toBeTruthy();
  });
});
