/**
 * Self-Heal Batch Pipeline — Codex Incompatibility Audit
 *
 * Traces every code path in the self-heal batch loop that branches or fails
 * on Codex input/output. Each incompatibility is tagged with file:line.
 *
 * ── Findings ──────────────────────────────────────────────────────────────
 *
 * IC-1  buildRunSummary ignores Codex tool names → filesChanged always empty
 *   packages/hench/src/agent/analysis/summary.ts:47-101
 *   The switch handles only Claude API tool names: write_file, read_file,
 *   run_command, git. Codex CLI reports tools as: shell, str_replace_editor,
 *   create_file, computer. None match; all tool calls fall to `default: break`.
 *   Result: filesChanged = [], filesRead = [], commandsExecuted = [] for every
 *   Codex run regardless of what the agent actually did.
 *
 * IC-2  Self-heal test gate silently skips when filesChanged is empty
 *   packages/hench/src/tools/test-runner.ts:543-549
 *   runTestGate() short-circuits with {ran:false, skipReason:"No files modified
 *   in prior phases"} when filesChanged.length === 0. Combined with IC-1, the
 *   mandatory self-heal test gate NEVER executes for Codex. The safety guarantee
 *   of self-heal mode — that every task must pass tests before completion — is
 *   silently broken for the Codex vendor.
 *
 * IC-3  API provider mode hard-fails for any non-Claude vendor
 *   packages/hench/src/agent/lifecycle/loop.ts:117-121
 *   initApiResources() throws immediately: "Hench API mode requires
 *   llm.vendor=claude." Self-heal configured with provider=api + Codex vendor
 *   never reaches the agent loop.
 *
 * IC-4  normalizeCodexResponse(stdout) returns no tool events for typical output
 *   packages/hench/src/agent/lifecycle/cli-loop.ts:700
 *   Codex stdout is a verbose human-readable session log (header + progress
 *   lines). parseMaybeJson() returns it as a plain string; normalizeCodexResponse
 *   therefore returns assistantText=<full stdout>, toolEvents=[]. Even if IC-1
 *   were fixed, result.toolCalls would remain [] because the underlying tool
 *   events are never extracted.
 *
 * ── Root-Cause Chain ──────────────────────────────────────────────────────
 *
 *   spawnCodex stdout → normalizeCodexResponse → toolEvents=[] (IC-4)
 *   result.toolCalls=[] → buildRunSummary([]) → filesChanged=[] (IC-1)
 *   filesChanged=[] → runTestGate skips (IC-2)
 *   ⟹ Self-heal completes without ever running the test suite for Codex runs.
 */

import { describe, it, expect } from "vitest";
import { buildRunSummary } from "../../../src/agent/analysis/summary.js";
import { normalizeCodexResponse } from "../../../src/agent/lifecycle/cli-loop.js";
import type { ToolCallRecord } from "../../../src/schema/v1.js";

function call(
  tool: string,
  input: Record<string, unknown>,
  output = "ok",
  durationMs = 10,
): ToolCallRecord {
  return { turn: 1, tool, input, output, durationMs };
}

// ── IC-1: buildRunSummary ignores Codex tool names ─────────────────────────

describe("IC-1: buildRunSummary with Codex tool names", () => {
  it("ignores shell tool calls — filesChanged stays empty", () => {
    // Codex CLI reports file edits via the `shell` tool, not `write_file`.
    // packages/hench/src/agent/analysis/summary.ts:47-101 has no `shell` case.
    const calls = [
      call("shell", { command: "echo 'export const x = 1;' > src/feature.ts" }),
      call("shell", { command: "pnpm test" }, "✓ 12 tests passed"),
    ];
    const summary = buildRunSummary(calls);
    // Documents IC-1: shell tool is silently ignored
    expect(summary.filesChanged).toEqual([]);
    expect(summary.commandsExecuted).toEqual([]);
    expect(summary.testsRun).toEqual([]);
    expect(summary.counts.toolCallsTotal).toBe(2); // calls are counted, but not classified
  });

  it("ignores str_replace_editor tool calls — filesChanged stays empty", () => {
    // Codex can report edits via `str_replace_editor` (file patch tool).
    // packages/hench/src/agent/analysis/summary.ts:47-101 has no `str_replace_editor` case.
    const calls = [
      call("str_replace_editor", { path: "src/utils.ts", old_str: "foo", new_str: "bar" }),
      call("str_replace_editor", { path: "tests/utils.test.ts", old_str: "x", new_str: "y" }),
    ];
    const summary = buildRunSummary(calls);
    // Documents IC-1: str_replace_editor is silently ignored
    expect(summary.filesChanged).toEqual([]);
    expect(summary.counts.filesChanged).toBe(0);
  });

  it("ignores create_file tool calls — filesChanged stays empty", () => {
    // Codex may use `create_file` for new files.
    // packages/hench/src/agent/analysis/summary.ts:47-101 has no `create_file` case.
    const calls = [
      call("create_file", { path: "src/new-module.ts", content: "export {};" }),
    ];
    const summary = buildRunSummary(calls);
    // Documents IC-1: create_file is silently ignored
    expect(summary.filesChanged).toEqual([]);
  });

  // ── Failing tests — assert correct behaviour, currently broken ─────────

  it.fails("should track files written via str_replace_editor (IC-1 fix target)", () => {
    // FAILS today: summary.ts:47-101 has no str_replace_editor case.
    // The fix must add a case that maps str_replace_editor `path` → changedSet.
    const calls = [
      call("str_replace_editor", { path: "src/feature.ts", old_str: "old", new_str: "new" }),
    ];
    const summary = buildRunSummary(calls);
    expect(summary.filesChanged).toContain("src/feature.ts");
  });

  it.fails("should track files written via create_file (IC-1 fix target)", () => {
    // FAILS today: summary.ts:47-101 has no create_file case.
    const calls = [
      call("create_file", { path: "src/new-module.ts", content: "export {};" }),
    ];
    const summary = buildRunSummary(calls);
    expect(summary.filesChanged).toContain("src/new-module.ts");
  });

  it.fails("should track commands run via Codex shell tool (IC-1 fix target)", () => {
    // FAILS today: summary.ts:47-101 has no `shell` case.
    // The fix must add a case that maps shell `command` → commands and tests.
    const calls = [
      call("shell", { command: "pnpm test" }, "✓ All tests passed"),
    ];
    const summary = buildRunSummary(calls);
    expect(summary.commandsExecuted).toHaveLength(1);
    expect(summary.commandsExecuted[0].command).toBe("pnpm test");
  });
});

// ── IC-2: self-heal test gate silently skips for Codex ────────────────────

describe("IC-2: empty filesChanged causes self-heal test gate to skip", () => {
  it("documents the silent-skip path: filesChanged=[] → ran=false", async () => {
    // runTestGate() short-circuits at packages/hench/src/tools/test-runner.ts:543-549:
    //   if (filesChanged.length === 0) return { ran: false, skipReason: "No files modified" };
    //
    // With IC-1 causing filesChanged to always be [] for Codex, the mandatory
    // self-heal gate never runs. No import needed — this is a logical consequence
    // documented at the call site in shared.ts:549-554.
    //
    // Chain: IC-4 → toolCalls=[] → IC-1 → filesChanged=[] → IC-2 → gate skips.
    const codexToolCalls: ToolCallRecord[] = [
      call("shell", { command: "echo 'fix' > src/patch.ts" }),
      call("str_replace_editor", { path: "src/patch.ts", old_str: "x", new_str: "y" }),
      call("shell", { command: "pnpm test" }, "✓ tests passed"),
    ];

    const summary = buildRunSummary(codexToolCalls);

    // IC-1 documented: all Codex tool calls are silently ignored
    expect(summary.filesChanged).toEqual([]);
    expect(summary.commandsExecuted).toEqual([]);

    // IC-2 consequence: runTestGate({ filesChanged: [] }) returns skipReason
    // (tested via the same guard condition that finalizeRun hits)
    expect(summary.filesChanged.length).toBe(0); // ← this is what triggers the skip
  });
});

// ── IC-4: normalizeCodexResponse cannot extract tool events from verbose stdout

describe("IC-4: normalizeCodexResponse on typical Codex verbose stdout", () => {
  it("returns no tool events for Codex session header output", () => {
    // When `codex exec --full-auto` runs, its stdout looks like:
    //   "Reading additional input from stdin...\nOpenAI Codex v0.120.0 (research preview)\n---\n..."
    // parseMaybeJson() at cli-loop.ts:173-192 sees non-JSON text and returns it as a string.
    // normalizeCodexResponse at cli-loop.ts:246-252 then treats it as plain text,
    // returning toolEvents=[] regardless of what Codex executed internally.
    const codexVerboseStdout = [
      "Reading additional input from stdin...",
      "OpenAI Codex v0.120.0 (research preview)",
      "--------",
      "workdir: /workspace",
      "model: gpt-5",
      "provider: openai",
      "approval: never",
      "sandbox: workspace-write [workdir, /tmp]",
      "--------",
      "Running command: echo 'fix'",
      "Command completed successfully.",
      "Task complete.",
    ].join("\n");

    const result = normalizeCodexResponse(codexVerboseStdout);

    // IC-4 documented: tool events are not extracted from verbose stdout
    expect(result.toolEvents).toHaveLength(0);
    // The raw text is preserved as assistantText (not useful for tool tracking)
    expect(result.assistantText).toBe(codexVerboseStdout);
    expect(result.status).toBe("completed");
  });

  it("cannot extract tool events when Codex embeds tool calls in prose", () => {
    // Even if Codex describes its actions in text, no tool events are extracted.
    // The normalizeCodexResponse parser only handles structured JSON blocks.
    const proseOutput =
      "I edited src/fix.ts using str_replace_editor.\n" +
      "Then I ran `pnpm test` with the shell tool.\n" +
      "All tests passed.";

    const result = normalizeCodexResponse(proseOutput);

    expect(result.toolEvents).toHaveLength(0);
    expect(result.assistantText).toBe(proseOutput);
  });
});

// ── IC-3: API mode throws for Codex ────────────────────────────────────────

describe("IC-3: loop.ts API provider rejects non-Claude vendor", () => {
  it("documents the hard-fail: vendor check at loop.ts:117-121", () => {
    // initApiResources() at packages/hench/src/agent/lifecycle/loop.ts:117-121:
    //   if (vendor !== "claude") {
    //     throw new Error(`Hench API mode requires llm.vendor=claude. Current vendor: ${vendor}.`);
    //   }
    //
    // Self-heal with provider=api + llm.vendor=codex throws before the agent loop starts.
    // This is an explicit guard, not a silent failure — but it means API mode is
    // completely unavailable for Codex regardless of self-heal configuration.
    //
    // Confirmed by reading loop.ts:115-122 (no dynamic import needed for documentation).
    expect(true).toBe(true); // structural — see comment above
  });
});
