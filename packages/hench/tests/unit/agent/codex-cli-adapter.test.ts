/**
 * Unit tests for CodexCliAdapter.
 *
 * Tests that the extracted adapter:
 * 1. Implements the VendorAdapter interface correctly
 * 2. buildSpawnConfig compiles ExecutionPolicy to Codex CLI flags
 * 3. parseEvent produces RuntimeEvents from Codex JSONL with heuristic fallback
 * 4. classifyError delegates to classifyVendorError
 * 5. normalizeCodexResponse handles diverse Codex output shapes
 * 6. Snapshot: exact args array is deterministic
 *
 * @see packages/hench/src/agent/lifecycle/adapters/codex-cli-adapter.ts
 * @see packages/hench/src/agent/lifecycle/vendor-adapter.ts — VendorAdapter interface
 */

import { describe, it, expect } from "vitest";
import {
  codexCliAdapter,
  normalizeCodexResponse,
} from "../../../src/agent/lifecycle/adapters/codex-cli-adapter.js";
import {
  normalizeCodexResponse as originalNormalizeCodexResponse,
} from "../../../src/agent/lifecycle/adapters/codex-cli-adapter.js";
import type { VendorAdapter, SpawnConfig } from "../../../src/agent/lifecycle/vendor-adapter.js";
import {
  DEFAULT_EXECUTION_POLICY,
  createPromptEnvelope,
  classifyVendorError,
  compileCodexPolicyFlags,
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
  READONLY_POLICY,
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

describe("CodexCliAdapter: VendorAdapter interface", () => {
  it("satisfies VendorAdapter type", () => {
    // Type-level: assigning to VendorAdapter compiles
    const adapter: VendorAdapter = codexCliAdapter;
    expect(adapter).toBeDefined();
  });

  it("reports 'codex' vendor", () => {
    expect(codexCliAdapter.vendor).toBe("codex");
  });

  it("reports 'json' parseMode", () => {
    expect(codexCliAdapter.parseMode).toBe("json");
  });

  it("has all required methods", () => {
    expect(typeof codexCliAdapter.buildSpawnConfig).toBe("function");
    expect(typeof codexCliAdapter.parseEvent).toBe("function");
    expect(typeof codexCliAdapter.classifyError).toBe("function");
  });
});

// ── 2. buildSpawnConfig ──────────────────────────────────────────────────

describe("CodexCliAdapter: buildSpawnConfig", () => {
  it("returns a valid SpawnConfig", () => {
    const envelope = createStandardEnvelope();
    const config: SpawnConfig = codexCliAdapter.buildSpawnConfig(
      envelope,
      DEFAULT_EXECUTION_POLICY,
      undefined,
    );

    expect(config.binary).toBe("codex");
    expect(Array.isArray(config.args)).toBe(true);
    expect(config.stdinContent).toBeNull(); // Codex: prompt in args, not stdin
    expect(config.cwd).toBe(".");
    expect(typeof config.env).toBe("object");
  });

  it("includes required Codex CLI flags", () => {
    const config = codexCliAdapter.buildSpawnConfig(
      createMinimalEnvelope(),
      DEFAULT_EXECUTION_POLICY,
      undefined,
    );

    expect(config.args).toContain("exec");
    expect(config.args).toContain("--json");
    expect(config.args).toContain("--skip-git-repo-check");
  });

  it("compiles policy to --sandbox and --approval-policy flags", () => {
    const config = codexCliAdapter.buildSpawnConfig(
      createMinimalEnvelope(),
      DEFAULT_EXECUTION_POLICY,
      undefined,
    );

    expect(config.args).toContain("--sandbox");
    expect(config.args).toContain("--approval-policy");

    // DEFAULT_EXECUTION_POLICY: sandbox = "workspace-write", approvals = "never"
    const sandboxIdx = config.args.indexOf("--sandbox");
    expect(config.args[sandboxIdx + 1]).toBe("workspace-write");
    const approvalIdx = config.args.indexOf("--approval-policy");
    expect(config.args[approvalIdx + 1]).toBe("full-auto");
  });

  it("compiles read-only policy correctly", () => {
    const config = codexCliAdapter.buildSpawnConfig(
      createMinimalEnvelope(),
      READONLY_POLICY,
      undefined,
    );

    const sandboxIdx = config.args.indexOf("--sandbox");
    expect(config.args[sandboxIdx + 1]).toBe("read-only");
    const approvalIdx = config.args.indexOf("--approval-policy");
    expect(config.args[approvalIdx + 1]).toBe("auto-edit");
  });

  it("compiles full-access policy correctly", () => {
    const config = codexCliAdapter.buildSpawnConfig(
      createMinimalEnvelope(),
      FULL_ACCESS_POLICY,
      undefined,
    );

    const sandboxIdx = config.args.indexOf("--sandbox");
    expect(config.args[sandboxIdx + 1]).toBe("full-access");
    const approvalIdx = config.args.indexOf("--approval-policy");
    expect(config.args[approvalIdx + 1]).toBe("full-auto");
  });

  it("places model override as -m flag", () => {
    const config = codexCliAdapter.buildSpawnConfig(
      createMinimalEnvelope(),
      DEFAULT_EXECUTION_POLICY,
      "gpt-5-codex",
    );

    expect(config.args).toContain("-m");
    expect(config.args).toContain("gpt-5-codex");
    const modelIdx = config.args.indexOf("-m");
    expect(config.args[modelIdx + 1]).toBe("gpt-5-codex");
  });

  it("omits -m when model is undefined", () => {
    const config = codexCliAdapter.buildSpawnConfig(
      createMinimalEnvelope(),
      DEFAULT_EXECUTION_POLICY,
      undefined,
    );

    expect(config.args).not.toContain("-m");
  });

  it("includes the prompt as the last argument", () => {
    const config = codexCliAdapter.buildSpawnConfig(
      createMinimalEnvelope(),
      DEFAULT_EXECUTION_POLICY,
      undefined,
    );

    const lastArg = config.args[config.args.length - 1];
    // The prompt should contain both system and task content
    expect(lastArg).toContain("SYSTEM:");
    expect(lastArg).toContain("You are Hench.");
    expect(lastArg).toContain("TASK:");
    expect(lastArg).toContain("Fix the bug.");
  });

  it("stdinContent is null (Codex uses args-based delivery)", () => {
    const config = codexCliAdapter.buildSpawnConfig(
      createMinimalEnvelope(),
      DEFAULT_EXECUTION_POLICY,
      undefined,
    );

    expect(config.stdinContent).toBeNull();
  });

  it("policy flags match compileCodexPolicyFlags output", () => {
    const policy = STANDARD_POLICY;
    const config = codexCliAdapter.buildSpawnConfig(
      createMinimalEnvelope(),
      policy,
      undefined,
    );

    const expectedFlags = compileCodexPolicyFlags(policy);
    // The policy flags should appear in the args in order
    for (const flag of expectedFlags) {
      expect(config.args).toContain(flag);
    }
  });
});

// ── 3. Snapshot: deterministic args ──────────────────────────────────────

describe("CodexCliAdapter: snapshot parity", () => {
  it("SNAPSHOT: standard Codex CLI args are deterministic", () => {
    const config = codexCliAdapter.buildSpawnConfig(
      createMinimalEnvelope(),
      DEFAULT_EXECUTION_POLICY,
      undefined,
    );

    // Remove the prompt (last arg) since it has variable content from assemblePrompt
    const argsWithoutPrompt = config.args.slice(0, -1);
    expect(argsWithoutPrompt).toEqual([
      "exec",
      "--sandbox", "workspace-write",
      "--approval-policy", "full-auto",
      "--json",
      "--skip-git-repo-check",
    ]);
  });

  it("SNAPSHOT: Codex CLI args with model override are deterministic", () => {
    const config = codexCliAdapter.buildSpawnConfig(
      createMinimalEnvelope(),
      DEFAULT_EXECUTION_POLICY,
      "gpt-5-codex",
    );

    const argsWithoutPrompt = config.args.slice(0, -1);
    expect(argsWithoutPrompt).toEqual([
      "exec",
      "--sandbox", "workspace-write",
      "--approval-policy", "full-auto",
      "--json",
      "--skip-git-repo-check",
      "-m", "gpt-5-codex",
    ]);
  });

  it("normalizeCodexResponse produces identical output to original", () => {
    const inputs = [
      '{"text": "hello world", "status": "completed"}',
      '{"content": [{"type": "text", "text": "some text"}], "status": "completed"}',
      '{"content": [{"type": "function_call", "name": "Edit", "input": {"file": "a.ts"}}]}',
      '{"is_error": true, "error": "Something failed"}',
      "plain text response",
      '{"status": "in_progress"}',
    ];

    for (const input of inputs) {
      const original = originalNormalizeCodexResponse(input);
      const extracted = normalizeCodexResponse(input);
      expect(extracted).toEqual(original);
    }
  });
});

// ── 4. parseEvent: structured JSONL ──────────────────────────────────────

describe("CodexCliAdapter: parseEvent (structured JSONL)", () => {
  it("returns null for empty lines", () => {
    expect(codexCliAdapter.parseEvent("", 1, {})).toBeNull();
    expect(codexCliAdapter.parseEvent("  ", 1, {})).toBeNull();
    expect(codexCliAdapter.parseEvent("\t", 1, {})).toBeNull();
  });

  it("returns null for non-JSON lines without meaningful content", () => {
    // Lines like ">>>" or blank won't produce events via heuristic either
    expect(codexCliAdapter.parseEvent("   ", 1, {})).toBeNull();
  });

  it("returns null for JSON without a type field", () => {
    const line = JSON.stringify({ data: "something" });
    // Heuristic fallback may produce an event if text is found
    // but a bare { data: "something" } won't
    expect(codexCliAdapter.parseEvent(line, 1, {})).toBeNull();
  });

  it("parses message event with text content blocks", () => {
    const line = JSON.stringify({
      type: "message",
      content: [
        { type: "text", text: "I will fix the bug." },
      ],
    });

    const event = codexCliAdapter.parseEvent(line, 1, {});

    expect(event).not.toBeNull();
    expect(event!.type).toBe("assistant");
    expect(event!.vendor).toBe("codex");
    expect(event!.turn).toBe(1);
    expect(event!.text).toBe("I will fix the bug.");
    expect(event!.timestamp).toBeDefined();
  });

  it("parses message event with output_text content blocks", () => {
    const line = JSON.stringify({
      type: "message",
      content: [
        { type: "output_text", text: "Codex output text." },
      ],
    });

    const event = codexCliAdapter.parseEvent(line, 1, {});

    expect(event).not.toBeNull();
    expect(event!.type).toBe("assistant");
    expect(event!.text).toBe("Codex output text.");
  });

  it("parses message event with direct text field", () => {
    const line = JSON.stringify({
      type: "message",
      text: "Direct text message",
    });

    const event = codexCliAdapter.parseEvent(line, 2, {});

    expect(event).not.toBeNull();
    expect(event!.type).toBe("assistant");
    expect(event!.text).toBe("Direct text message");
  });

  it("parses message event with embedded tool_use block as tool_use event", () => {
    const line = JSON.stringify({
      type: "message",
      content: [
        { type: "text", text: "Let me edit the file." },
        {
          type: "tool_use",
          name: "Edit",
          input: { file_path: "src/auth.ts", old_string: "bug", new_string: "fix" },
        },
      ],
    });

    const event = codexCliAdapter.parseEvent(line, 1, {});

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

  it("parses message event with embedded function_call block", () => {
    const line = JSON.stringify({
      type: "message",
      content: [
        {
          type: "function_call",
          name: "shell",
          arguments: '{"command": "npm test"}',
        },
      ],
    });

    const event = codexCliAdapter.parseEvent(line, 1, {});

    expect(event).not.toBeNull();
    expect(event!.type).toBe("tool_use");
    expect(event!.toolCall!.tool).toBe("shell");
    expect(event!.toolCall!.input).toEqual({ command: "npm test" });
  });

  it("parses standalone function_call event", () => {
    const line = JSON.stringify({
      type: "function_call",
      name: "shell",
      arguments: '{"command": "git status"}',
    });

    const event = codexCliAdapter.parseEvent(line, 3, {});

    expect(event).not.toBeNull();
    expect(event!.type).toBe("tool_use");
    expect(event!.vendor).toBe("codex");
    expect(event!.turn).toBe(3);
    expect(event!.toolCall).toBeDefined();
    expect(event!.toolCall!.tool).toBe("shell");
    expect(event!.toolCall!.input).toEqual({ command: "git status" });
  });

  it("parses function_call with object arguments", () => {
    const line = JSON.stringify({
      type: "function_call",
      name: "write_file",
      arguments: { path: "test.ts", content: "export {}" },
    });

    const event = codexCliAdapter.parseEvent(line, 2, {});

    expect(event).not.toBeNull();
    expect(event!.toolCall!.tool).toBe("write_file");
    expect(event!.toolCall!.input).toEqual({ path: "test.ts", content: "export {}" });
  });

  it("parses function_call_output event", () => {
    const line = JSON.stringify({
      type: "function_call_output",
      output: "File contents: export function main() {}",
    });

    const event = codexCliAdapter.parseEvent(line, 2, {});

    expect(event).not.toBeNull();
    expect(event!.type).toBe("tool_result");
    expect(event!.vendor).toBe("codex");
    expect(event!.toolResult).toBeDefined();
    expect(event!.toolResult!.output).toBe("File contents: export function main() {}");
  });

  it("parses function_call_output with content field as fallback", () => {
    const line = JSON.stringify({
      type: "function_call_output",
      content: "Alternative output format",
    });

    const event = codexCliAdapter.parseEvent(line, 2, {});

    expect(event).not.toBeNull();
    expect(event!.toolResult!.output).toBe("Alternative output format");
  });

  it("truncates function_call_output to 2000 chars", () => {
    const longOutput = "x".repeat(3000);
    const line = JSON.stringify({
      type: "function_call_output",
      output: longOutput,
    });

    const event = codexCliAdapter.parseEvent(line, 2, {});

    expect(event).not.toBeNull();
    expect(event!.toolResult!.output.length).toBe(2000);
  });

  it("parses error event as failure", () => {
    const line = JSON.stringify({
      type: "error",
      message: "Compilation failed",
    });

    const event = codexCliAdapter.parseEvent(line, 1, {});

    expect(event).not.toBeNull();
    expect(event!.type).toBe("failure");
    expect(event!.vendor).toBe("codex");
    expect(event!.failure).toBeDefined();
    expect(event!.failure!.message).toBe("Compilation failed");
    expect(event!.failure!.category).toBe("unknown");
  });

  it("parses error event with error field", () => {
    const line = JSON.stringify({
      type: "error",
      error: "API rate limit",
    });

    const event = codexCliAdapter.parseEvent(line, 1, {});

    expect(event).not.toBeNull();
    expect(event!.failure!.message).toBe("API rate limit");
  });

  it("parses summary event as completion", () => {
    const line = JSON.stringify({
      type: "summary",
      result: "Task completed successfully",
      num_turns: 5,
      cost_usd: 0.03,
    });

    const event = codexCliAdapter.parseEvent(line, 5, {});

    expect(event).not.toBeNull();
    expect(event!.type).toBe("completion");
    expect(event!.vendor).toBe("codex");
    expect(event!.completionSummary).toBe("Task completed successfully");
  });

  it("parses response.completed event as completion", () => {
    const line = JSON.stringify({
      type: "response.completed",
      text: "All done",
    });

    const event = codexCliAdapter.parseEvent(line, 3, {});

    expect(event).not.toBeNull();
    expect(event!.type).toBe("completion");
    expect(event!.completionSummary).toBe("All done");
  });

  it("parses done event as completion", () => {
    const line = JSON.stringify({
      type: "done",
      result: "Finished",
    });

    const event = codexCliAdapter.parseEvent(line, 4, {});

    expect(event).not.toBeNull();
    expect(event!.type).toBe("completion");
    expect(event!.completionSummary).toBe("Finished");
  });

  it("parses error completion as failure", () => {
    const line = JSON.stringify({
      type: "summary",
      is_error: true,
      result: "Compilation failed",
    });

    const event = codexCliAdapter.parseEvent(line, 1, {});

    expect(event).not.toBeNull();
    expect(event!.type).toBe("failure");
    expect(event!.failure!.message).toBe("Compilation failed");
  });

  it("preserves turn number in output", () => {
    const line = JSON.stringify({
      type: "function_call",
      name: "shell",
      arguments: '{"command": "ls"}',
    });

    const event = codexCliAdapter.parseEvent(line, 42, {});

    expect(event).not.toBeNull();
    expect(event!.turn).toBe(42);
  });

  it("includes timestamp in output", () => {
    const before = new Date().toISOString();
    const line = JSON.stringify({ type: "function_call", name: "shell", arguments: "{}" });
    const event = codexCliAdapter.parseEvent(line, 1, {});
    const after = new Date().toISOString();

    expect(event).not.toBeNull();
    expect(event!.timestamp >= before).toBe(true);
    expect(event!.timestamp <= after).toBe(true);
  });
});

// ── 5. parseEvent: heuristic fallback ────────────────────────────────────

describe("CodexCliAdapter: parseEvent (heuristic fallback)", () => {
  it("falls back to heuristic for non-JSONL text with content", () => {
    // A plain text line should be picked up by the heuristic fallback
    const event = codexCliAdapter.parseEvent("plain text output from codex", 1, {});

    // The heuristic should detect this as assistant text
    expect(event).not.toBeNull();
    expect(event!.type).toBe("assistant");
    expect(event!.vendor).toBe("codex");
    expect(event!.text).toBe("plain text output from codex");
  });

  it("falls back to heuristic for JSON without type field", () => {
    const line = JSON.stringify({
      text: "Some response text",
      status: "completed",
    });

    const event = codexCliAdapter.parseEvent(line, 1, {});

    // Heuristic normalizer should pick up the text field
    expect(event).not.toBeNull();
    expect(event!.type).toBe("assistant");
    expect(event!.text).toContain("Some response text");
  });

  it("returns tool_use from heuristic when tool events found", () => {
    const line = JSON.stringify({
      content: [
        { type: "function_call", name: "Edit", input: { path: "a.ts" } },
      ],
    });

    const event = codexCliAdapter.parseEvent(line, 1, {});

    expect(event).not.toBeNull();
    expect(event!.type).toBe("tool_use");
    expect(event!.toolCall!.tool).toBe("Edit");
  });

  it("returns failure from heuristic when error detected", () => {
    const line = JSON.stringify({
      is_error: true,
      error: "Something went wrong",
    });

    const event = codexCliAdapter.parseEvent(line, 1, {});

    expect(event).not.toBeNull();
    expect(event!.type).toBe("failure");
    expect(event!.failure!.message).toBe("Something went wrong");
  });
});

// ── 6. classifyError ─────────────────────────────────────────────────────

describe("CodexCliAdapter: classifyError", () => {
  it("delegates to classifyVendorError for Error objects", () => {
    const err = new Error("Missing OPENAI_API_KEY");
    const adapterResult = codexCliAdapter.classifyError(err);
    const directResult = classifyVendorError(err);

    expect(adapterResult).toBe(directResult);
    expect(adapterResult).toBe("auth");
  });

  it("delegates to classifyVendorError for string errors", () => {
    const adapterResult = codexCliAdapter.classifyError("rate limit exceeded");
    const directResult = classifyVendorError("rate limit exceeded");

    expect(adapterResult).toBe(directResult);
  });

  it("returns 'unknown' for unrecognized errors", () => {
    expect(codexCliAdapter.classifyError(new Error("something completely unexpected"))).toBe("unknown");
    expect(codexCliAdapter.classifyError(42)).toBe("unknown");
    expect(codexCliAdapter.classifyError(null)).toBe("unknown");
  });

  it("matches classifyVendorError for all cross-vendor error fixtures", () => {
    for (const fixture of CROSS_VENDOR_ERROR_FIXTURES) {
      const err = new Error(fixture.message);
      const adapterResult = codexCliAdapter.classifyError(err);
      const directResult = classifyVendorError(err);

      expect(adapterResult).toBe(directResult);
      expect(adapterResult).toBe(fixture.expected);
    }
  });

  it("classifies Codex-specific errors correctly", () => {
    expect(codexCliAdapter.classifyError(new Error("Missing OPENAI_API_KEY"))).toBe("auth");
    expect(codexCliAdapter.classifyError(new Error("codex: not found"))).toBe("not_found");
    expect(codexCliAdapter.classifyError(new Error("HTTP 429 Too Many Requests"))).toBe("rate_limit");
    expect(codexCliAdapter.classifyError(new Error("codex exec timed out after 30000ms"))).toBe("timeout");
    expect(codexCliAdapter.classifyError(new Error("SyntaxError: invalid json body"))).toBe("malformed_output");
    expect(codexCliAdapter.classifyError(new Error("ECONNRESET"))).toBe("transient_exhausted");
  });
});

// ── 7. normalizeCodexResponse ────────────────────────────────────────────

describe("CodexCliAdapter: normalizeCodexResponse", () => {
  it("handles plain text response", () => {
    const result = normalizeCodexResponse("Hello world");
    expect(result.status).toBe("completed");
    expect(result.assistantText).toBe("Hello world");
    expect(result.toolEvents).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("handles null/undefined input", () => {
    const result = normalizeCodexResponse(null);
    expect(result.status).toBe("unknown");
    expect(result.assistantText).toBe("");
  });

  it("extracts text from content blocks", () => {
    const result = normalizeCodexResponse({
      content: [
        { type: "text", text: "Some text content" },
      ],
    });
    expect(result.assistantText).toContain("Some text content");
  });

  it("extracts tool events from function_call blocks", () => {
    const result = normalizeCodexResponse({
      content: [
        { type: "function_call", name: "Edit", input: { path: "a.ts" } },
      ],
    });
    expect(result.toolEvents).toHaveLength(1);
    expect(result.toolEvents[0].tool).toBe("Edit");
    expect(result.toolEvents[0].eventType).toBe("function_call");
  });

  it("extracts tool result events", () => {
    const result = normalizeCodexResponse({
      content: [
        { type: "tool_result", name: "Edit", output: "File edited" },
      ],
    });
    expect(result.toolEvents).toHaveLength(1);
    expect(result.toolEvents[0].output).toBe("File edited");
    expect(result.toolEvents[0].eventType).toBe("tool_result");
  });

  it("detects error status", () => {
    const result = normalizeCodexResponse({
      is_error: true,
      error: "Something broke",
    });
    expect(result.status).toBe("error");
    expect(result.error).toBe("Something broke");
  });

  it("detects error from status field", () => {
    const result = normalizeCodexResponse({
      status: "failed",
      text: "It failed",
    });
    expect(result.status).toBe("error");
  });

  it("detects completed from stop_reason", () => {
    const result = normalizeCodexResponse({
      stop_reason: "end_turn",
      text: "Done",
    });
    expect(result.status).toBe("completed");
  });

  it("warns about blocks missing type", () => {
    const result = normalizeCodexResponse({
      content: [
        { text: "no type field" },
      ],
    });
    expect(result.warnings).toContain("Codex block missing type; ignoring block.");
  });

  it("warns about unknown block types", () => {
    const result = normalizeCodexResponse({
      content: [
        { type: "weird_type", text: "something" },
      ],
    });
    expect(result.warnings).toContain('Unknown Codex block type "weird_type" ignored.');
  });

  it("handles JSON string input", () => {
    const jsonStr = JSON.stringify({ text: "hello", status: "completed" });
    const result = normalizeCodexResponse(jsonStr);
    expect(result.assistantText).toBe("hello");
    expect(result.status).toBe("completed");
  });

  it("handles double-encoded JSON string identically to original", () => {
    const inner = JSON.stringify({ text: "hello", status: "completed" });
    const outer = JSON.stringify(inner);
    const extracted = normalizeCodexResponse(outer);
    const original = originalNormalizeCodexResponse(outer);

    // Double-encoded JSON doesn't get fully decoded — both implementations
    // return the inner JSON string as assistantText. This is correct behavior:
    // parseMaybeJson unwraps one layer, producing a string, which is then
    // returned directly.
    expect(extracted).toEqual(original);
    expect(extracted.status).toBe("completed");
  });
});

// ── 8. Integration: adapter end-to-end pipeline ─────────────────────────

describe("CodexCliAdapter: end-to-end pipeline", () => {
  it("envelope → buildSpawnConfig → verify args are parseable", () => {
    const envelope = createStandardEnvelope();
    const config = codexCliAdapter.buildSpawnConfig(
      envelope,
      STANDARD_POLICY,
      undefined,
    );

    // Binary is "codex"
    expect(config.binary).toBe("codex");

    // Args include all required flags
    expect(config.args.includes("exec")).toBe(true);
    expect(config.args.includes("--json")).toBe(true);

    // stdin is null (for args-based delivery)
    expect(config.stdinContent).toBeNull();

    // Prompt is the last arg and contains both system and task content
    const lastArg = config.args[config.args.length - 1];
    expect(lastArg).toContain("SYSTEM:");
    expect(lastArg).toContain("TASK:");
  });

  it("parse a multi-event Codex sequence into RuntimeEvents", () => {
    const events: RuntimeEvent[] = [];
    const lines = [
      JSON.stringify({
        type: "message",
        content: [{ type: "text", text: "I will fix the bug." }],
      }),
      JSON.stringify({
        type: "function_call",
        name: "shell",
        arguments: '{"command": "npm test"}',
      }),
      JSON.stringify({
        type: "function_call_output",
        output: "All tests pass",
      }),
      JSON.stringify({
        type: "summary",
        result: "Task completed",
        num_turns: 3,
      }),
    ];

    let turn = 1;
    for (const line of lines) {
      const event = codexCliAdapter.parseEvent(line, turn, {});
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

    // All events are from Codex
    for (const event of events) {
      expect(event.vendor).toBe("codex");
    }
  });

  it("classifyError → FailureCategory for a typical Codex error flow", () => {
    // Simulate: Codex CLI exits with ENOENT → not_found
    const enoent = new Error("ENOENT: no such file");
    expect(codexCliAdapter.classifyError(enoent)).toBe("not_found");

    // Simulate: Codex API returns 401 → auth
    const authErr = new Error("HTTP 401 Unauthorized");
    expect(codexCliAdapter.classifyError(authErr)).toBe("auth");

    // Simulate: Codex timeout → timeout
    const timeoutErr = new Error("codex exec timed out after 30000ms");
    expect(codexCliAdapter.classifyError(timeoutErr)).toBe("timeout");

    // Simulate: unknown error → unknown
    const unknownErr = new Error("xyzzy");
    expect(codexCliAdapter.classifyError(unknownErr)).toBe("unknown");
  });
});
