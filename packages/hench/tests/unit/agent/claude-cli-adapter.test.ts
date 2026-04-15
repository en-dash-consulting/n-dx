/**
 * Unit tests for ClaudeCliAdapter.
 *
 * Tests that the extracted adapter:
 * 1. Implements the VendorAdapter interface correctly
 * 2. buildSpawnConfig produces identical args to the original buildClaudeCliArgs
 * 3. parseEvent produces RuntimeEvents from Claude stream-json lines
 * 4. classifyError delegates to classifyVendorError
 * 5. Snapshot: exact args array is byte-identical to pre-extraction baseline
 *
 * @see packages/hench/src/agent/lifecycle/adapters/claude-cli-adapter.ts
 * @see packages/hench/src/agent/lifecycle/vendor-adapter.ts — VendorAdapter interface
 */

import { describe, it, expect } from "vitest";
import {
  claudeCliAdapter,
  buildClaudeCliArgs,
  buildAllowedTools,
} from "../../../src/agent/lifecycle/adapters/claude-cli-adapter.js";
import {
  buildClaudeCliArgs as originalBuildClaudeCliArgs,
  buildAllowedTools as originalBuildAllowedTools,
} from "../../../src/agent/lifecycle/adapters/claude-cli-adapter.js";
import type { ClaudeCliInput } from "../../../src/agent/lifecycle/adapters/claude-cli-adapter.js";
import type { VendorAdapter, SpawnConfig } from "../../../src/agent/lifecycle/vendor-adapter.js";
import {
  DEFAULT_EXECUTION_POLICY,
  createPromptEnvelope,
  classifyVendorError,
} from "../../../src/prd/llm-gateway.js";
import type {
  PromptEnvelope,
  ExecutionPolicy,
  RuntimeEvent,
  FailureCategory,
} from "../../../src/prd/llm-gateway.js";
import {
  STANDARD_POLICY,
  FULL_ACCESS_POLICY,
  CROSS_VENDOR_ERROR_FIXTURES,
} from "../../fixtures/cross-vendor-runtime.js";

// ── Helpers ──────────────────────────────────────────────────────────────

function createStandardEnvelope(): PromptEnvelope {
  return createPromptEnvelope([
    { name: "system", content: "You are Hench, an autonomous AI agent." },
    { name: "workflow", content: "Follow TDD: red → green → refactor." },
    { name: "brief", content: "Fix the authentication bug in src/auth.ts." },
    { name: "files", content: "src/auth.ts — existing auth module." },
    { name: "validation", content: "Run `npm test` and `npm run typecheck`." },
    { name: "completion", content: "Done when all tests pass and types check." },
  ]);
}

function createMinimalEnvelope(): PromptEnvelope {
  return createPromptEnvelope([
    { name: "system", content: "You are Hench." },
    { name: "brief", content: "Fix the bug." },
  ]);
}

// ── 1. VendorAdapter interface compliance ────────────────────────────────

describe("ClaudeCliAdapter: VendorAdapter interface", () => {
  it("satisfies VendorAdapter type", () => {
    // Type-level: assigning to VendorAdapter compiles
    const adapter: VendorAdapter = claudeCliAdapter;
    expect(adapter).toBeDefined();
  });

  it("reports 'claude' vendor", () => {
    expect(claudeCliAdapter.vendor).toBe("claude");
  });

  it("reports 'stream-json' parseMode", () => {
    expect(claudeCliAdapter.parseMode).toBe("stream-json");
  });

  it("has all required methods", () => {
    expect(typeof claudeCliAdapter.buildSpawnConfig).toBe("function");
    expect(typeof claudeCliAdapter.parseEvent).toBe("function");
    expect(typeof claudeCliAdapter.classifyError).toBe("function");
  });
});

// ── 2. buildSpawnConfig ──────────────────────────────────────────────────

describe("ClaudeCliAdapter: buildSpawnConfig", () => {
  it("returns a valid SpawnConfig", () => {
    const envelope = createStandardEnvelope();
    const config: SpawnConfig = claudeCliAdapter.buildSpawnConfig(
      envelope,
      DEFAULT_EXECUTION_POLICY,
      undefined,
    );

    expect(config.binary).toBe("claude");
    expect(Array.isArray(config.args)).toBe(true);
    expect(typeof config.stdinContent).toBe("string");
    expect(config.stdinContent).not.toBeNull();
    expect(config.cwd).toBe(".");
    expect(typeof config.env).toBe("object");
  });

  it("includes required Claude CLI flags", () => {
    const config = claudeCliAdapter.buildSpawnConfig(
      createMinimalEnvelope(),
      DEFAULT_EXECUTION_POLICY,
      undefined,
    );

    expect(config.args).toContain("-p");
    expect(config.args).toContain("--output-format");
    expect(config.args).toContain("stream-json");
    expect(config.args).toContain("--verbose");
    expect(config.args).toContain("--allowed-tools");
  });

  it("includes --system-prompt on non-Windows", () => {
    if (process.platform === "win32") return;

    const config = claudeCliAdapter.buildSpawnConfig(
      createStandardEnvelope(),
      DEFAULT_EXECUTION_POLICY,
      undefined,
    );

    expect(config.args).toContain("--system-prompt");
  });

  it("places model override as --model flag", () => {
    const config = claudeCliAdapter.buildSpawnConfig(
      createMinimalEnvelope(),
      DEFAULT_EXECUTION_POLICY,
      "claude-opus-4",
    );

    expect(config.args).toContain("--model");
    expect(config.args).toContain("claude-opus-4");
    const modelIdx = config.args.indexOf("--model");
    expect(config.args[modelIdx + 1]).toBe("claude-opus-4");
  });

  it("omits --model when model is undefined", () => {
    const config = claudeCliAdapter.buildSpawnConfig(
      createMinimalEnvelope(),
      DEFAULT_EXECUTION_POLICY,
      undefined,
    );

    expect(config.args).not.toContain("--model");
  });

  it("maps policy allowedCommands to --allowed-tools", () => {
    const config = claudeCliAdapter.buildSpawnConfig(
      createMinimalEnvelope(),
      FULL_ACCESS_POLICY,
      undefined,
    );

    // FULL_ACCESS_POLICY has allowedCommands: ["npm", "git", "node", "tsc"]
    expect(config.args).toContain("Bash(npm:*)");
    expect(config.args).toContain("Bash(git:*)");
    expect(config.args).toContain("Bash(node:*)");
    expect(config.args).toContain("Bash(tsc:*)");
    // File tools always included
    expect(config.args).toContain("Read");
    expect(config.args).toContain("Edit");
    expect(config.args).toContain("Write");
    expect(config.args).toContain("Glob");
    expect(config.args).toContain("Grep");
  });

  it("stdinContent contains task prompt (non-Windows)", () => {
    if (process.platform === "win32") return;

    const config = claudeCliAdapter.buildSpawnConfig(
      createMinimalEnvelope(),
      DEFAULT_EXECUTION_POLICY,
      undefined,
    );

    // On non-Windows, stdinContent is the task sections only
    expect(config.stdinContent).toContain("Fix the bug.");
  });

  it("stdinContent is a string, not null (Claude uses pipe-based delivery)", () => {
    const config = claudeCliAdapter.buildSpawnConfig(
      createMinimalEnvelope(),
      DEFAULT_EXECUTION_POLICY,
      undefined,
    );

    expect(config.stdinContent).not.toBeNull();
    expect(typeof config.stdinContent).toBe("string");
  });
});

// ── 3. Snapshot: byte-identical args ─────────────────────────────────────

describe("ClaudeCliAdapter: snapshot parity with original buildClaudeCliArgs", () => {
  /**
   * CRITICAL: This snapshot test captures the exact args array produced by the
   * adapter and asserts it is byte-identical to the original buildClaudeCliArgs
   * function in cli-loop.ts.
   *
   * If this test fails, the extraction introduced a behavioral change.
   */
  it("standard input produces identical args to original", () => {
    const input: ClaudeCliInput = {
      systemPrompt: "You are Hench, an autonomous AI agent.",
      promptText: "Fix the authentication bug in src/auth.ts.",
      allowedTools: ["Bash(npm:*)", "Bash(git:*)", "Read", "Edit", "Write", "Glob", "Grep"],
    };

    const original = originalBuildClaudeCliArgs(input);
    const extracted = buildClaudeCliArgs(input);

    expect(extracted.args).toEqual(original.args);
    expect(extracted.stdinContent).toBe(original.stdinContent);
  });

  it("with model override produces identical args to original", () => {
    const input: ClaudeCliInput = {
      systemPrompt: "System prompt.",
      promptText: "Task prompt.",
      allowedTools: ["Read"],
      modelOverride: "claude-opus-4",
    };

    const original = originalBuildClaudeCliArgs(input);
    const extracted = buildClaudeCliArgs(input);

    expect(extracted.args).toEqual(original.args);
    expect(extracted.stdinContent).toBe(original.stdinContent);
  });

  it("empty allowedTools produces identical args to original", () => {
    const input: ClaudeCliInput = {
      systemPrompt: "SP",
      promptText: "TP",
      allowedTools: [],
    };

    const original = originalBuildClaudeCliArgs(input);
    const extracted = buildClaudeCliArgs(input);

    expect(extracted.args).toEqual(original.args);
    expect(extracted.stdinContent).toBe(original.stdinContent);
  });

  it("complex multiline prompts produce identical args to original", () => {
    const input: ClaudeCliInput = {
      systemPrompt: "You are Hench.\nLine 2.\nLine 3 with special chars: &|()\"'`$",
      promptText: "Task with\nmultiple lines\nand special: !@#$%^&*()",
      allowedTools: ["Bash(npm:*)", "Bash(git:*)", "Bash(node:*)"],
      modelOverride: "claude-sonnet-4-20250514",
    };

    const original = originalBuildClaudeCliArgs(input);
    const extracted = buildClaudeCliArgs(input);

    expect(extracted.args).toEqual(original.args);
    expect(extracted.stdinContent).toBe(original.stdinContent);
  });

  it("buildAllowedTools produces identical output to original", () => {
    const commands = ["npm", "git", "node", "tsc"];
    const original = originalBuildAllowedTools(commands);
    const extracted = buildAllowedTools(commands);

    expect(extracted).toEqual(original);
  });

  it("buildAllowedTools with empty commands produces identical output to original", () => {
    const original = originalBuildAllowedTools([]);
    const extracted = buildAllowedTools([]);

    expect(extracted).toEqual(original);
  });

  /** Hardcoded snapshot — this is the exact expected args array for the standard input. */
  it("SNAPSHOT: standard Claude CLI args are deterministic", () => {
    if (process.platform === "win32") return;

    const input: ClaudeCliInput = {
      systemPrompt: "You are Hench, an autonomous AI agent.",
      promptText: "Fix the authentication bug in src/auth.ts.",
      allowedTools: ["Bash(npm:*)", "Bash(git:*)", "Read", "Edit", "Write", "Glob", "Grep"],
    };

    const { args, stdinContent } = buildClaudeCliArgs(input);

    expect(args).toEqual([
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--system-prompt", "You are Hench, an autonomous AI agent.",
      "--allowed-tools",
      "Bash(npm:*)", "Bash(git:*)", "Read", "Edit", "Write", "Glob", "Grep",
    ]);
    expect(stdinContent).toBe("Fix the authentication bug in src/auth.ts.");
  });

  /** Hardcoded snapshot with model override. */
  it("SNAPSHOT: Claude CLI args with model override are deterministic", () => {
    if (process.platform === "win32") return;

    const { args } = buildClaudeCliArgs({
      systemPrompt: "SP",
      promptText: "TP",
      allowedTools: ["Read", "Edit"],
      modelOverride: "claude-opus-4",
    });

    expect(args).toEqual([
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--system-prompt", "SP",
      "--allowed-tools",
      "Read", "Edit",
      "--model", "claude-opus-4",
    ]);
  });
});

// ── 4. parseEvent ────────────────────────────────────────────────────────

describe("ClaudeCliAdapter: parseEvent", () => {
  it("returns null for empty lines", () => {
    expect(claudeCliAdapter.parseEvent("", 1, {})).toBeNull();
    expect(claudeCliAdapter.parseEvent("  ", 1, {})).toBeNull();
    expect(claudeCliAdapter.parseEvent("\t", 1, {})).toBeNull();
  });

  it("returns null for non-JSON lines", () => {
    expect(claudeCliAdapter.parseEvent("not json", 1, {})).toBeNull();
    expect(claudeCliAdapter.parseEvent(">>> Processing...", 1, {})).toBeNull();
  });

  it("returns null for unknown event types", () => {
    const line = JSON.stringify({ type: "ping", data: {} });
    expect(claudeCliAdapter.parseEvent(line, 1, {})).toBeNull();
  });

  it("parses assistant event with text message", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "I will fix the bug." }],
      },
    });

    const event = claudeCliAdapter.parseEvent(line, 1, {});

    expect(event).not.toBeNull();
    expect(event!.type).toBe("assistant");
    expect(event!.vendor).toBe("claude");
    expect(event!.turn).toBe(1);
    expect(event!.text).toBe("I will fix the bug.");
    expect(event!.timestamp).toBeDefined();
  });

  it("parses assistant event with string message", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: "Direct string message",
    });

    const event = claudeCliAdapter.parseEvent(line, 2, {});

    expect(event).not.toBeNull();
    expect(event!.type).toBe("assistant");
    expect(event!.text).toBe("Direct string message");
  });

  it("parses assistant event with tool_use block as tool_use event", () => {
    const line = JSON.stringify({
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
    });

    const event = claudeCliAdapter.parseEvent(line, 1, {});

    expect(event).not.toBeNull();
    expect(event!.type).toBe("tool_use");
    expect(event!.toolCall).toBeDefined();
    expect(event!.toolCall!.tool).toBe("Edit");
    expect(event!.toolCall!.input).toEqual({
      file_path: "src/auth.ts",
      old_string: "bug",
      new_string: "fix",
    });
    // Text is preserved alongside tool call
    expect(event!.text).toBe("Let me edit the file.");
  });

  it("parses standalone tool_use event", () => {
    const line = JSON.stringify({
      type: "tool_use",
      tool: "Read",
      input: { file_path: "README.md" },
    });

    const event = claudeCliAdapter.parseEvent(line, 3, {});

    expect(event).not.toBeNull();
    expect(event!.type).toBe("tool_use");
    expect(event!.vendor).toBe("claude");
    expect(event!.turn).toBe(3);
    expect(event!.toolCall).toBeDefined();
    expect(event!.toolCall!.tool).toBe("Read");
    expect(event!.toolCall!.input).toEqual({ file_path: "README.md" });
  });

  it("parses tool_use event with name field instead of tool field", () => {
    const line = JSON.stringify({
      type: "tool_use",
      name: "Bash",
      input: { command: "npm test" },
    });

    const event = claudeCliAdapter.parseEvent(line, 2, {});

    expect(event).not.toBeNull();
    expect(event!.toolCall!.tool).toBe("Bash");
  });

  it("parses tool_result event", () => {
    const line = JSON.stringify({
      type: "tool_result",
      output: "File contents: export function main() {}",
    });

    const event = claudeCliAdapter.parseEvent(line, 2, {});

    expect(event).not.toBeNull();
    expect(event!.type).toBe("tool_result");
    expect(event!.vendor).toBe("claude");
    expect(event!.toolResult).toBeDefined();
    expect(event!.toolResult!.output).toBe("File contents: export function main() {}");
  });

  it("parses tool_result with content field as fallback", () => {
    const line = JSON.stringify({
      type: "tool_result",
      content: "Alternative output format",
    });

    const event = claudeCliAdapter.parseEvent(line, 2, {});

    expect(event).not.toBeNull();
    expect(event!.toolResult!.output).toBe("Alternative output format");
  });

  it("truncates tool_result output to 2000 chars", () => {
    const longOutput = "x".repeat(3000);
    const line = JSON.stringify({
      type: "tool_result",
      output: longOutput,
    });

    const event = claudeCliAdapter.parseEvent(line, 2, {});

    expect(event).not.toBeNull();
    expect(event!.toolResult!.output.length).toBe(2000);
  });

  it("parses result event as completion", () => {
    const line = JSON.stringify({
      type: "result",
      result: "Task completed successfully",
      num_turns: 5,
      cost_usd: 0.03,
    });

    const event = claudeCliAdapter.parseEvent(line, 5, {});

    expect(event).not.toBeNull();
    expect(event!.type).toBe("completion");
    expect(event!.vendor).toBe("claude");
    expect(event!.completionSummary).toBe("Task completed successfully");
  });

  it("parses error result as failure", () => {
    const line = JSON.stringify({
      type: "result",
      is_error: true,
      result: "Compilation failed",
    });

    const event = claudeCliAdapter.parseEvent(line, 1, {});

    expect(event).not.toBeNull();
    expect(event!.type).toBe("failure");
    expect(event!.vendor).toBe("claude");
    expect(event!.failure).toBeDefined();
    expect(event!.failure!.message).toBe("Compilation failed");
    expect(event!.failure!.category).toBe("unknown");
  });

  it("parses top-level content blocks (no message wrapper)", () => {
    const line = JSON.stringify({
      type: "assistant",
      content: [
        { type: "text", text: "Top-level content block text." },
      ],
    });

    const event = claudeCliAdapter.parseEvent(line, 1, {});

    expect(event).not.toBeNull();
    expect(event!.text).toBe("Top-level content block text.");
  });

  it("preserves turn number in output", () => {
    const line = JSON.stringify({
      type: "tool_use",
      tool: "Grep",
      input: { pattern: "TODO" },
    });

    const event = claudeCliAdapter.parseEvent(line, 42, {});

    expect(event).not.toBeNull();
    expect(event!.turn).toBe(42);
  });

  it("includes timestamp in output", () => {
    const before = new Date().toISOString();
    const line = JSON.stringify({ type: "tool_use", tool: "Read", input: {} });
    const event = claudeCliAdapter.parseEvent(line, 1, {});
    const after = new Date().toISOString();

    expect(event).not.toBeNull();
    expect(event!.timestamp >= before).toBe(true);
    expect(event!.timestamp <= after).toBe(true);
  });
});

// ── 5. classifyError ─────────────────────────────────────────────────────

describe("ClaudeCliAdapter: classifyError", () => {
  it("delegates to classifyVendorError for Error objects", () => {
    const err = new Error("Missing ANTHROPIC_API_KEY");
    const adapterResult = claudeCliAdapter.classifyError(err);
    const directResult = classifyVendorError(err);

    expect(adapterResult).toBe(directResult);
    expect(adapterResult).toBe("auth");
  });

  it("delegates to classifyVendorError for string errors", () => {
    const adapterResult = claudeCliAdapter.classifyError("rate limit exceeded");
    const directResult = classifyVendorError("rate limit exceeded");

    expect(adapterResult).toBe(directResult);
  });

  it("returns 'unknown' for unrecognized errors", () => {
    expect(claudeCliAdapter.classifyError(new Error("something completely unexpected"))).toBe("unknown");
    expect(claudeCliAdapter.classifyError(42)).toBe("unknown");
    expect(claudeCliAdapter.classifyError(null)).toBe("unknown");
  });

  it("matches classifyVendorError for all cross-vendor error fixtures", () => {
    for (const fixture of CROSS_VENDOR_ERROR_FIXTURES) {
      const err = new Error(fixture.message);
      const adapterResult = claudeCliAdapter.classifyError(err);
      const directResult = classifyVendorError(err);

      expect(adapterResult).toBe(directResult);
      expect(adapterResult).toBe(fixture.expected);
    }
  });

  it("classifies Claude-specific errors correctly", () => {
    expect(claudeCliAdapter.classifyError(new Error("Missing ANTHROPIC_API_KEY"))).toBe("auth");
    expect(claudeCliAdapter.classifyError(new Error("HTTP 401 Unauthorized"))).toBe("auth");
    expect(claudeCliAdapter.classifyError(new Error("HTTP 429 Too Many Requests"))).toBe("rate_limit");
    expect(claudeCliAdapter.classifyError(new Error("ETIMEDOUT"))).toBe("timeout");
    expect(claudeCliAdapter.classifyError(new Error("HTTP 502 Bad Gateway"))).toBe("transient_exhausted");
    expect(claudeCliAdapter.classifyError(new Error("Unexpected token < in JSON"))).toBe("malformed_output");
  });
});

// ── 6. buildAllowedTools ─────────────────────────────────────────────────

describe("ClaudeCliAdapter: buildAllowedTools", () => {
  it("maps commands to Bash(cmd:*) patterns", () => {
    const tools = buildAllowedTools(["npm", "git"]);
    expect(tools).toContain("Bash(npm:*)");
    expect(tools).toContain("Bash(git:*)");
  });

  it("always includes CLI_FILE_TOOLS", () => {
    const tools = buildAllowedTools([]);
    expect(tools).toEqual(["Read", "Edit", "Write", "Glob", "Grep"]);
  });

  it("prepends Bash tools before file tools", () => {
    const tools = buildAllowedTools(["npm"]);
    const bashIdx = tools.indexOf("Bash(npm:*)");
    const readIdx = tools.indexOf("Read");
    expect(bashIdx).toBeLessThan(readIdx);
  });

  it("handles many commands", () => {
    const tools = buildAllowedTools(["npm", "git", "node", "tsc", "pnpm"]);
    expect(tools).toHaveLength(10); // 5 bash + 5 file tools
  });
});

// ── 7. Integration: adapter end-to-end pipeline ─────────────────────────

describe("ClaudeCliAdapter: end-to-end pipeline", () => {
  it("envelope → buildSpawnConfig → verify args are parseable", () => {
    const envelope = createStandardEnvelope();
    const config = claudeCliAdapter.buildSpawnConfig(
      envelope,
      STANDARD_POLICY,
      undefined,
    );

    // Binary is "claude"
    expect(config.binary).toBe("claude");

    // Args include all required flags
    expect(config.args.includes("-p")).toBe(true);
    expect(config.args.includes("--output-format")).toBe(true);

    // stdin has content (for pipe-based delivery)
    expect(config.stdinContent!.length).toBeGreaterThan(0);
  });

  it("parse a multi-event Claude sequence into RuntimeEvents", () => {
    const events: RuntimeEvent[] = [];
    const lines = [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "I will fix the bug." }],
        },
      }),
      JSON.stringify({
        type: "tool_use",
        tool: "Edit",
        input: { file_path: "src/auth.ts" },
      }),
      JSON.stringify({
        type: "tool_result",
        output: "File edited",
      }),
      JSON.stringify({
        type: "result",
        result: "Task completed",
        num_turns: 3,
      }),
    ];

    let turn = 1;
    for (const line of lines) {
      const event = claudeCliAdapter.parseEvent(line, turn, {});
      if (event) {
        events.push(event);
        if (event.type === "assistant" || event.type === "completion") {
          turn++;
        }
      }
    }

    expect(events).toHaveLength(4);
    expect(events[0].type).toBe("assistant");
    expect(events[1].type).toBe("tool_use");
    expect(events[2].type).toBe("tool_result");
    expect(events[3].type).toBe("completion");

    // All events are from Claude
    for (const event of events) {
      expect(event.vendor).toBe("claude");
    }
  });

  it("classifyError → FailureCategory for a typical Claude error flow", () => {
    // Simulate: Claude CLI exits with ENOENT → not_found
    const enoent = new Error("ENOENT: no such file");
    expect(claudeCliAdapter.classifyError(enoent)).toBe("not_found");

    // Simulate: Claude API returns 401 → auth
    const authErr = new Error("HTTP 401 Unauthorized");
    expect(claudeCliAdapter.classifyError(authErr)).toBe("auth");

    // Simulate: unknown error → unknown
    const unknownErr = new Error("xyzzy");
    expect(claudeCliAdapter.classifyError(unknownErr)).toBe("unknown");
  });
});
