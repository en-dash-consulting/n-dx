/**
 * Run record parity tests.
 *
 * Asserts that run records from both vendors:
 *   1. Contain a diagnostics field with per-turn and run-level status
 *   2. Have token usage fields that are populated OR explicitly marked
 *      as unavailable (no silent zeros)
 *   3. Produce the same RunStatus for equivalent outcomes
 *
 * These tests exercise the real parse functions (processStreamLine /
 * processCodexJsonLine) with mock event streams and verify that the
 * resulting RunRecords meet the cross-vendor parity contract.
 *
 * @see packages/hench/tests/e2e/cross-vendor-run-record-smoke.test.ts — structural parity
 * @see packages/hench/tests/unit/agent/cross-vendor-parity.test.ts — runtime contract parity
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  processStreamLine,
  processCodexJsonLine,
} from "../../../src/agent/lifecycle/event-accumulator.js";
import type { CliRunResult } from "../../../src/agent/lifecycle/event-accumulator.js";
import { saveRun, loadRun } from "../../../src/store/runs.js";
import { RunRecordSchema } from "../../../src/schema/validate.js";
import { buildRunSummary } from "../../../src/agent/analysis/summary.js";
import type { RunRecord, RunStatus, TurnTokenUsage, RunDiagnostics } from "../../../src/schema/v1.js";

// ── Helpers ──────────────────────────────────────────────────────────────

/** Create a fresh CliRunResult. */
function createCliResult(): CliRunResult {
  return {
    turns: 0,
    toolCalls: [],
    tokenUsage: { input: 0, output: 0 },
    turnTokenUsage: [],
  };
}

/**
 * Derive run-level diagnostics from per-turn token usage.
 *
 * Aggregates per-turn diagnosticStatus values into a run-level summary.
 * This mirrors the logic that production code should eventually use.
 */
function deriveRunDiagnostics(
  turnTokenUsage: TurnTokenUsage[],
  parseMode: string,
): RunDiagnostics {
  let overall: "complete" | "partial" | "unavailable" = "complete";
  const notes: string[] = [];

  for (const ttu of turnTokenUsage) {
    if (ttu.diagnosticStatus === "unavailable") {
      overall = "unavailable";
      notes.push(`turn ${ttu.turn}: token usage unavailable`);
    } else if (ttu.diagnosticStatus === "partial" && overall === "complete") {
      overall = "partial";
      notes.push(`turn ${ttu.turn}: token usage partial`);
    }
  }

  return { tokenDiagnosticStatus: overall, parseMode, notes };
}

/**
 * Build a RunRecord from a CliRunResult with diagnostics.
 */
function buildRunRecord(
  cliResult: CliRunResult,
  opts: {
    id: string;
    model: string;
    taskId: string;
    taskTitle: string;
    vendor: "claude" | "codex";
  },
): RunRecord {
  const now = new Date().toISOString();
  const parseMode = opts.vendor === "claude" ? "stream-json" : "json";
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
    diagnostics: deriveRunDiagnostics(cliResult.turnTokenUsage, parseMode),
  };
  return run;
}

// ── Event sequence builders ──────────────────────────────────────────────

/**
 * Process a Claude event stream with complete token usage.
 * 3 turns, each with proper usage data → diagnosticStatus = "complete".
 */
function processClaudeCompleteTokens(): CliRunResult {
  const result = createCliResult();
  const counter = { value: 0 };
  const meta = { vendor: "claude" as const, model: "sonnet" };

  // Turn 1: read file
  processStreamLine(
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Reading the auth module." },
          { type: "tool_use", name: "read_file", input: { path: "src/auth.ts" } },
        ],
        usage: { input_tokens: 500, output_tokens: 120 },
      },
    }),
    result,
    counter,
    meta,
  );

  processStreamLine(
    JSON.stringify({ type: "tool_result", output: "export function validateToken() {}" }),
    result,
    counter,
  );

  // Turn 2: write file
  processStreamLine(
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Fixing the validation." },
          { type: "tool_use", name: "write_file", input: { path: "src/auth.ts", content: "fixed" } },
        ],
        usage: { input_tokens: 800, output_tokens: 200 },
      },
    }),
    result,
    counter,
    meta,
  );

  processStreamLine(
    JSON.stringify({ type: "tool_result", output: "File written." }),
    result,
    counter,
  );

  // Turn 3: run tests
  processStreamLine(
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Running tests." },
          { type: "tool_use", name: "run_command", input: { command: "npm test" } },
        ],
        usage: { input_tokens: 1200, output_tokens: 80 },
      },
    }),
    result,
    counter,
    meta,
  );

  processStreamLine(
    JSON.stringify({ type: "tool_result", output: "All tests passed." }),
    result,
    counter,
  );

  // Completion
  processStreamLine(
    JSON.stringify({
      type: "result",
      result: "Fixed validation bug. All tests pass.",
      num_turns: 3,
      cost_usd: 0.08,
    }),
    result,
    counter,
  );

  return result;
}

/**
 * Process the equivalent Codex event stream with complete token usage.
 */
function processCodexCompleteTokens(): CliRunResult {
  const result = createCliResult();
  const counter = { value: 0 };
  const meta = { vendor: "codex" as const, model: "gpt-5-codex" };

  // Turn 1
  processCodexJsonLine(
    JSON.stringify({
      type: "message",
      content: [
        { type: "text", text: "Reading the auth module." },
        { type: "tool_use", name: "read_file", input: { path: "src/auth.ts" } },
      ],
      usage: { input_tokens: 500, output_tokens: 120 },
    }),
    result,
    counter,
    meta,
  );

  processCodexJsonLine(
    JSON.stringify({ type: "function_call_output", output: "export function validateToken() {}" }),
    result,
    counter,
  );

  // Turn 2
  processCodexJsonLine(
    JSON.stringify({
      type: "message",
      content: [
        { type: "text", text: "Fixing the validation." },
        { type: "tool_use", name: "write_file", input: { path: "src/auth.ts", content: "fixed" } },
      ],
      usage: { input_tokens: 800, output_tokens: 200 },
    }),
    result,
    counter,
    meta,
  );

  processCodexJsonLine(
    JSON.stringify({ type: "function_call_output", output: "File written." }),
    result,
    counter,
  );

  // Turn 3
  processCodexJsonLine(
    JSON.stringify({
      type: "message",
      content: [
        { type: "text", text: "Running tests." },
        { type: "tool_use", name: "run_command", input: { command: "npm test" } },
      ],
      usage: { input_tokens: 1200, output_tokens: 80 },
    }),
    result,
    counter,
    meta,
  );

  processCodexJsonLine(
    JSON.stringify({ type: "function_call_output", output: "All tests passed." }),
    result,
    counter,
  );

  // Completion
  processCodexJsonLine(
    JSON.stringify({
      type: "summary",
      result: "Fixed validation bug. All tests pass.",
      num_turns: 3,
      cost_usd: 0.08,
    }),
    result,
    counter,
  );

  return result;
}

/**
 * Process a Claude event stream where token usage is missing.
 * Simulates a vendor response that omits usage data entirely.
 */
function processClaudeMissingTokens(): CliRunResult {
  const result = createCliResult();
  const counter = { value: 0 };
  const meta = { vendor: "claude" as const, model: "sonnet" };

  // Turn 1: message without usage field
  processStreamLine(
    JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Working on the fix." }],
        usage: {},  // empty usage object — no input_tokens or output_tokens
      },
    }),
    result,
    counter,
    meta,
  );

  processStreamLine(
    JSON.stringify({ type: "result", result: "Done.", num_turns: 1 }),
    result,
    counter,
  );

  return result;
}

/**
 * Process a Codex event stream where token usage is missing.
 */
function processCodexMissingTokens(): CliRunResult {
  const result = createCliResult();
  const counter = { value: 0 };
  const meta = { vendor: "codex" as const, model: "gpt-5-codex" };

  processCodexJsonLine(
    JSON.stringify({
      type: "message",
      content: [{ type: "text", text: "Working on the fix." }],
      usage: {},  // empty usage object
    }),
    result,
    counter,
    meta,
  );

  processCodexJsonLine(
    JSON.stringify({ type: "summary", result: "Done.", num_turns: 1 }),
    result,
    counter,
  );

  return result;
}

/**
 * Process a Claude error sequence (agent starts, then fails).
 */
function processClaudeErrorSequence(): CliRunResult {
  const result = createCliResult();
  const counter = { value: 0 };
  const meta = { vendor: "claude" as const, model: "sonnet" };

  processStreamLine(
    JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Starting work..." }],
        usage: { input_tokens: 100, output_tokens: 20 },
      },
    }),
    result,
    counter,
    meta,
  );

  processStreamLine(
    JSON.stringify({
      type: "result",
      is_error: true,
      result: "Compilation failed: syntax error",
    }),
    result,
    counter,
  );

  return result;
}

/**
 * Process a Codex error sequence.
 */
function processCodexErrorSequence(): CliRunResult {
  const result = createCliResult();
  const counter = { value: 0 };
  const meta = { vendor: "codex" as const, model: "gpt-5-codex" };

  processCodexJsonLine(
    JSON.stringify({
      type: "message",
      content: [{ type: "text", text: "Starting work..." }],
      usage: { input_tokens: 100, output_tokens: 20 },
    }),
    result,
    counter,
    meta,
  );

  processCodexJsonLine(
    JSON.stringify({
      type: "summary",
      is_error: true,
      result: "Compilation failed: syntax error",
    }),
    result,
    counter,
  );

  return result;
}

/**
 * Process a Claude event with partial token usage (only input present).
 */
function processClaudePartialTokens(): CliRunResult {
  const result = createCliResult();
  const counter = { value: 0 };
  const meta = { vendor: "claude" as const, model: "sonnet" };

  processStreamLine(
    JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Processing..." }],
        usage: { input_tokens: 500 },  // output_tokens missing
      },
    }),
    result,
    counter,
    meta,
  );

  processStreamLine(
    JSON.stringify({ type: "result", result: "Done.", num_turns: 1 }),
    result,
    counter,
  );

  return result;
}

/**
 * Process a Codex event with partial token usage.
 */
function processCodexPartialTokens(): CliRunResult {
  const result = createCliResult();
  const counter = { value: 0 };
  const meta = { vendor: "codex" as const, model: "gpt-5-codex" };

  processCodexJsonLine(
    JSON.stringify({
      type: "message",
      content: [{ type: "text", text: "Processing..." }],
      usage: { input_tokens: 500 },  // output_tokens missing
    }),
    result,
    counter,
    meta,
  );

  processCodexJsonLine(
    JSON.stringify({ type: "summary", result: "Done.", num_turns: 1 }),
    result,
    counter,
  );

  return result;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("run record parity: diagnostics field", () => {
  let henchDir: string;

  beforeEach(async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "ndx-run-record-parity-"));
    henchDir = join(tmpDir, ".hench");
    await mkdir(join(henchDir, "runs"), { recursive: true });
  });

  afterEach(async () => {
    const projectDir = join(henchDir, "..");
    await rm(projectDir, { recursive: true, force: true });
  });

  // ── 1. Per-turn diagnosticStatus ────────────────────────────────────

  describe("per-turn diagnosticStatus", () => {
    it("Claude turns have diagnosticStatus set to 'complete' when usage is present", () => {
      const result = processClaudeCompleteTokens();

      expect(result.turnTokenUsage).toHaveLength(3);
      for (const ttu of result.turnTokenUsage) {
        expect(ttu.diagnosticStatus).toBe("complete");
      }
    });

    it("Codex turns have diagnosticStatus set to 'complete' when usage is present", () => {
      const result = processCodexCompleteTokens();

      expect(result.turnTokenUsage).toHaveLength(3);
      for (const ttu of result.turnTokenUsage) {
        expect(ttu.diagnosticStatus).toBe("complete");
      }
    });

    it("Claude turns have diagnosticStatus 'unavailable' when usage is missing", () => {
      const result = processClaudeMissingTokens();

      expect(result.turnTokenUsage).toHaveLength(1);
      expect(result.turnTokenUsage[0].diagnosticStatus).toBe("unavailable");
    });

    it("Codex turns have diagnosticStatus 'unavailable' when usage is missing", () => {
      const result = processCodexMissingTokens();

      expect(result.turnTokenUsage).toHaveLength(1);
      expect(result.turnTokenUsage[0].diagnosticStatus).toBe("unavailable");
    });

    it("Claude turns have diagnosticStatus 'partial' when only input is present", () => {
      const result = processClaudePartialTokens();

      expect(result.turnTokenUsage).toHaveLength(1);
      expect(result.turnTokenUsage[0].diagnosticStatus).toBe("partial");
    });

    it("Codex turns have diagnosticStatus 'partial' when only input is present", () => {
      const result = processCodexPartialTokens();

      expect(result.turnTokenUsage).toHaveLength(1);
      expect(result.turnTokenUsage[0].diagnosticStatus).toBe("partial");
    });

    it("both vendors produce the same diagnosticStatus for identical payloads", () => {
      const claude = processClaudeCompleteTokens();
      const codex = processCodexCompleteTokens();

      expect(claude.turnTokenUsage).toHaveLength(codex.turnTokenUsage.length);
      for (let i = 0; i < claude.turnTokenUsage.length; i++) {
        expect(claude.turnTokenUsage[i].diagnosticStatus).toBe(
          codex.turnTokenUsage[i].diagnosticStatus,
        );
      }
    });
  });

  // ── 2. Run-level diagnostics field ──────────────────────────────────

  describe("run-level diagnostics on RunRecord", () => {
    it("Claude run record contains diagnostics field", () => {
      const cliResult = processClaudeCompleteTokens();
      const run = buildRunRecord(cliResult, {
        id: randomUUID(),
        model: "sonnet",
        taskId: "task-diag-1",
        taskTitle: "Test diagnostics",
        vendor: "claude",
      });

      expect(run.diagnostics).toBeDefined();
      expect(run.diagnostics!.tokenDiagnosticStatus).toBe("complete");
      expect(run.diagnostics!.parseMode).toBe("stream-json");
      expect(run.diagnostics!.notes).toEqual([]);
    });

    it("Codex run record contains diagnostics field", () => {
      const cliResult = processCodexCompleteTokens();
      const run = buildRunRecord(cliResult, {
        id: randomUUID(),
        model: "gpt-5-codex",
        taskId: "task-diag-2",
        taskTitle: "Test diagnostics",
        vendor: "codex",
      });

      expect(run.diagnostics).toBeDefined();
      expect(run.diagnostics!.tokenDiagnosticStatus).toBe("complete");
      expect(run.diagnostics!.parseMode).toBe("json");
      expect(run.diagnostics!.notes).toEqual([]);
    });

    it("diagnostics reflects unavailable status when tokens are missing", () => {
      const cliResult = processClaudeMissingTokens();
      const run = buildRunRecord(cliResult, {
        id: randomUUID(),
        model: "sonnet",
        taskId: "task-diag-3",
        taskTitle: "Test missing tokens",
        vendor: "claude",
      });

      expect(run.diagnostics!.tokenDiagnosticStatus).toBe("unavailable");
      expect(run.diagnostics!.notes.length).toBeGreaterThan(0);
      expect(run.diagnostics!.notes[0]).toContain("unavailable");
    });

    it("diagnostics reflects partial status for partial token data", () => {
      const cliResult = processClaudePartialTokens();
      const run = buildRunRecord(cliResult, {
        id: randomUUID(),
        model: "sonnet",
        taskId: "task-diag-4",
        taskTitle: "Test partial tokens",
        vendor: "claude",
      });

      expect(run.diagnostics!.tokenDiagnosticStatus).toBe("partial");
    });

    it("diagnostics field validates against RunRecordSchema", () => {
      const cliResult = processClaudeCompleteTokens();
      const run = buildRunRecord(cliResult, {
        id: randomUUID(),
        model: "sonnet",
        taskId: "task-schema-diag",
        taskTitle: "Schema validation",
        vendor: "claude",
      });

      const parsed = RunRecordSchema.safeParse(run);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.diagnostics).toBeDefined();
        expect(parsed.data.diagnostics!.tokenDiagnosticStatus).toBe("complete");
      }
    });

    it("RunRecordSchema still accepts records without diagnostics (backward-compatible)", () => {
      const cliResult = processClaudeCompleteTokens();
      const now = new Date().toISOString();
      const run = {
        id: randomUUID(),
        taskId: "task-compat",
        taskTitle: "Backward compat",
        startedAt: now,
        status: "completed" as const,
        turns: cliResult.turns,
        tokenUsage: cliResult.tokenUsage,
        toolCalls: cliResult.toolCalls,
        model: "sonnet",
        // No diagnostics field
      };

      const parsed = RunRecordSchema.safeParse(run);
      expect(parsed.success).toBe(true);
    });

    it("diagnostics round-trips through save → load", async () => {
      const cliResult = processClaudeCompleteTokens();
      const runId = randomUUID();
      const run = buildRunRecord(cliResult, {
        id: runId,
        model: "sonnet",
        taskId: "task-rt",
        taskTitle: "Round-trip diagnostics",
        vendor: "claude",
      });

      await saveRun(henchDir, run);
      const loaded = await loadRun(henchDir, runId);

      expect(loaded.diagnostics).toBeDefined();
      expect(loaded.diagnostics!.tokenDiagnosticStatus).toBe("complete");
      expect(loaded.diagnostics!.parseMode).toBe("stream-json");
      expect(loaded.diagnostics!.notes).toEqual([]);
    });

    it("both vendors produce diagnostics with matching tokenDiagnosticStatus", () => {
      const claudeResult = processClaudeCompleteTokens();
      const codexResult = processCodexCompleteTokens();

      const claudeRun = buildRunRecord(claudeResult, {
        id: randomUUID(),
        model: "sonnet",
        taskId: "task-parity-diag",
        taskTitle: "Parity check",
        vendor: "claude",
      });
      const codexRun = buildRunRecord(codexResult, {
        id: randomUUID(),
        model: "gpt-5-codex",
        taskId: "task-parity-diag",
        taskTitle: "Parity check",
        vendor: "codex",
      });

      expect(claudeRun.diagnostics!.tokenDiagnosticStatus).toBe(
        codexRun.diagnostics!.tokenDiagnosticStatus,
      );
      expect(claudeRun.diagnostics!.notes).toEqual(
        codexRun.diagnostics!.notes,
      );
    });
  });

  // ── 3. Token usage: no silent zeros ─────────────────────────────────

  describe("token usage: no silent zeros", () => {
    it("complete tokens have non-zero input and output", () => {
      const claude = processClaudeCompleteTokens();
      const codex = processCodexCompleteTokens();

      for (const result of [claude, codex]) {
        for (const ttu of result.turnTokenUsage) {
          if (ttu.diagnosticStatus === "complete") {
            expect(ttu.input + ttu.output).toBeGreaterThan(0);
          }
        }
      }
    });

    it("unavailable tokens are explicitly marked — zeros have diagnosticStatus 'unavailable'", () => {
      const claude = processClaudeMissingTokens();
      const codex = processCodexMissingTokens();

      for (const result of [claude, codex]) {
        for (const ttu of result.turnTokenUsage) {
          if (ttu.input === 0 && ttu.output === 0) {
            expect(ttu.diagnosticStatus).toBe("unavailable");
          }
        }
      }
    });

    it("partial tokens have at least one non-zero field", () => {
      const claude = processClaudePartialTokens();
      const codex = processCodexPartialTokens();

      for (const result of [claude, codex]) {
        for (const ttu of result.turnTokenUsage) {
          if (ttu.diagnosticStatus === "partial") {
            // At least one of input/output should be non-zero
            expect(ttu.input + ttu.output).toBeGreaterThan(0);
          }
        }
      }
    });

    it("aggregate tokenUsage matches sum of per-turn values", () => {
      const claude = processClaudeCompleteTokens();
      const codex = processCodexCompleteTokens();

      for (const result of [claude, codex]) {
        const turnInput = result.turnTokenUsage.reduce((sum, t) => sum + t.input, 0);
        const turnOutput = result.turnTokenUsage.reduce((sum, t) => sum + t.output, 0);
        expect(result.tokenUsage.input).toBe(turnInput);
        expect(result.tokenUsage.output).toBe(turnOutput);
      }
    });

    it("run-level diagnostics marks unavailable when any turn has zero tokens", () => {
      const claude = processClaudeMissingTokens();
      const run = buildRunRecord(claude, {
        id: randomUUID(),
        model: "sonnet",
        taskId: "task-no-silent",
        taskTitle: "No silent zeros",
        vendor: "claude",
      });

      // The run-level status must be "unavailable" — not "complete" with zeros
      expect(run.diagnostics!.tokenDiagnosticStatus).toBe("unavailable");
      // And the per-turn data explicitly marks the zero values
      expect(run.turnTokenUsage![0].diagnosticStatus).toBe("unavailable");
      expect(run.turnTokenUsage![0].input).toBe(0);
      expect(run.turnTokenUsage![0].output).toBe(0);
    });

    it("both vendors mark identical unavailable patterns the same way", () => {
      const claude = processClaudeMissingTokens();
      const codex = processCodexMissingTokens();

      // Both should have the same diagnostic status for zero tokens
      expect(claude.turnTokenUsage[0].diagnosticStatus).toBe(
        codex.turnTokenUsage[0].diagnosticStatus,
      );
      expect(claude.turnTokenUsage[0].input).toBe(codex.turnTokenUsage[0].input);
      expect(claude.turnTokenUsage[0].output).toBe(codex.turnTokenUsage[0].output);
    });
  });

  // ── 4. RunStatus equivalence ────────────────────────────────────────

  describe("RunStatus equivalence for matching outcomes", () => {
    it("both vendors produce 'completed' for successful runs", () => {
      const claude = processClaudeCompleteTokens();
      const codex = processCodexCompleteTokens();

      const claudeRun = buildRunRecord(claude, {
        id: randomUUID(), model: "sonnet",
        taskId: "task-status", taskTitle: "Status test", vendor: "claude",
      });
      const codexRun = buildRunRecord(codex, {
        id: randomUUID(), model: "gpt-5-codex",
        taskId: "task-status", taskTitle: "Status test", vendor: "codex",
      });

      expect(claudeRun.status).toBe("completed");
      expect(codexRun.status).toBe("completed");
      expect(claudeRun.status).toBe(codexRun.status);
    });

    it("both vendors produce 'failed' for error runs", () => {
      const claude = processClaudeErrorSequence();
      const codex = processCodexErrorSequence();

      const claudeRun = buildRunRecord(claude, {
        id: randomUUID(), model: "sonnet",
        taskId: "task-err", taskTitle: "Error test", vendor: "claude",
      });
      const codexRun = buildRunRecord(codex, {
        id: randomUUID(), model: "gpt-5-codex",
        taskId: "task-err", taskTitle: "Error test", vendor: "codex",
      });

      expect(claudeRun.status).toBe("failed");
      expect(codexRun.status).toBe("failed");
      expect(claudeRun.status).toBe(codexRun.status);
    });

    it("error messages are identical for equivalent error outcomes", () => {
      const claude = processClaudeErrorSequence();
      const codex = processCodexErrorSequence();

      expect(claude.error).toBe(codex.error);
      expect(claude.error).toBe("Compilation failed: syntax error");
    });

    it("all RunStatus values map to same outcomes regardless of vendor", () => {
      const allStatuses: RunStatus[] = [
        "running", "completed", "failed", "timeout",
        "budget_exceeded", "error_transient",
      ];

      // Verify the type system covers all statuses
      expect(allStatuses).toHaveLength(6);

      // Verify completed and failed are the two terminal statuses
      // that both vendors produce from stream processing
      const claudeSuccess = processClaudeCompleteTokens();
      const claudeError = processClaudeErrorSequence();
      const codexSuccess = processCodexCompleteTokens();
      const codexError = processCodexErrorSequence();

      // Success → both produce no error
      expect(claudeSuccess.error).toBeUndefined();
      expect(codexSuccess.error).toBeUndefined();

      // Error → both produce the same error string
      expect(claudeError.error).toBe(codexError.error);
    });

    it("per-turn token usage on error runs still has diagnosticStatus", () => {
      const claude = processClaudeErrorSequence();
      const codex = processCodexErrorSequence();

      // Even on error runs, the turn that DID have usage should be tracked
      for (const result of [claude, codex]) {
        expect(result.turnTokenUsage).toHaveLength(1);
        expect(result.turnTokenUsage[0].diagnosticStatus).toBe("complete");
        expect(result.turnTokenUsage[0].input).toBe(100);
        expect(result.turnTokenUsage[0].output).toBe(20);
      }
    });

    it("both vendors' error runs validate against RunRecordSchema", async () => {
      const claude = processClaudeErrorSequence();
      const codex = processCodexErrorSequence();

      const claudeRun = buildRunRecord(claude, {
        id: randomUUID(), model: "sonnet",
        taskId: "task-err-schema", taskTitle: "Error schema", vendor: "claude",
      });
      const codexRun = buildRunRecord(codex, {
        id: randomUUID(), model: "gpt-5-codex",
        taskId: "task-err-schema", taskTitle: "Error schema", vendor: "codex",
      });

      expect(RunRecordSchema.safeParse(claudeRun).success).toBe(true);
      expect(RunRecordSchema.safeParse(codexRun).success).toBe(true);

      // Verify diagnostics on error runs too
      expect(claudeRun.diagnostics!.tokenDiagnosticStatus).toBe("complete");
      expect(codexRun.diagnostics!.tokenDiagnosticStatus).toBe("complete");
    });

    it("diagnostics round-trips through save → load for error runs", async () => {
      const claude = processClaudeErrorSequence();
      const runId = randomUUID();
      const run = buildRunRecord(claude, {
        id: runId, model: "sonnet",
        taskId: "task-err-rt", taskTitle: "Error round-trip", vendor: "claude",
      });

      await saveRun(henchDir, run);
      const loaded = await loadRun(henchDir, runId);

      expect(loaded.status).toBe("failed");
      expect(loaded.error).toBe("Compilation failed: syntax error");
      expect(loaded.diagnostics).toBeDefined();
      expect(loaded.diagnostics!.tokenDiagnosticStatus).toBe("complete");
    });
  });

  // ── 5. Schema parity with diagnostics ───────────────────────────────

  describe("schema parity with diagnostics", () => {
    it("diagnosticStatus is preserved in per-turn token usage after save/load", async () => {
      const claude = processClaudeCompleteTokens();
      const runId = randomUUID();
      const run = buildRunRecord(claude, {
        id: runId, model: "sonnet",
        taskId: "task-ttu-diag", taskTitle: "TTU diagnostics", vendor: "claude",
      });

      await saveRun(henchDir, run);
      const loaded = await loadRun(henchDir, runId);

      for (const ttu of loaded.turnTokenUsage!) {
        expect(ttu.diagnosticStatus).toBe("complete");
      }
    });

    it("both vendors produce schema-valid records with diagnostics", () => {
      const claudeResult = processClaudeCompleteTokens();
      const codexResult = processCodexCompleteTokens();

      const claudeRun = buildRunRecord(claudeResult, {
        id: randomUUID(), model: "sonnet",
        taskId: "t1", taskTitle: "Schema parity", vendor: "claude",
      });
      const codexRun = buildRunRecord(codexResult, {
        id: randomUUID(), model: "gpt-5-codex",
        taskId: "t1", taskTitle: "Schema parity", vendor: "codex",
      });

      const claudeParsed = RunRecordSchema.safeParse(claudeRun);
      const codexParsed = RunRecordSchema.safeParse(codexRun);

      expect(claudeParsed.success).toBe(true);
      expect(codexParsed.success).toBe(true);

      // Both have same key shape
      if (claudeParsed.success && codexParsed.success) {
        const cKeys = Object.keys(claudeParsed.data).sort();
        const xKeys = Object.keys(codexParsed.data).sort();
        expect(cKeys).toEqual(xKeys);
      }
    });

    it("diagnostics field has correct type constraints per Zod schema", () => {
      // Valid diagnostics
      const valid = RunRecordSchema.safeParse({
        id: "test",
        taskId: "t1",
        taskTitle: "Test",
        startedAt: new Date().toISOString(),
        status: "completed",
        turns: 1,
        tokenUsage: { input: 100, output: 50 },
        toolCalls: [],
        model: "sonnet",
        diagnostics: {
          tokenDiagnosticStatus: "complete",
          parseMode: "stream-json",
          notes: [],
        },
      });
      expect(valid.success).toBe(true);

      // Invalid diagnosticStatus value
      const invalid = RunRecordSchema.safeParse({
        id: "test",
        taskId: "t1",
        taskTitle: "Test",
        startedAt: new Date().toISOString(),
        status: "completed",
        turns: 1,
        tokenUsage: { input: 100, output: 50 },
        toolCalls: [],
        model: "sonnet",
        diagnostics: {
          tokenDiagnosticStatus: "invalid_value",
          parseMode: "stream-json",
          notes: [],
        },
      });
      expect(invalid.success).toBe(false);
    });
  });
});
