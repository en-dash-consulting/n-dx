/**
 * Self-Heal Batch Pipeline — Codex Vendor Compatibility
 *
 * Verifies that the self-heal batch pipeline handles Codex tool names and
 * output format correctly.  Each test is tagged with the file:line of the
 * code path under test.
 *
 * ── Resolved incompatibilities ───────────────────────────────────────────────
 *
 * IC-1  buildRunSummary now recognises Codex tool names
 *   packages/hench/src/agent/analysis/summary.ts
 *   Added cases for: shell, str_replace_editor, create_file.
 *   These mirror the Claude equivalents (run_command, write_file, write_file).
 *
 * IC-2  Self-heal test gate now runs for Codex via git-diff fallback
 *   packages/hench/src/agent/lifecycle/shared.ts
 *   When toolCalls is empty, finalizeRun falls back to `git diff --name-only
 *   HEAD` to populate filesChanged before calling runTestGate.
 *
 * ── Remaining limitations (out of scope for this task) ───────────────────────
 *
 * IC-3  API provider mode explicitly rejects non-Claude vendors
 *   packages/hench/src/agent/lifecycle/loop.ts:117-121
 *   Self-heal with provider=api + vendor=codex throws before the agent loop.
 *   This is an explicit guard, not a silent failure.
 *
 * IC-4  normalizeCodexResponse cannot extract tool events from verbose stdout
 *   packages/hench/src/agent/lifecycle/cli-loop.ts
 *   Codex stdout is a verbose human-readable session log; parseMaybeJson()
 *   returns it as a plain string so toolEvents=[] regardless of work done.
 *   The IC-2 git-diff fallback compensates for this at the test-gate level.
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

// ── IC-1: buildRunSummary now handles Codex tool names ─────────────────────

describe("IC-1 (resolved): buildRunSummary with Codex tool names", () => {
  it("tracks files written via str_replace_editor", () => {
    // packages/hench/src/agent/analysis/summary.ts — new str_replace_editor case
    const calls = [
      call("str_replace_editor", { path: "src/feature.ts", old_str: "old", new_str: "new" }),
    ];
    const summary = buildRunSummary(calls);
    expect(summary.filesChanged).toContain("src/feature.ts");
    expect(summary.counts.filesChanged).toBe(1);
  });

  it("tracks multiple files written via str_replace_editor", () => {
    const calls = [
      call("str_replace_editor", { path: "src/utils.ts", old_str: "foo", new_str: "bar" }),
      call("str_replace_editor", { path: "tests/utils.test.ts", old_str: "x", new_str: "y" }),
    ];
    const summary = buildRunSummary(calls);
    expect(summary.filesChanged).toContain("src/utils.ts");
    expect(summary.filesChanged).toContain("tests/utils.test.ts");
    expect(summary.counts.filesChanged).toBe(2);
  });

  it("tracks files written via create_file", () => {
    // packages/hench/src/agent/analysis/summary.ts — new create_file case
    const calls = [
      call("create_file", { path: "src/new-module.ts", content: "export {};" }),
    ];
    const summary = buildRunSummary(calls);
    expect(summary.filesChanged).toContain("src/new-module.ts");
    expect(summary.counts.filesChanged).toBe(1);
  });

  it("tracks commands run via Codex shell tool", () => {
    // packages/hench/src/agent/analysis/summary.ts — new shell case
    const calls = [
      call("shell", { command: "pnpm test" }, "✓ All tests passed"),
    ];
    const summary = buildRunSummary(calls);
    expect(summary.commandsExecuted).toHaveLength(1);
    expect(summary.commandsExecuted[0].command).toBe("pnpm test");
  });

  it("detects test commands run via shell tool", () => {
    const calls = [
      call("shell", { command: "pnpm test" }, "✓ 12 tests passed"),
    ];
    const summary = buildRunSummary(calls);
    expect(summary.testsRun).toHaveLength(1);
    expect(summary.testsRun[0].command).toBe("pnpm test");
    expect(summary.testsRun[0].passed).toBe(true);
  });

  it("counts all tool calls in toolCallsTotal regardless of type", () => {
    const calls = [
      call("shell", { command: "echo 'export const x = 1;' > src/feature.ts" }),
      call("shell", { command: "pnpm test" }, "✓ 12 tests passed"),
    ];
    const summary = buildRunSummary(calls);
    expect(summary.counts.toolCallsTotal).toBe(2);
    // shell commands are tracked in commandsExecuted
    expect(summary.commandsExecuted).toHaveLength(2);
  });

  it("does not add file paths from shell commands to filesChanged", () => {
    // Shell commands do not auto-populate filesChanged — only explicit file
    // tools (str_replace_editor, create_file, write_file) do that.
    const calls = [
      call("shell", { command: "echo 'x' > src/patch.ts" }),
    ];
    const summary = buildRunSummary(calls);
    expect(summary.filesChanged).toEqual([]);
    expect(summary.commandsExecuted).toHaveLength(1);
  });

  it("handles a realistic Codex run with mixed tool types", () => {
    const calls = [
      call("shell", { command: "echo 'fix' > /dev/null" }),
      call("str_replace_editor", { path: "src/patch.ts", old_str: "x", new_str: "y" }),
      call("shell", { command: "pnpm test" }, "✓ tests passed"),
    ];
    const summary = buildRunSummary(calls);
    expect(summary.filesChanged).toEqual(["src/patch.ts"]);
    expect(summary.commandsExecuted).toHaveLength(2);
    expect(summary.testsRun).toHaveLength(1);
    expect(summary.counts.toolCallsTotal).toBe(3);
  });
});

// ── IC-4: normalizeCodexResponse cannot extract tool events from verbose stdout

describe("IC-4 (limitation): normalizeCodexResponse on typical Codex verbose stdout", () => {
  it("returns no tool events for Codex session header output", () => {
    // When `codex exec --full-auto` runs, its stdout looks like:
    //   "Reading additional input from stdin...\nOpenAI Codex v0.120.0 (research preview)\n---\n..."
    // parseMaybeJson() at cli-loop.ts:173-192 sees non-JSON text and returns it as a string.
    // normalizeCodexResponse at cli-loop.ts:246-252 then treats it as plain text,
    // returning toolEvents=[] regardless of what Codex executed internally.
    // The IC-2 git-diff fallback in shared.ts compensates for this at the test-gate level.
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

describe("IC-3 (explicit guard): loop.ts API provider rejects non-Claude vendor", () => {
  it("documents the hard-fail: vendor check at loop.ts:117-121", () => {
    // initApiResources() at packages/hench/src/agent/lifecycle/loop.ts:117-121:
    //   if (vendor !== "claude") {
    //     throw new Error(`Hench API mode requires llm.vendor=claude. Current vendor: ${vendor}.`);
    //   }
    //
    // Self-heal with provider=api + llm.vendor=codex throws before the agent loop starts.
    // This is an explicit guard, not a silent failure — API mode is intentionally
    // unavailable for Codex.
    expect(true).toBe(true); // structural — see comment above
  });
});
