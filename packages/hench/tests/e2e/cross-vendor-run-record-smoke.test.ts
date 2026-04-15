/**
 * E2E smoke tests for cross-vendor run record parity.
 *
 * Validates that a fresh project init → hench run with Claude CLI → save →
 * load produces a structurally identical run record to the same flow with
 * Codex CLI. Only vendor/model fields are allowed to differ.
 *
 * This exercises the full run record lifecycle without spawning real vendor
 * processes (which require credentials):
 *
 *   1. Fresh temp directory with .hench/runs/
 *   2. Process a complete mock vendor event stream through the real parse
 *      functions (processStreamLine / processCodexJsonLine)
 *   3. Build a RunRecord from the CliRunResult (same assembly as cli-loop.ts)
 *   4. Attach structured summary (via buildRunSummary)
 *   5. Save to disk (saveRun)
 *   6. Load from disk (loadRun) — exercises schema validation
 *   7. Assert structural identity between Claude and Codex records
 *
 * @see packages/hench/tests/unit/vendor-adapter-contract.test.ts — unit-level parse parity
 * @see packages/hench/tests/integration/cross-vendor-init-smoke.test.ts — init parity
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  processStreamLine,
  processCodexJsonLine,
} from "../../src/agent/lifecycle/event-accumulator.js";
import type { CliRunResult } from "../../src/agent/lifecycle/event-accumulator.js";
import { saveRun, loadRun } from "../../src/store/runs.js";
import { validateRunRecord, RunRecordSchema } from "../../src/schema/validate.js";
import { buildRunSummary } from "../../src/agent/analysis/summary.js";
import type { RunRecord, TurnTokenUsage } from "../../src/schema/v1.js";

// ── Helpers ──────────────────────────────────────────────────────────────

/** Create a fresh CliRunResult (same shape as cli-loop.ts uses internally). */
function createCliResult(): CliRunResult {
  return {
    turns: 0,
    toolCalls: [],
    tokenUsage: { input: 0, output: 0 },
    turnTokenUsage: [],
  };
}

/**
 * Build a complete RunRecord from a CliRunResult, mimicking what cli-loop.ts
 * does after a successful vendor spawn. This reproduces the real assembly path
 * (initRunRecord → accumulate → syncRunFromAccumulated → finalizeRun) without
 * the I/O side effects of memory monitoring and heartbeating.
 */
function buildRunRecord(
  cliResult: CliRunResult,
  opts: { id: string; model: string; taskId: string; taskTitle: string },
): RunRecord {
  const now = new Date().toISOString();
  const run: RunRecord = {
    id: opts.id,
    taskId: opts.taskId,
    taskTitle: opts.taskTitle,
    startedAt: now,
    finishedAt: now,
    lastActivityAt: now,
    status: cliResult.error ? "failed" : "completed",
    turns: cliResult.turns,
    summary: cliResult.summary,
    error: cliResult.error,
    tokenUsage: { ...cliResult.tokenUsage },
    turnTokenUsage: cliResult.turnTokenUsage,
    toolCalls: cliResult.toolCalls,
    model: opts.model,
    structuredSummary: buildRunSummary(cliResult.toolCalls),
    memoryStats: {
      peakRssBytes: 100_000_000,
      systemAvailableAtStartBytes: 4_000_000_000,
      systemAvailableAtEndBytes: 3_900_000_000,
      systemTotalBytes: 16_000_000_000,
    },
  };
  return run;
}

// ── Mock event sequences ─────────────────────────────────────────────────

/**
 * Process a full Claude event sequence through processStreamLine.
 *
 * Scenario: agent reads a file, edits it, then completes.
 * 3 turns, 2 tool calls, 2 token usage events, 1 completion.
 */
function processClaudeSequence(): CliRunResult {
  const result = createCliResult();
  const counter = { value: 0 };
  const meta = { vendor: "claude" as const, model: "sonnet" };

  // Turn 1: Assistant reads a file
  processStreamLine(
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "I will read the auth module first." },
          { type: "tool_use", name: "read_file", input: { path: "src/auth.ts" } },
        ],
        usage: { input_tokens: 500, output_tokens: 120 },
      },
    }),
    result,
    counter,
    meta,
  );

  // Tool result for read
  processStreamLine(
    JSON.stringify({
      type: "tool_result",
      output: "export function validateToken(token: string) { return true; }",
    }),
    result,
    counter,
  );

  // Turn 2: Assistant edits the file
  processStreamLine(
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "I see the bug. The token validation is always returning true. Let me fix it." },
          {
            type: "tool_use",
            name: "write_file",
            input: { path: "src/auth.ts", content: "export function validateToken(token: string) { return jwt.verify(token); }" },
          },
        ],
        usage: { input_tokens: 800, output_tokens: 200 },
      },
    }),
    result,
    counter,
    meta,
  );

  // Tool result for write
  processStreamLine(
    JSON.stringify({
      type: "tool_result",
      output: "File written successfully.",
    }),
    result,
    counter,
  );

  // Turn 3: Assistant runs tests
  processStreamLine(
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Now let me run the tests to verify." },
          { type: "tool_use", name: "run_command", input: { command: "npm test" } },
        ],
        usage: { input_tokens: 1200, output_tokens: 80 },
      },
    }),
    result,
    counter,
    meta,
  );

  // Tool result for test
  processStreamLine(
    JSON.stringify({
      type: "tool_result",
      output: "All tests passed.",
    }),
    result,
    counter,
  );

  // Completion
  processStreamLine(
    JSON.stringify({
      type: "result",
      result: "Fixed JWT validation bug. All tests pass.",
      num_turns: 3,
      cost_usd: 0.08,
    }),
    result,
    counter,
  );

  return result;
}

/**
 * Process the equivalent Codex event sequence through processCodexJsonLine.
 *
 * Same logical scenario as Claude: read → edit → test → complete.
 * Uses Codex event types (message, function_call_output, summary).
 */
function processCodexSequence(): CliRunResult {
  const result = createCliResult();
  const counter = { value: 0 };
  const meta = { vendor: "codex" as const, model: "gpt-5-codex" };

  // Turn 1: Assistant reads a file
  processCodexJsonLine(
    JSON.stringify({
      type: "message",
      content: [
        { type: "text", text: "I will read the auth module first." },
        { type: "tool_use", name: "read_file", input: { path: "src/auth.ts" } },
      ],
      usage: { input_tokens: 500, output_tokens: 120 },
    }),
    result,
    counter,
    meta,
  );

  // Tool result for read
  processCodexJsonLine(
    JSON.stringify({
      type: "function_call_output",
      output: "export function validateToken(token: string) { return true; }",
    }),
    result,
    counter,
  );

  // Turn 2: Assistant edits the file
  processCodexJsonLine(
    JSON.stringify({
      type: "message",
      content: [
        { type: "text", text: "I see the bug. The token validation is always returning true. Let me fix it." },
        {
          type: "tool_use",
          name: "write_file",
          input: { path: "src/auth.ts", content: "export function validateToken(token: string) { return jwt.verify(token); }" },
        },
      ],
      usage: { input_tokens: 800, output_tokens: 200 },
    }),
    result,
    counter,
    meta,
  );

  // Tool result for write
  processCodexJsonLine(
    JSON.stringify({
      type: "function_call_output",
      output: "File written successfully.",
    }),
    result,
    counter,
  );

  // Turn 3: Assistant runs tests
  processCodexJsonLine(
    JSON.stringify({
      type: "message",
      content: [
        { type: "text", text: "Now let me run the tests to verify." },
        { type: "tool_use", name: "run_command", input: { command: "npm test" } },
      ],
      usage: { input_tokens: 1200, output_tokens: 80 },
    }),
    result,
    counter,
    meta,
  );

  // Tool result for test
  processCodexJsonLine(
    JSON.stringify({
      type: "function_call_output",
      output: "All tests passed.",
    }),
    result,
    counter,
  );

  // Completion
  processCodexJsonLine(
    JSON.stringify({
      type: "summary",
      result: "Fixed JWT validation bug. All tests pass.",
      num_turns: 3,
      cost_usd: 0.08,
    }),
    result,
    counter,
  );

  return result;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("E2E cross-vendor run record smoke", () => {
  let henchDir: string;

  beforeEach(async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "ndx-run-record-smoke-"));
    henchDir = join(tmpDir, ".hench");
    await mkdir(join(henchDir, "runs"), { recursive: true });
  });

  afterEach(async () => {
    // Clean up the parent of .hench (the temp project dir)
    const projectDir = join(henchDir, "..");
    await rm(projectDir, { recursive: true, force: true });
  });

  // ── 1. Claude CLI run record shape ──────────────────────────────────

  describe("Claude CLI run record shape", () => {
    it("processes a complete Claude event stream into a valid CliRunResult", () => {
      const result = processClaudeSequence();

      expect(result.turns).toBe(3);
      expect(result.toolCalls).toHaveLength(3);
      expect(result.tokenUsage.input).toBe(2500);
      expect(result.tokenUsage.output).toBe(400);
      expect(result.turnTokenUsage).toHaveLength(3);
      expect(result.summary).toBe("Fixed JWT validation bug. All tests pass.");
      expect(result.costUsd).toBe(0.08);
      expect(result.error).toBeUndefined();
    });

    it("builds a valid RunRecord from Claude CliRunResult", () => {
      const cliResult = processClaudeSequence();
      const run = buildRunRecord(cliResult, {
        id: randomUUID(),
        model: "sonnet",
        taskId: "task-smoke-1",
        taskTitle: "Fix JWT validation",
      });

      const validation = validateRunRecord(run);
      expect(validation.ok).toBe(true);
    });

    it("round-trips a Claude run record through save → load", async () => {
      const cliResult = processClaudeSequence();
      const runId = randomUUID();
      const run = buildRunRecord(cliResult, {
        id: runId,
        model: "sonnet",
        taskId: "task-smoke-1",
        taskTitle: "Fix JWT validation",
      });

      await saveRun(henchDir, run);
      const loaded = await loadRun(henchDir, runId);

      // Core identity preserved
      expect(loaded.id).toBe(runId);
      expect(loaded.taskId).toBe("task-smoke-1");
      expect(loaded.taskTitle).toBe("Fix JWT validation");
      expect(loaded.model).toBe("sonnet");
      expect(loaded.status).toBe("completed");

      // Execution data preserved
      expect(loaded.turns).toBe(3);
      expect(loaded.toolCalls).toHaveLength(3);
      expect(loaded.tokenUsage.input).toBe(2500);
      expect(loaded.tokenUsage.output).toBe(400);
      expect(loaded.summary).toBe("Fixed JWT validation bug. All tests pass.");

      // Per-turn token usage preserved with vendor attribution
      expect(loaded.turnTokenUsage).toHaveLength(3);
      for (const ttu of loaded.turnTokenUsage!) {
        expect(ttu.vendor).toBe("claude");
        expect(ttu.model).toBe("sonnet");
      }

      // Structured summary preserved
      expect(loaded.structuredSummary).toBeDefined();
      expect(loaded.structuredSummary!.filesChanged).toContain("src/auth.ts");
      expect(loaded.structuredSummary!.filesRead).toContain("src/auth.ts");
      expect(loaded.structuredSummary!.counts.toolCallsTotal).toBe(3);

      // Memory stats preserved
      expect(loaded.memoryStats).toBeDefined();
      expect(loaded.memoryStats!.peakRssBytes).toBe(100_000_000);
    });
  });

  // ── 2. Codex CLI run record shape ───────────────────────────────────

  describe("Codex CLI run record shape", () => {
    it("processes a complete Codex event stream into a valid CliRunResult", () => {
      const result = processCodexSequence();

      expect(result.turns).toBe(3);
      expect(result.toolCalls).toHaveLength(3);
      expect(result.tokenUsage.input).toBe(2500);
      expect(result.tokenUsage.output).toBe(400);
      expect(result.turnTokenUsage).toHaveLength(3);
      expect(result.summary).toBe("Fixed JWT validation bug. All tests pass.");
      expect(result.costUsd).toBe(0.08);
      expect(result.error).toBeUndefined();
    });

    it("builds a valid RunRecord from Codex CliRunResult", () => {
      const cliResult = processCodexSequence();
      const run = buildRunRecord(cliResult, {
        id: randomUUID(),
        model: "gpt-5-codex",
        taskId: "task-smoke-2",
        taskTitle: "Fix JWT validation",
      });

      const validation = validateRunRecord(run);
      expect(validation.ok).toBe(true);
    });

    it("round-trips a Codex run record through save → load", async () => {
      const cliResult = processCodexSequence();
      const runId = randomUUID();
      const run = buildRunRecord(cliResult, {
        id: runId,
        model: "gpt-5-codex",
        taskId: "task-smoke-2",
        taskTitle: "Fix JWT validation",
      });

      await saveRun(henchDir, run);
      const loaded = await loadRun(henchDir, runId);

      // Core identity preserved
      expect(loaded.id).toBe(runId);
      expect(loaded.taskId).toBe("task-smoke-2");
      expect(loaded.taskTitle).toBe("Fix JWT validation");
      expect(loaded.model).toBe("gpt-5-codex");
      expect(loaded.status).toBe("completed");

      // Execution data preserved
      expect(loaded.turns).toBe(3);
      expect(loaded.toolCalls).toHaveLength(3);
      expect(loaded.tokenUsage.input).toBe(2500);
      expect(loaded.tokenUsage.output).toBe(400);
      expect(loaded.summary).toBe("Fixed JWT validation bug. All tests pass.");

      // Per-turn token usage preserved with vendor attribution
      expect(loaded.turnTokenUsage).toHaveLength(3);
      for (const ttu of loaded.turnTokenUsage!) {
        expect(ttu.vendor).toBe("codex");
        expect(ttu.model).toBe("gpt-5-codex");
      }

      // Structured summary preserved
      expect(loaded.structuredSummary).toBeDefined();
      expect(loaded.structuredSummary!.filesChanged).toContain("src/auth.ts");
      expect(loaded.structuredSummary!.filesRead).toContain("src/auth.ts");
      expect(loaded.structuredSummary!.counts.toolCallsTotal).toBe(3);

      // Memory stats preserved
      expect(loaded.memoryStats).toBeDefined();
      expect(loaded.memoryStats!.peakRssBytes).toBe(100_000_000);
    });
  });

  // ── 3. Structural identity assertion ────────────────────────────────

  describe("cross-vendor structural identity", () => {
    /**
     * The vendor-allowed-to-differ fields. Every other field in the
     * RunRecord must be byte-identical between Claude and Codex runs.
     */
    const VENDOR_SPECIFIC_TOP_LEVEL_KEYS = new Set(["id", "model", "taskId", "startedAt", "finishedAt", "lastActivityAt"]);
    const VENDOR_SPECIFIC_TTU_KEYS = new Set(["vendor", "model"]);

    it("both vendors produce structurally identical CliRunResult (modulo vendor/model)", () => {
      const claudeResult = processClaudeSequence();
      const codexResult = processCodexSequence();

      // Turns, token totals, summaries must match exactly
      expect(claudeResult.turns).toBe(codexResult.turns);
      expect(claudeResult.tokenUsage.input).toBe(codexResult.tokenUsage.input);
      expect(claudeResult.tokenUsage.output).toBe(codexResult.tokenUsage.output);
      expect(claudeResult.summary).toBe(codexResult.summary);
      expect(claudeResult.error).toBe(codexResult.error);
      expect(claudeResult.costUsd).toBe(codexResult.costUsd);

      // Tool call count and structure must match
      expect(claudeResult.toolCalls).toHaveLength(codexResult.toolCalls.length);
      for (let i = 0; i < claudeResult.toolCalls.length; i++) {
        expect(claudeResult.toolCalls[i].tool).toBe(codexResult.toolCalls[i].tool);
        expect(claudeResult.toolCalls[i].input).toEqual(codexResult.toolCalls[i].input);
        expect(claudeResult.toolCalls[i].output).toBe(codexResult.toolCalls[i].output);
        expect(claudeResult.toolCalls[i].durationMs).toBe(codexResult.toolCalls[i].durationMs);
      }

      // Per-turn token usage count must match
      expect(claudeResult.turnTokenUsage).toHaveLength(codexResult.turnTokenUsage.length);

      // Per-turn token values must match (vendor/model allowed to differ)
      for (let i = 0; i < claudeResult.turnTokenUsage.length; i++) {
        expect(claudeResult.turnTokenUsage[i].turn).toBe(codexResult.turnTokenUsage[i].turn);
        expect(claudeResult.turnTokenUsage[i].input).toBe(codexResult.turnTokenUsage[i].input);
        expect(claudeResult.turnTokenUsage[i].output).toBe(codexResult.turnTokenUsage[i].output);
      }
    });

    it("both vendors produce structurally identical saved run records", async () => {
      const claudeResult = processClaudeSequence();
      const codexResult = processCodexSequence();

      const claudeRunId = randomUUID();
      const codexRunId = randomUUID();
      const sharedTaskId = "task-parity-check";
      const sharedTaskTitle = "Fix JWT validation";

      // Use same timestamps for deterministic comparison
      const claudeRun = buildRunRecord(claudeResult, {
        id: claudeRunId,
        model: "sonnet",
        taskId: sharedTaskId,
        taskTitle: sharedTaskTitle,
      });

      const codexRun = buildRunRecord(codexResult, {
        id: codexRunId,
        model: "gpt-5-codex",
        taskId: sharedTaskId,
        taskTitle: sharedTaskTitle,
      });

      // Save and load both
      await saveRun(henchDir, claudeRun);
      await saveRun(henchDir, codexRun);
      const loadedClaude = await loadRun(henchDir, claudeRunId);
      const loadedCodex = await loadRun(henchDir, codexRunId);

      // Both must validate against the same schema
      expect(validateRunRecord(loadedClaude).ok).toBe(true);
      expect(validateRunRecord(loadedCodex).ok).toBe(true);

      // Status must match
      expect(loadedClaude.status).toBe(loadedCodex.status);

      // Turns must match
      expect(loadedClaude.turns).toBe(loadedCodex.turns);

      // Token totals must match
      expect(loadedClaude.tokenUsage).toEqual(loadedCodex.tokenUsage);

      // Summary must match
      expect(loadedClaude.summary).toBe(loadedCodex.summary);

      // Error must match (both undefined in success case)
      expect(loadedClaude.error).toBe(loadedCodex.error);

      // Tool calls must be identical
      expect(loadedClaude.toolCalls).toEqual(loadedCodex.toolCalls);

      // Structured summary must be identical
      expect(loadedClaude.structuredSummary).toEqual(loadedCodex.structuredSummary);

      // Memory stats must be identical (both use the same synthetic stats)
      expect(loadedClaude.memoryStats).toEqual(loadedCodex.memoryStats);

      // Model fields must differ (vendor-specific)
      expect(loadedClaude.model).toBe("sonnet");
      expect(loadedCodex.model).toBe("gpt-5-codex");
      expect(loadedClaude.model).not.toBe(loadedCodex.model);

      // Per-turn token usage: values must match, vendor/model must differ
      expect(loadedClaude.turnTokenUsage).toHaveLength(loadedCodex.turnTokenUsage!.length);
      for (let i = 0; i < loadedClaude.turnTokenUsage!.length; i++) {
        const cTtu = loadedClaude.turnTokenUsage![i];
        const xTtu = loadedCodex.turnTokenUsage![i];

        // Token values must match
        expect(cTtu.turn).toBe(xTtu.turn);
        expect(cTtu.input).toBe(xTtu.input);
        expect(cTtu.output).toBe(xTtu.output);
        expect(cTtu.cacheCreationInput).toBe(xTtu.cacheCreationInput);
        expect(cTtu.cacheReadInput).toBe(xTtu.cacheReadInput);

        // Vendor/model must differ
        expect(cTtu.vendor).toBe("claude");
        expect(xTtu.vendor).toBe("codex");
        expect(cTtu.model).toBe("sonnet");
        expect(xTtu.model).toBe("gpt-5-codex");
      }
    });

    it("only vendor/model fields are allowed to differ between run records", async () => {
      const claudeResult = processClaudeSequence();
      const codexResult = processCodexSequence();

      const claudeRun = buildRunRecord(claudeResult, {
        id: "deterministic-claude-id",
        model: "sonnet",
        taskId: "task-same",
        taskTitle: "Same task",
      });

      const codexRun = buildRunRecord(codexResult, {
        id: "deterministic-codex-id",
        model: "gpt-5-codex",
        taskId: "task-same",
        taskTitle: "Same task",
      });

      // Normalize vendor-specific fields to prove all other fields are identical
      const normalizedClaude = normalizeForParity(claudeRun);
      const normalizedCodex = normalizeForParity(codexRun);

      expect(normalizedClaude).toEqual(normalizedCodex);
    });

    it("error run records are also structurally identical across vendors", () => {
      // Claude error sequence
      const claudeResult = createCliResult();
      const claudeCounter = { value: 0 };
      processStreamLine(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Starting work..." }],
            usage: { input_tokens: 100, output_tokens: 20 },
          },
        }),
        claudeResult,
        claudeCounter,
        { vendor: "claude" as const, model: "sonnet" },
      );
      processStreamLine(
        JSON.stringify({
          type: "result",
          is_error: true,
          result: "Compilation failed: syntax error in auth.ts",
        }),
        claudeResult,
        claudeCounter,
      );

      // Codex error sequence
      const codexResult = createCliResult();
      const codexCounter = { value: 0 };
      processCodexJsonLine(
        JSON.stringify({
          type: "message",
          content: [{ type: "text", text: "Starting work..." }],
          usage: { input_tokens: 100, output_tokens: 20 },
        }),
        codexResult,
        codexCounter,
        { vendor: "codex" as const, model: "gpt-5-codex" },
      );
      processCodexJsonLine(
        JSON.stringify({
          type: "summary",
          is_error: true,
          result: "Compilation failed: syntax error in auth.ts",
        }),
        codexResult,
        codexCounter,
      );

      // Both produce identical error state
      expect(claudeResult.error).toBe(codexResult.error);
      expect(claudeResult.error).toBe("Compilation failed: syntax error in auth.ts");
      expect(claudeResult.turns).toBe(codexResult.turns);
      expect(claudeResult.tokenUsage.input).toBe(codexResult.tokenUsage.input);
      expect(claudeResult.tokenUsage.output).toBe(codexResult.tokenUsage.output);
    });

    it("RunRecordSchema accepts both vendor records with identical shape", () => {
      const claudeResult = processClaudeSequence();
      const codexResult = processCodexSequence();

      const claudeRun = buildRunRecord(claudeResult, {
        id: randomUUID(),
        model: "sonnet",
        taskId: "task-schema",
        taskTitle: "Schema test",
      });
      const codexRun = buildRunRecord(codexResult, {
        id: randomUUID(),
        model: "gpt-5-codex",
        taskId: "task-schema",
        taskTitle: "Schema test",
      });

      // Both must parse against the same Zod schema
      const claudeParsed = RunRecordSchema.safeParse(claudeRun);
      const codexParsed = RunRecordSchema.safeParse(codexRun);

      expect(claudeParsed.success).toBe(true);
      expect(codexParsed.success).toBe(true);

      // Schema produces identical shapes (modulo vendor fields)
      if (claudeParsed.success && codexParsed.success) {
        const claudeKeys = Object.keys(claudeParsed.data).sort();
        const codexKeys = Object.keys(codexParsed.data).sort();
        expect(claudeKeys).toEqual(codexKeys);
      }
    });
  });
});

// ── Parity normalization ─────────────────────────────────────────────────

/**
 * Strip all vendor-specific fields from a RunRecord so that two records
 * from different vendors can be compared with toEqual(). Fields removed:
 * - id (unique per run)
 * - model (vendor-specific)
 * - startedAt, finishedAt, lastActivityAt (timing-dependent)
 * - turnTokenUsage[].vendor, turnTokenUsage[].model
 */
function normalizeForParity(run: RunRecord): Record<string, unknown> {
  const { id, model, startedAt, finishedAt, lastActivityAt, turnTokenUsage, ...rest } = run;

  const normalizedTtu = (turnTokenUsage ?? []).map((ttu: TurnTokenUsage) => {
    const { vendor, model: ttuModel, ...ttuRest } = ttu;
    return ttuRest;
  });

  return {
    ...rest,
    turnTokenUsage: normalizedTtu,
  };
}
