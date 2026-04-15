/**
 * Unit tests for vendor-specific prompt delivery via adapters.
 *
 * Verifies the three acceptance criteria:
 * 1. Claude adapter uses assemblePrompt() for system/task split
 * 2. Codex adapter formats with SYSTEM/TASK headers
 * 3. Prompt section names and sizes logged in run diagnostics
 *
 * @see packages/hench/src/agent/lifecycle/adapters/claude-cli-adapter.ts
 * @see packages/hench/src/agent/lifecycle/adapters/codex-cli-adapter.ts
 * @see packages/hench/src/agent/lifecycle/prompt-diagnostics.ts
 * @see packages/hench/src/schema/v1.ts — PromptSectionDiagnostic, RunDiagnostics
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createPromptEnvelope,
  assemblePrompt,
  DEFAULT_EXECUTION_POLICY,
} from "../../../src/prd/llm-gateway.js";
import type { PromptEnvelope, ExecutionPolicy } from "../../../src/prd/llm-gateway.js";
import { claudeCliAdapter } from "../../../src/agent/lifecycle/adapters/claude-cli-adapter.js";
import { codexCliAdapter } from "../../../src/agent/lifecycle/adapters/codex-cli-adapter.js";
import {
  extractPromptSectionDiagnostics,
  logPromptSections,
} from "../../../src/agent/lifecycle/prompt-diagnostics.js";
import type { PromptSectionDiagnostic, RunDiagnostics } from "../../../src/schema/v1.js";
import {
  FULL_PROMPT_SECTIONS,
  MINIMAL_PROMPT_SECTIONS,
  STANDARD_POLICY,
  FULL_ACCESS_POLICY,
} from "../../fixtures/cross-vendor-runtime.js";

// ── Helpers ──────────────────────────────────────────────────────────────

function createFullEnvelope(): PromptEnvelope {
  return createPromptEnvelope([...FULL_PROMPT_SECTIONS]);
}

function createMinimalEnvelope(): PromptEnvelope {
  return createPromptEnvelope([...MINIMAL_PROMPT_SECTIONS]);
}

// ── 1. Claude adapter uses assemblePrompt() for system/task split ─────

describe("AC1: Claude adapter uses assemblePrompt() for system/task split", () => {
  it("buildSpawnConfig produces output consistent with assemblePrompt", () => {
    const envelope = createFullEnvelope();
    const { systemPrompt, taskPrompt } = assemblePrompt(envelope);

    const config = claudeCliAdapter.buildSpawnConfig(envelope, DEFAULT_EXECUTION_POLICY, undefined);

    // On non-Windows, system prompt is in --system-prompt arg
    if (process.platform !== "win32") {
      const sysIdx = config.args.indexOf("--system-prompt");
      expect(sysIdx).toBeGreaterThan(-1);
      expect(config.args[sysIdx + 1]).toBe(systemPrompt);
    }

    // Task prompt is in stdin content
    expect(config.stdinContent).toBe(taskPrompt);
  });

  it("system sections (system + workflow) go to --system-prompt, task sections to stdin", () => {
    if (process.platform === "win32") return;

    const envelope = createFullEnvelope();
    const config = claudeCliAdapter.buildSpawnConfig(envelope, DEFAULT_EXECUTION_POLICY, undefined);

    const sysIdx = config.args.indexOf("--system-prompt");
    const systemArg = config.args[sysIdx + 1] as string;
    const stdinContent = config.stdinContent!;

    // System prompt should contain system and workflow content
    expect(systemArg).toContain("You are Hench, an autonomous AI agent.");
    expect(systemArg).toContain("Follow TDD: red → green → refactor.");

    // Stdin (task) should contain brief, files, validation, completion
    expect(stdinContent).toContain("Implement user authentication with JWT.");
    expect(stdinContent).toContain("src/auth.ts — existing auth module.");
    expect(stdinContent).toContain("Run `npm test` and `npm run typecheck`.");
    expect(stdinContent).toContain("Done when all tests pass and types check.");

    // Task content should NOT be in system prompt
    expect(systemArg).not.toContain("Implement user authentication with JWT.");
    // System content should NOT be in stdin
    expect(stdinContent).not.toContain("You are Hench, an autonomous AI agent.");
  });

  it("minimal envelope: system goes to --system-prompt, brief to stdin", () => {
    if (process.platform === "win32") return;

    const envelope = createMinimalEnvelope();
    const config = claudeCliAdapter.buildSpawnConfig(envelope, DEFAULT_EXECUTION_POLICY, undefined);

    const sysIdx = config.args.indexOf("--system-prompt");
    const systemArg = config.args[sysIdx + 1] as string;

    expect(systemArg).toBe("You are Hench.");
    expect(config.stdinContent).toBe("Fix the bug.");
  });

  it("model override is passed through correctly", () => {
    const envelope = createMinimalEnvelope();
    const config = claudeCliAdapter.buildSpawnConfig(envelope, DEFAULT_EXECUTION_POLICY, "claude-opus-4");

    expect(config.args).toContain("--model");
    expect(config.args).toContain("claude-opus-4");
  });
});

// ── 2. Codex adapter formats with SYSTEM/TASK headers ──────────────────

describe("AC2: Codex adapter formats with SYSTEM/TASK headers", () => {
  it("buildSpawnConfig produces SYSTEM/TASK formatted prompt as last arg", () => {
    const envelope = createFullEnvelope();
    const config = codexCliAdapter.buildSpawnConfig(envelope, DEFAULT_EXECUTION_POLICY, undefined);

    const lastArg = config.args[config.args.length - 1] as string;
    expect(lastArg).toContain("SYSTEM:");
    expect(lastArg).toContain("TASK:");
  });

  it("SYSTEM section contains system + workflow content", () => {
    const envelope = createFullEnvelope();
    const config = codexCliAdapter.buildSpawnConfig(envelope, DEFAULT_EXECUTION_POLICY, undefined);

    const lastArg = config.args[config.args.length - 1] as string;

    // Extract the SYSTEM section (between SYSTEM: and TASK:)
    const systemStart = lastArg.indexOf("SYSTEM:\n") + "SYSTEM:\n".length;
    const taskStart = lastArg.indexOf("\n\nTASK:\n");
    const systemSection = lastArg.slice(systemStart, taskStart);

    expect(systemSection).toContain("You are Hench, an autonomous AI agent.");
    expect(systemSection).toContain("Follow TDD: red → green → refactor.");
  });

  it("TASK section contains brief, files, validation, completion content", () => {
    const envelope = createFullEnvelope();
    const config = codexCliAdapter.buildSpawnConfig(envelope, DEFAULT_EXECUTION_POLICY, undefined);

    const lastArg = config.args[config.args.length - 1] as string;

    // Extract the TASK section (after TASK:)
    const taskStart = lastArg.indexOf("TASK:\n") + "TASK:\n".length;
    const taskSection = lastArg.slice(taskStart);

    expect(taskSection).toContain("Implement user authentication with JWT.");
    expect(taskSection).toContain("src/auth.ts — existing auth module.");
    expect(taskSection).toContain("Run `npm test` and `npm run typecheck`.");
    expect(taskSection).toContain("Done when all tests pass and types check.");
  });

  it("SYSTEM/TASK format matches assemblePrompt output", () => {
    const envelope = createFullEnvelope();
    const { systemPrompt, taskPrompt } = assemblePrompt(envelope);

    const config = codexCliAdapter.buildSpawnConfig(envelope, DEFAULT_EXECUTION_POLICY, undefined);
    const lastArg = config.args[config.args.length - 1] as string;

    const expected = `SYSTEM:\n${systemPrompt}\n\nTASK:\n${taskPrompt}`;
    expect(lastArg).toBe(expected);
  });

  it("minimal envelope produces correct SYSTEM/TASK format", () => {
    const envelope = createMinimalEnvelope();
    const config = codexCliAdapter.buildSpawnConfig(envelope, DEFAULT_EXECUTION_POLICY, undefined);

    const lastArg = config.args[config.args.length - 1] as string;
    expect(lastArg).toBe("SYSTEM:\nYou are Hench.\n\nTASK:\nFix the bug.");
  });

  it("stdinContent is null (Codex uses args, not stdin)", () => {
    const envelope = createMinimalEnvelope();
    const config = codexCliAdapter.buildSpawnConfig(envelope, DEFAULT_EXECUTION_POLICY, undefined);

    expect(config.stdinContent).toBeNull();
  });

  it("model override is passed through correctly", () => {
    const envelope = createMinimalEnvelope();
    const config = codexCliAdapter.buildSpawnConfig(envelope, DEFAULT_EXECUTION_POLICY, "gpt-5-codex");

    expect(config.args).toContain("-m");
    expect(config.args).toContain("gpt-5-codex");
  });
});

// ── 3. Prompt section names and sizes logged in run diagnostics ────────

describe("AC3: extractPromptSectionDiagnostics", () => {
  it("extracts all section names from a full envelope", () => {
    const envelope = createFullEnvelope();
    const diags = extractPromptSectionDiagnostics(envelope);

    expect(diags).toHaveLength(6);
    expect(diags.map((d) => d.name)).toEqual([
      "system", "workflow", "brief", "files", "validation", "completion",
    ]);
  });

  it("extracts correct byte lengths (UTF-8)", () => {
    const envelope = createPromptEnvelope([
      { name: "system", content: "Hello" },       // 5 bytes
      { name: "brief", content: "café" },          // 5 bytes (é is 2 bytes in UTF-8)
      { name: "workflow", content: "日本語" },      // 9 bytes (3 bytes per CJK char)
    ]);

    const diags = extractPromptSectionDiagnostics(envelope);

    expect(diags).toHaveLength(3);
    expect(diags[0]).toEqual({ name: "system", byteLength: 5 });
    expect(diags[1]).toEqual({ name: "brief", byteLength: 5 });
    expect(diags[2]).toEqual({ name: "workflow", byteLength: 9 });
  });

  it("handles minimal envelope", () => {
    const envelope = createMinimalEnvelope();
    const diags = extractPromptSectionDiagnostics(envelope);

    expect(diags).toHaveLength(2);
    expect(diags[0].name).toBe("system");
    expect(diags[0].byteLength).toBe(Buffer.byteLength("You are Hench.", "utf8"));
    expect(diags[1].name).toBe("brief");
    expect(diags[1].byteLength).toBe(Buffer.byteLength("Fix the bug.", "utf8"));
  });

  it("handles empty envelope", () => {
    const envelope = createPromptEnvelope([]);
    const diags = extractPromptSectionDiagnostics(envelope);

    expect(diags).toHaveLength(0);
  });

  it("handles large sections", () => {
    const largeContent = "x".repeat(100_000);
    const envelope = createPromptEnvelope([
      { name: "system", content: largeContent },
    ]);

    const diags = extractPromptSectionDiagnostics(envelope);

    expect(diags).toHaveLength(1);
    expect(diags[0].byteLength).toBe(100_000);
  });
});

describe("AC3: logPromptSections", () => {
  let detailSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    // Spy on the detail function from the output module
    const output = await import("../../../src/types/output.js");
    detailSpy = vi.spyOn(output, "detail").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs one line per section plus a total line", () => {
    const sections: PromptSectionDiagnostic[] = [
      { name: "system", byteLength: 100 },
      { name: "brief", byteLength: 200 },
    ];

    logPromptSections(sections);

    // 2 section lines + 1 total line = 3 calls
    expect(detailSpy).toHaveBeenCalledTimes(3);
  });

  it("formats section lines with name and byte size", () => {
    const sections: PromptSectionDiagnostic[] = [
      { name: "system", byteLength: 1234 },
      { name: "workflow", byteLength: 567 },
    ];

    logPromptSections(sections);

    expect(detailSpy).toHaveBeenCalledWith('  prompt section "system": 1234 bytes');
    expect(detailSpy).toHaveBeenCalledWith('  prompt section "workflow": 567 bytes');
  });

  it("includes correct total in the summary line", () => {
    const sections: PromptSectionDiagnostic[] = [
      { name: "system", byteLength: 100 },
      { name: "brief", byteLength: 200 },
      { name: "files", byteLength: 300 },
    ];

    logPromptSections(sections);

    expect(detailSpy).toHaveBeenCalledWith("  prompt total: 600 bytes (3 sections)");
  });

  it("handles empty sections array", () => {
    logPromptSections([]);

    // Just the total line
    expect(detailSpy).toHaveBeenCalledTimes(1);
    expect(detailSpy).toHaveBeenCalledWith("  prompt total: 0 bytes (0 sections)");
  });
});

describe("AC3: RunDiagnostics promptSections field", () => {
  it("RunDiagnostics type accepts promptSections array", () => {
    // Type-level: this must compile
    const diag: RunDiagnostics = {
      tokenDiagnosticStatus: "unavailable",
      parseMode: "stream-json",
      notes: [],
      promptSections: [
        { name: "system", byteLength: 100 },
        { name: "brief", byteLength: 200 },
      ],
    };

    expect(diag.promptSections).toHaveLength(2);
    expect(diag.promptSections![0].name).toBe("system");
    expect(diag.promptSections![0].byteLength).toBe(100);
  });

  it("RunDiagnostics works without promptSections (backward compat)", () => {
    const diag: RunDiagnostics = {
      tokenDiagnosticStatus: "complete",
      parseMode: "json",
      notes: ["codex_usage_partial"],
    };

    expect(diag.promptSections).toBeUndefined();
  });

  it("extractPromptSectionDiagnostics produces Zod-valid diagnostics", async () => {
    const { RunRecordSchema } = await import("../../../src/schema/validate.js");

    const envelope = createFullEnvelope();
    const sectionDiags = extractPromptSectionDiagnostics(envelope);

    const record = {
      id: "test-run-id",
      taskId: "test-task-id",
      taskTitle: "Test Task",
      startedAt: new Date().toISOString(),
      status: "completed",
      turns: 5,
      tokenUsage: { input: 100, output: 200 },
      toolCalls: [],
      model: "sonnet",
      diagnostics: {
        tokenDiagnosticStatus: "unavailable",
        parseMode: "stream-json",
        notes: [],
        promptSections: sectionDiags,
      },
    };

    const result = RunRecordSchema.safeParse(record);
    expect(result.success).toBe(true);
  });
});

// ── Cross-vendor parity: both adapters produce consistent prompt splits ──

describe("Cross-vendor parity: prompt delivery", () => {
  it("both adapters operate on the same envelope and produce consistent prompt text", () => {
    const envelope = createFullEnvelope();
    const { systemPrompt, taskPrompt } = assemblePrompt(envelope);

    // Claude: system in args, task in stdin
    const claudeConfig = claudeCliAdapter.buildSpawnConfig(envelope, DEFAULT_EXECUTION_POLICY, undefined);

    // Codex: both in args as SYSTEM:/TASK:
    const codexConfig = codexCliAdapter.buildSpawnConfig(envelope, DEFAULT_EXECUTION_POLICY, undefined);

    if (process.platform !== "win32") {
      const sysIdx = claudeConfig.args.indexOf("--system-prompt");
      expect(claudeConfig.args[sysIdx + 1]).toBe(systemPrompt);
    }
    expect(claudeConfig.stdinContent).toBe(taskPrompt);

    const codexPrompt = codexConfig.args[codexConfig.args.length - 1] as string;
    expect(codexPrompt).toContain(systemPrompt);
    expect(codexPrompt).toContain(taskPrompt);
  });

  it("prompt section diagnostics are identical for the same envelope regardless of adapter", () => {
    const envelope = createFullEnvelope();

    // buildSpawnConfig doesn't affect the envelope — diagnostics should be the same
    claudeCliAdapter.buildSpawnConfig(envelope, DEFAULT_EXECUTION_POLICY, undefined);
    codexCliAdapter.buildSpawnConfig(envelope, DEFAULT_EXECUTION_POLICY, undefined);

    const diags = extractPromptSectionDiagnostics(envelope);

    expect(diags).toHaveLength(6);
    expect(diags.every((d) => d.byteLength > 0)).toBe(true);
  });
});
