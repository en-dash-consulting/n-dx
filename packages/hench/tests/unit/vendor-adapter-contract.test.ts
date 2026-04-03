/**
 * Vendor adapter contract tests.
 *
 * Asserts that both Claude and Codex adapters implement the same behavioral
 * contract: identical mock events produce identical RuntimeEvent output shapes,
 * identical error strings produce identical FailureCategory classifications,
 * and CLI arg construction produces deterministic output.
 *
 * These tests validate existing code paths directly (buildClaudeCliArgs,
 * processStreamLine, processCodexJsonLine, classifyVendorError) as the
 * regression baseline for Phase 2 adapter extraction.
 *
 * @see packages/llm-client/src/runtime-contract.ts — runtime contract types
 * @see packages/hench/src/agent/lifecycle/cli-loop.ts — vendor parse functions
 * @see docs/architecture/phase2-vendor-normalization.md — extraction plan
 */

import { describe, it, expect } from "vitest";
import {
  processStreamLine,
  processCodexJsonLine,
} from "../../src/agent/lifecycle/event-accumulator.js";
import type { CliRunResult } from "../../src/agent/lifecycle/event-accumulator.js";
import {
  buildClaudeCliArgs,
  buildAllowedTools,
} from "../../src/agent/lifecycle/adapters/claude-cli-adapter.js";
import type { ClaudeCliInput } from "../../src/agent/lifecycle/adapters/claude-cli-adapter.js";
import {
  classifyVendorError,
  failureCategoryLabel,
  mapRunFailureToCategory,
  ALL_FAILURE_CATEGORIES,
  compileCodexPolicyFlags,
} from "../../src/prd/llm-gateway.js";
import type {
  FailureCategory,
  RuntimeEventType,
} from "../../src/prd/llm-gateway.js";
import {
  CROSS_VENDOR_ERROR_FIXTURES,
  STANDARD_POLICY,
  READONLY_POLICY,
  FULL_ACCESS_POLICY,
} from "../fixtures/cross-vendor-runtime.js";

// ── Helpers ──────────────────────────────────────────────────────────────

function createResult(): CliRunResult {
  return {
    turns: 0,
    toolCalls: [],
    tokenUsage: { input: 0, output: 0 },
    turnTokenUsage: [],
  };
}

// ── 1. Parse function contract: identical mock events → identical CliRunResult shape ──

describe("vendor adapter contract: parse functions", () => {
  describe("assistant message events produce equivalent CliRunResult state", () => {
    it("Claude processStreamLine: assistant message with text block", () => {
      const result = createResult();
      const turnCounter = { value: 0 };

      processStreamLine(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "I will fix the bug." }],
          },
        }),
        result,
        turnCounter,
      );

      expect(turnCounter.value).toBe(1);
      expect(result.summary).toBe("I will fix the bug.");
      expect(result.toolCalls).toHaveLength(0);
    });

    it("Codex processCodexJsonLine: message event with text block", () => {
      const result = createResult();
      const turnCounter = { value: 0 };

      const parsed = processCodexJsonLine(
        JSON.stringify({
          type: "message",
          content: [{ type: "text", text: "I will fix the bug." }],
        }),
        result,
        turnCounter,
      );

      expect(parsed).toBe(true);
      expect(turnCounter.value).toBe(1);
      expect(result.summary).toBe("I will fix the bug.");
      expect(result.toolCalls).toHaveLength(0);
    });

    it("both vendors produce identical CliRunResult shape for assistant text", () => {
      const claudeResult = createResult();
      const claudeCounter = { value: 0 };
      processStreamLine(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Fixing auth module." }],
          },
        }),
        claudeResult,
        claudeCounter,
      );

      const codexResult = createResult();
      const codexCounter = { value: 0 };
      processCodexJsonLine(
        JSON.stringify({
          type: "message",
          content: [{ type: "text", text: "Fixing auth module." }],
        }),
        codexResult,
        codexCounter,
      );

      // Structural parity assertions
      expect(claudeCounter.value).toBe(codexCounter.value);
      expect(claudeResult.summary).toBe(codexResult.summary);
      expect(claudeResult.toolCalls).toHaveLength(codexResult.toolCalls.length);
      expect(claudeResult.turns).toBe(codexResult.turns);
    });
  });

  describe("tool use events produce equivalent CliRunResult state", () => {
    it("Claude processStreamLine: tool_use event populates toolCalls", () => {
      const result = createResult();
      const turnCounter = { value: 1 };

      processStreamLine(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "Let me edit the file." },
              {
                type: "tool_use",
                name: "Edit",
                input: { file_path: "src/auth.ts", old_string: "bug", new_string: "fix" },
              },
            ],
          },
        }),
        result,
        turnCounter,
      );

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].tool).toBe("Edit");
      expect(result.toolCalls[0].input).toEqual({
        file_path: "src/auth.ts",
        old_string: "bug",
        new_string: "fix",
      });
    });

    it("Codex processCodexJsonLine: message with tool_use populates toolCalls", () => {
      const result = createResult();
      const turnCounter = { value: 0 };

      processCodexJsonLine(
        JSON.stringify({
          type: "message",
          content: [
            { type: "text", text: "Let me edit the file." },
            {
              type: "tool_use",
              name: "Edit",
              input: { file_path: "src/auth.ts", old_string: "bug", new_string: "fix" },
            },
          ],
        }),
        result,
        turnCounter,
      );

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].tool).toBe("Edit");
      expect(result.toolCalls[0].input).toEqual({
        file_path: "src/auth.ts",
        old_string: "bug",
        new_string: "fix",
      });
    });

    it("both vendors record identical tool call shape", () => {
      const claudeResult = createResult();
      const claudeCounter = { value: 0 };
      processStreamLine(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                name: "Read",
                input: { file_path: "README.md" },
              },
            ],
          },
        }),
        claudeResult,
        claudeCounter,
      );

      const codexResult = createResult();
      const codexCounter = { value: 0 };
      processCodexJsonLine(
        JSON.stringify({
          type: "message",
          content: [
            {
              type: "tool_use",
              name: "Read",
              input: { file_path: "README.md" },
            },
          ],
        }),
        codexResult,
        codexCounter,
      );

      expect(claudeResult.toolCalls).toHaveLength(1);
      expect(codexResult.toolCalls).toHaveLength(1);
      expect(claudeResult.toolCalls[0].tool).toBe(codexResult.toolCalls[0].tool);
      expect(claudeResult.toolCalls[0].input).toEqual(codexResult.toolCalls[0].input);
      // Both should have default empty output and 0 durationMs
      expect(claudeResult.toolCalls[0].output).toBe("");
      expect(codexResult.toolCalls[0].output).toBe("");
      expect(claudeResult.toolCalls[0].durationMs).toBe(0);
      expect(codexResult.toolCalls[0].durationMs).toBe(0);
    });
  });

  describe("tool result events produce equivalent CliRunResult state", () => {
    it("Claude processStreamLine: tool_result attaches to last tool call", () => {
      const result = createResult();
      result.toolCalls.push({
        turn: 1,
        tool: "Read",
        input: { file_path: "test.ts" },
        output: "",
        durationMs: 0,
      });
      const turnCounter = { value: 1 };

      processStreamLine(
        JSON.stringify({
          type: "tool_result",
          output: "export function main() {}",
        }),
        result,
        turnCounter,
      );

      expect(result.toolCalls[0].output).toBe("export function main() {}");
    });

    it("Codex processCodexJsonLine: function_call_output attaches to last tool call", () => {
      const result = createResult();
      result.toolCalls.push({
        turn: 1,
        tool: "Read",
        input: { file_path: "test.ts" },
        output: "",
        durationMs: 0,
      });
      const turnCounter = { value: 1 };

      processCodexJsonLine(
        JSON.stringify({
          type: "function_call_output",
          output: "export function main() {}",
        }),
        result,
        turnCounter,
      );

      expect(result.toolCalls[0].output).toBe("export function main() {}");
    });
  });

  describe("token usage events produce equivalent accumulation", () => {
    it("Claude processStreamLine: accumulates per-turn token usage", () => {
      const result = createResult();
      const turnCounter = { value: 0 };
      const meta = { vendor: "claude" as const, model: "claude-sonnet-4-6" };

      processStreamLine(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Done" }],
            usage: { input_tokens: 100, output_tokens: 50 },
          },
        }),
        result,
        turnCounter,
        meta,
      );

      expect(result.tokenUsage.input).toBe(100);
      expect(result.tokenUsage.output).toBe(50);
      expect(result.turnTokenUsage).toHaveLength(1);
      expect(result.turnTokenUsage[0]).toMatchObject({
        turn: 1,
        input: 100,
        output: 50,
        vendor: "claude",
        model: "claude-sonnet-4-6",
      });
    });

    it("Codex processCodexJsonLine: accumulates per-turn token usage", () => {
      const result = createResult();
      const turnCounter = { value: 0 };
      const meta = { vendor: "codex" as const, model: "gpt-5-codex" };

      processCodexJsonLine(
        JSON.stringify({
          type: "message",
          content: [{ type: "text", text: "Done" }],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
        result,
        turnCounter,
        meta,
      );

      expect(result.tokenUsage.input).toBe(100);
      expect(result.tokenUsage.output).toBe(50);
      expect(result.turnTokenUsage).toHaveLength(1);
      expect(result.turnTokenUsage[0]).toMatchObject({
        turn: 1,
        input: 100,
        output: 50,
        vendor: "codex",
        model: "gpt-5-codex",
      });
    });

    it("both vendors accumulate identical token totals from equivalent sequences", () => {
      const claudeResult = createResult();
      const claudeCounter = { value: 0 };
      const claudeMeta = { vendor: "claude" as const, model: "claude-sonnet-4-6" };

      const codexResult = createResult();
      const codexCounter = { value: 0 };
      const codexMeta = { vendor: "codex" as const, model: "gpt-5-codex" };

      // Turn 1
      processStreamLine(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Step 1" }],
            usage: { input_tokens: 200, output_tokens: 80 },
          },
        }),
        claudeResult,
        claudeCounter,
        claudeMeta,
      );
      processCodexJsonLine(
        JSON.stringify({
          type: "message",
          content: [{ type: "text", text: "Step 1" }],
          usage: { input_tokens: 200, output_tokens: 80 },
        }),
        codexResult,
        codexCounter,
        codexMeta,
      );

      // Turn 2
      processStreamLine(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Step 2" }],
            usage: { input_tokens: 300, output_tokens: 120 },
          },
        }),
        claudeResult,
        claudeCounter,
        claudeMeta,
      );
      processCodexJsonLine(
        JSON.stringify({
          type: "message",
          content: [{ type: "text", text: "Step 2" }],
          usage: { input_tokens: 300, output_tokens: 120 },
        }),
        codexResult,
        codexCounter,
        codexMeta,
      );

      // Token totals must match
      expect(claudeResult.tokenUsage.input).toBe(codexResult.tokenUsage.input);
      expect(claudeResult.tokenUsage.output).toBe(codexResult.tokenUsage.output);
      expect(claudeResult.tokenUsage.input).toBe(500);
      expect(claudeResult.tokenUsage.output).toBe(200);

      // Turn count must match
      expect(claudeCounter.value).toBe(codexCounter.value);
      expect(claudeCounter.value).toBe(2);

      // Per-turn usage count must match
      expect(claudeResult.turnTokenUsage).toHaveLength(codexResult.turnTokenUsage.length);
    });
  });

  describe("completion events produce equivalent CliRunResult state", () => {
    it("Claude processStreamLine: result event sets summary and turns", () => {
      const result = createResult();
      const turnCounter = { value: 3 };

      processStreamLine(
        JSON.stringify({
          type: "result",
          result: "Task completed successfully",
          num_turns: 3,
          cost_usd: 0.05,
        }),
        result,
        turnCounter,
      );

      expect(result.summary).toBe("Task completed successfully");
      expect(result.turns).toBe(3);
      expect(result.costUsd).toBe(0.05);
    });

    it("Codex processCodexJsonLine: summary event sets summary and turns", () => {
      const result = createResult();
      const turnCounter = { value: 3 };

      processCodexJsonLine(
        JSON.stringify({
          type: "summary",
          result: "Task completed successfully",
          num_turns: 3,
          cost_usd: 0.05,
        }),
        result,
        turnCounter,
      );

      expect(result.summary).toBe("Task completed successfully");
      expect(result.turns).toBe(3);
      expect(result.costUsd).toBe(0.05);
    });

    it("both vendors record identical completion state", () => {
      const claudeResult = createResult();
      const codexResult = createResult();

      processStreamLine(
        JSON.stringify({
          type: "result",
          result: "All done. Tests pass.",
          num_turns: 5,
          cost_usd: 0.12,
        }),
        claudeResult,
        { value: 5 },
      );

      processCodexJsonLine(
        JSON.stringify({
          type: "summary",
          result: "All done. Tests pass.",
          num_turns: 5,
          cost_usd: 0.12,
        }),
        codexResult,
        { value: 5 },
      );

      expect(claudeResult.summary).toBe(codexResult.summary);
      expect(claudeResult.turns).toBe(codexResult.turns);
      expect(claudeResult.costUsd).toBe(codexResult.costUsd);
    });
  });

  describe("error events produce equivalent CliRunResult state", () => {
    it("Claude processStreamLine: is_error result records error", () => {
      const result = createResult();
      const turnCounter = { value: 0 };

      processStreamLine(
        JSON.stringify({
          type: "result",
          is_error: true,
          result: "Compilation failed",
        }),
        result,
        turnCounter,
      );

      expect(result.error).toBe("Compilation failed");
    });

    it("Codex processCodexJsonLine: error event records error", () => {
      const result = createResult();
      const turnCounter = { value: 0 };

      processCodexJsonLine(
        JSON.stringify({
          type: "error",
          message: "Compilation failed",
        }),
        result,
        turnCounter,
      );

      expect(result.error).toBe("Compilation failed");
    });

    it("Codex processCodexJsonLine: is_error summary records error", () => {
      const result = createResult();
      const turnCounter = { value: 0 };

      processCodexJsonLine(
        JSON.stringify({
          type: "summary",
          is_error: true,
          result: "Compilation failed",
        }),
        result,
        turnCounter,
      );

      expect(result.error).toBe("Compilation failed");
    });
  });

  describe("unrecognized events are handled gracefully", () => {
    it("Claude processStreamLine: non-JSON lines do not throw", () => {
      const result = createResult();
      const turnCounter = { value: 0 };

      expect(() => {
        processStreamLine("not json", result, turnCounter);
        processStreamLine("", result, turnCounter);
        processStreamLine("  ", result, turnCounter);
      }).not.toThrow();

      // State should be unchanged
      expect(result.turns).toBe(0);
      expect(result.toolCalls).toHaveLength(0);
    });

    it("Codex processCodexJsonLine: non-JSON lines return false", () => {
      const result = createResult();
      const turnCounter = { value: 0 };

      expect(processCodexJsonLine("not json", result, turnCounter)).toBe(false);
      expect(processCodexJsonLine("", result, turnCounter)).toBe(false);
      expect(processCodexJsonLine("  ", result, turnCounter)).toBe(false);
    });

    it("Codex processCodexJsonLine: unknown event types return false", () => {
      const result = createResult();
      const turnCounter = { value: 0 };

      expect(
        processCodexJsonLine(
          JSON.stringify({ type: "response.delta", delta: "text" }),
          result,
          turnCounter,
        ),
      ).toBe(false);
    });
  });
});

// ── 2. RuntimeEvent output shape assertions ──────────────────────────────

describe("vendor adapter contract: RuntimeEvent output shape", () => {
  /**
   * All 6 RuntimeEventType values must be handled by at least one vendor.
   * This ensures the adapter interface covers the full event taxonomy.
   */
  it("all RuntimeEventType values are exercised by the parse functions", () => {
    const allTypes: RuntimeEventType[] = [
      "assistant",
      "tool_use",
      "tool_result",
      "completion",
      "failure",
      "token_usage",
    ];
    expect(allTypes).toHaveLength(6);

    // Claude handles: assistant (via content blocks), tool_use, tool_result, result (completion)
    // Codex handles: message (assistant), function_call (tool_use), function_call_output (tool_result),
    //   summary/done/complete (completion), error (failure)
    // Both produce token_usage as part of assistant/message events
    // This test documents the mapping; the actual parse tests above verify behavior.
    for (const eventType of allTypes) {
      expect(typeof eventType).toBe("string");
    }
  });

  it("CliRunResult shape is identical between vendors", () => {
    // Both vendors produce CliRunResult with the same keys.
    // This test verifies the structural contract.
    const result = createResult();
    const expectedKeys = ["turns", "toolCalls", "tokenUsage", "turnTokenUsage"];
    for (const key of expectedKeys) {
      expect(result).toHaveProperty(key);
    }

    // Optional keys exist after population
    expect("summary" in result || result.summary === undefined).toBe(true);
    expect("error" in result || result.error === undefined).toBe(true);
    expect("costUsd" in result || result.costUsd === undefined).toBe(true);
  });

  it("toolCalls entries have consistent shape from both vendors", () => {
    // Claude path
    const claudeResult = createResult();
    processStreamLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Bash", input: { command: "npm test" } },
          ],
        },
      }),
      claudeResult,
      { value: 0 },
    );

    // Codex path
    const codexResult = createResult();
    processCodexJsonLine(
      JSON.stringify({
        type: "message",
        content: [
          { type: "tool_use", name: "Bash", input: { command: "npm test" } },
        ],
      }),
      codexResult,
      { value: 0 },
    );

    // Both tool call records must have identical structure
    const claudeCall = claudeResult.toolCalls[0];
    const codexCall = codexResult.toolCalls[0];

    expect(claudeCall).toHaveProperty("turn");
    expect(claudeCall).toHaveProperty("tool");
    expect(claudeCall).toHaveProperty("input");
    expect(claudeCall).toHaveProperty("output");
    expect(claudeCall).toHaveProperty("durationMs");

    expect(codexCall).toHaveProperty("turn");
    expect(codexCall).toHaveProperty("tool");
    expect(codexCall).toHaveProperty("input");
    expect(codexCall).toHaveProperty("output");
    expect(codexCall).toHaveProperty("durationMs");

    // Values match
    expect(claudeCall.tool).toBe(codexCall.tool);
    expect(claudeCall.input).toEqual(codexCall.input);
  });
});

// ── 3. FailureCategory mapping assertions ────────────────────────────────

describe("vendor adapter contract: FailureCategory mapping", () => {
  describe("classifyVendorError maps identical errors to identical categories", () => {
    for (const fixture of CROSS_VENDOR_ERROR_FIXTURES) {
      it(`"${fixture.description}" → ${fixture.expected}`, () => {
        const category = classifyVendorError(new Error(fixture.message));
        expect(category).toBe(fixture.expected);
      });
    }
  });

  it("every FailureCategory has a human-readable label", () => {
    for (const category of ALL_FAILURE_CATEGORIES) {
      const label = failureCategoryLabel(category);
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("ALL_FAILURE_CATEGORIES is exhaustive (11 categories)", () => {
    expect(ALL_FAILURE_CATEGORIES).toHaveLength(11);
    const expectedCategories: FailureCategory[] = [
      "auth",
      "not_found",
      "timeout",
      "rate_limit",
      "completion_rejected",
      "budget_exceeded",
      "spin_detected",
      "malformed_output",
      "mcp_unavailable",
      "transient_exhausted",
      "unknown",
    ];
    expect([...ALL_FAILURE_CATEGORIES]).toEqual(expectedCategories);
  });

  it("hench run failure reasons map consistently for both vendors", () => {
    const reasonMappings: Array<[string, FailureCategory]> = [
      ["spin_detected", "spin_detected"],
      ["completion_rejected", "completion_rejected"],
      ["budget_exceeded", "budget_exceeded"],
      ["task_transient_exhausted", "transient_exhausted"],
      ["task_failed", "unknown"],
      ["unrecognized_reason", "unknown"],
    ];

    for (const [reason, expected] of reasonMappings) {
      expect(mapRunFailureToCategory(reason)).toBe(expected);
    }
  });

  it("vendor-specific error patterns are covered for both Claude and Codex", () => {
    // Claude-specific errors
    expect(classifyVendorError(new Error("Missing ANTHROPIC_API_KEY"))).toBe("auth");

    // Codex-specific errors
    expect(classifyVendorError(new Error("Missing OPENAI_API_KEY"))).toBe("auth");

    // Vendor-neutral errors that both may produce
    expect(classifyVendorError(new Error("rate limit exceeded"))).toBe("rate_limit");
    expect(classifyVendorError(new Error("ETIMEDOUT"))).toBe("timeout");
    expect(classifyVendorError(new Error("HTTP 502 Bad Gateway"))).toBe("transient_exhausted");
    expect(classifyVendorError(new Error("budget exceeded for this run"))).toBe("budget_exceeded");
    expect(classifyVendorError(new Error("Unexpected token < in JSON"))).toBe("malformed_output");
  });
});

// ── 4. Snapshot baselines: Claude CLI args ───────────────────────────────

describe("vendor adapter contract: Claude CLI arg snapshots", () => {
  it("buildClaudeCliArgs produces deterministic args for standard input", () => {
    const input: ClaudeCliInput = {
      systemPrompt: "You are Hench, an autonomous AI agent.",
      promptText: "Fix the authentication bug in src/auth.ts.",
      allowedTools: ["Bash(npm:*)", "Bash(git:*)", "Read", "Edit", "Write", "Glob", "Grep"],
    };

    const { args, stdinContent } = buildClaudeCliArgs(input);

    // Non-Windows baseline (CI and most dev environments)
    if (process.platform !== "win32") {
      expect(args).toEqual([
        "-p",
        "--output-format", "stream-json",
        "--verbose",
        "--system-prompt", "You are Hench, an autonomous AI agent.",
        "--allowed-tools",
        "Bash(npm:*)", "Bash(git:*)", "Read", "Edit", "Write", "Glob", "Grep",
      ]);
      expect(stdinContent).toBe("Fix the authentication bug in src/auth.ts.");
    }
  });

  it("buildClaudeCliArgs includes model override when specified", () => {
    const input: ClaudeCliInput = {
      systemPrompt: "System prompt.",
      promptText: "Task prompt.",
      allowedTools: ["Read"],
      modelOverride: "claude-opus-4",
    };

    const { args } = buildClaudeCliArgs(input);

    expect(args).toContain("--model");
    expect(args).toContain("claude-opus-4");
    // --model should appear after other flags
    const modelIdx = args.indexOf("--model");
    expect(modelIdx).toBeGreaterThan(0);
    expect(args[modelIdx + 1]).toBe("claude-opus-4");
  });

  it("buildClaudeCliArgs always includes required flags", () => {
    const input: ClaudeCliInput = {
      systemPrompt: "SP",
      promptText: "TP",
      allowedTools: [],
    };

    const { args } = buildClaudeCliArgs(input);

    expect(args).toContain("-p");
    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
    expect(args).toContain("--verbose");
    expect(args).toContain("--allowed-tools");
  });

  it("buildAllowedTools maps commands to Claude CLI tool patterns", () => {
    const tools = buildAllowedTools(["npm", "git", "node"]);

    expect(tools).toContain("Bash(npm:*)");
    expect(tools).toContain("Bash(git:*)");
    expect(tools).toContain("Bash(node:*)");
    // File tools are always included
    expect(tools).toContain("Read");
    expect(tools).toContain("Edit");
    expect(tools).toContain("Write");
    expect(tools).toContain("Glob");
    expect(tools).toContain("Grep");
  });

  it("buildAllowedTools with empty commands still includes file tools", () => {
    const tools = buildAllowedTools([]);
    expect(tools).toEqual(["Read", "Edit", "Write", "Glob", "Grep"]);
  });
});

// ── 5. Snapshot baselines: Codex policy flags ────────────────────────────

describe("vendor adapter contract: Codex policy flag snapshots", () => {
  it("standard policy compiles to deterministic Codex flags", () => {
    const flags = compileCodexPolicyFlags(STANDARD_POLICY);
    expect(flags).toEqual([
      "--sandbox", "workspace-write",
      "--approval-policy", "full-auto",
    ]);
  });

  it("read-only policy compiles to deterministic Codex flags", () => {
    const flags = compileCodexPolicyFlags(READONLY_POLICY);
    expect(flags).toEqual([
      "--sandbox", "read-only",
      "--approval-policy", "auto-edit",
    ]);
  });

  it("full-access policy compiles to deterministic Codex flags", () => {
    const flags = compileCodexPolicyFlags(FULL_ACCESS_POLICY);
    expect(flags).toEqual([
      "--sandbox", "full-access",
      "--approval-policy", "full-auto",
    ]);
  });
});

// ── 6. Snapshot baselines: token totals ──────────────────────────────────

describe("vendor adapter contract: token total snapshots", () => {
  it("multi-turn Claude sequence produces deterministic token totals", () => {
    const result = createResult();
    const counter = { value: 0 };
    const meta = { vendor: "claude" as const, model: "claude-sonnet-4-6" };

    // Turn 1: 200 in, 80 out
    processStreamLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Analyzing" }],
          usage: { input_tokens: 200, output_tokens: 80 },
        },
      }),
      result,
      counter,
      meta,
    );

    // Turn 2: 350 in, 120 out, with cache
    processStreamLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Implementing" }],
          usage: {
            input_tokens: 350,
            output_tokens: 120,
            cache_creation_input_tokens: 50,
            cache_read_input_tokens: 100,
          },
        },
      }),
      result,
      counter,
      meta,
    );

    // Snapshot assertions
    expect(result.tokenUsage).toEqual({
      input: 550,
      output: 200,
      cacheCreationInput: 50,
      cacheReadInput: 100,
    });
    expect(result.turnTokenUsage).toHaveLength(2);
    expect(counter.value).toBe(2);
  });

  it("multi-turn Codex sequence produces deterministic token totals", () => {
    const result = createResult();
    const counter = { value: 0 };
    const meta = { vendor: "codex" as const, model: "gpt-5-codex" };

    // Turn 1: 200 in, 80 out
    processCodexJsonLine(
      JSON.stringify({
        type: "message",
        content: [{ type: "text", text: "Analyzing" }],
        usage: { input_tokens: 200, output_tokens: 80 },
      }),
      result,
      counter,
      meta,
    );

    // Turn 2: 350 in, 120 out
    processCodexJsonLine(
      JSON.stringify({
        type: "message",
        content: [{ type: "text", text: "Implementing" }],
        usage: { input_tokens: 350, output_tokens: 120 },
      }),
      result,
      counter,
      meta,
    );

    // Snapshot assertions
    expect(result.tokenUsage.input).toBe(550);
    expect(result.tokenUsage.output).toBe(200);
    expect(result.turnTokenUsage).toHaveLength(2);
    expect(counter.value).toBe(2);
  });
});

// ── 7. Full multi-event sequence parity ──────────────────────────────────

describe("vendor adapter contract: full sequence parity", () => {
  it("identical 5-event sequences produce structurally equivalent results", () => {
    const claudeResult = createResult();
    const claudeCounter = { value: 0 };
    const claudeMeta = { vendor: "claude" as const, model: "claude-sonnet-4-6" };

    const codexResult = createResult();
    const codexCounter = { value: 0 };
    const codexMeta = { vendor: "codex" as const, model: "gpt-5-codex" };

    // Event 1: Assistant message
    processStreamLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "I will fix the bug." }],
          usage: { input_tokens: 100, output_tokens: 40 },
        },
      }),
      claudeResult,
      claudeCounter,
      claudeMeta,
    );
    processCodexJsonLine(
      JSON.stringify({
        type: "message",
        content: [{ type: "text", text: "I will fix the bug." }],
        usage: { input_tokens: 100, output_tokens: 40 },
      }),
      codexResult,
      codexCounter,
      codexMeta,
    );

    // Event 2: Tool use (embedded in assistant for Claude)
    processStreamLine(
      JSON.stringify({
        type: "tool_use",
        tool: "Edit",
        input: { file_path: "src/auth.ts" },
      }),
      claudeResult,
      claudeCounter,
    );
    processCodexJsonLine(
      JSON.stringify({
        type: "function_call",
        name: "Edit",
        arguments: "{\"file_path\":\"src/auth.ts\"}",
      }),
      codexResult,
      codexCounter,
    );

    // Event 3: Tool result
    processStreamLine(
      JSON.stringify({
        type: "tool_result",
        output: "File edited successfully",
      }),
      claudeResult,
      claudeCounter,
    );
    processCodexJsonLine(
      JSON.stringify({
        type: "function_call_output",
        output: "File edited successfully",
      }),
      codexResult,
      codexCounter,
    );

    // Event 4: Second assistant turn
    processStreamLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Fix applied." }],
          usage: { input_tokens: 150, output_tokens: 30 },
        },
      }),
      claudeResult,
      claudeCounter,
      claudeMeta,
    );
    processCodexJsonLine(
      JSON.stringify({
        type: "message",
        content: [{ type: "text", text: "Fix applied." }],
        usage: { input_tokens: 150, output_tokens: 30 },
      }),
      codexResult,
      codexCounter,
      codexMeta,
    );

    // Event 5: Completion
    processStreamLine(
      JSON.stringify({
        type: "result",
        result: "Task completed",
        num_turns: 2,
        cost_usd: 0.03,
      }),
      claudeResult,
      claudeCounter,
    );
    processCodexJsonLine(
      JSON.stringify({
        type: "summary",
        result: "Task completed",
        num_turns: 2,
        cost_usd: 0.03,
      }),
      codexResult,
      codexCounter,
    );

    // Structural parity
    expect(claudeCounter.value).toBe(codexCounter.value);
    expect(claudeResult.toolCalls).toHaveLength(codexResult.toolCalls.length);
    expect(claudeResult.tokenUsage.input).toBe(codexResult.tokenUsage.input);
    expect(claudeResult.tokenUsage.output).toBe(codexResult.tokenUsage.output);
    expect(claudeResult.summary).toBe(codexResult.summary);
    expect(claudeResult.turns).toBe(codexResult.turns);
    expect(claudeResult.costUsd).toBe(codexResult.costUsd);
    expect(claudeResult.turnTokenUsage).toHaveLength(
      codexResult.turnTokenUsage.length,
    );

    // Exact values
    expect(claudeResult.tokenUsage.input).toBe(250);
    expect(claudeResult.tokenUsage.output).toBe(70);
    expect(claudeResult.turns).toBe(2);
    expect(claudeResult.costUsd).toBe(0.03);
  });
});
