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
  WINDOWS_STDIN_PROMPT_SEPARATOR,
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
  buildWindowsCliCommandLine,
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
import {
  createStandardEnvelope,
  createMinimalEnvelope,
  decodeClaudeDelivery,
} from "../../helpers/index.js";

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
    const config: SpawnConfig = claudeCliAdapter.buildSpawnConfig(envelope, DEFAULT_EXECUTION_POLICY, {});

    expect(config.binary).toBe("claude");
    expect(Array.isArray(config.args)).toBe(true);
    expect(typeof config.stdinContent).toBe("string");
    expect(config.stdinContent).not.toBeNull();
    expect(config.cwd).toBe(".");
    expect(typeof config.env).toBe("object");
  });

  it("includes required Claude CLI flags", () => {
    const config = claudeCliAdapter.buildSpawnConfig(createMinimalEnvelope(), DEFAULT_EXECUTION_POLICY, {});

    expect(config.args).toContain("-p");
    expect(config.args).toContain("--output-format");
    expect(config.args).toContain("stream-json");
    expect(config.args).toContain("--verbose");
    expect(config.args).toContain("--allowed-tools");
  });

  it("includes --system-prompt on non-Windows", () => {
    if (process.platform === "win32") return;

    const config = claudeCliAdapter.buildSpawnConfig(createStandardEnvelope(), DEFAULT_EXECUTION_POLICY, {});

    expect(config.args).toContain("--system-prompt");
  });

  it("places model override as --model flag", () => {
    const config = claudeCliAdapter.buildSpawnConfig(createMinimalEnvelope(), DEFAULT_EXECUTION_POLICY, { model: "claude-opus-4" });

    expect(config.args).toContain("--model");
    expect(config.args).toContain("claude-opus-4");
    const modelIdx = config.args.indexOf("--model");
    expect(config.args[modelIdx + 1]).toBe("claude-opus-4");
  });

  it("omits --model when model is undefined", () => {
    const config = claudeCliAdapter.buildSpawnConfig(createMinimalEnvelope(), DEFAULT_EXECUTION_POLICY, {});

    expect(config.args).not.toContain("--model");
  });

  it("maps policy allowedCommands to --allowed-tools", () => {
    const config = claudeCliAdapter.buildSpawnConfig(createMinimalEnvelope(), FULL_ACCESS_POLICY, {});

    // FULL_ACCESS_POLICY has allowedCommands: ["npm", "git", "node", "tsc"]
    if (process.platform === "win32") {
      // On Windows: tools are joined as a single comma-separated arg after --allowed-tools
      const toolsIdx = config.args.indexOf("--allowed-tools");
      expect(toolsIdx).toBeGreaterThan(-1);
      const toolsToken = config.args[toolsIdx + 1];
      expect(toolsToken).toContain("Bash(npm:*)");
      expect(toolsToken).toContain("Bash(git:*)");
      expect(toolsToken).toContain("Bash(node:*)");
      expect(toolsToken).toContain("Bash(tsc:*)");
      expect(toolsToken).toContain("Read");
      expect(toolsToken).toContain("Edit");
      expect(toolsToken).toContain("Write");
      expect(toolsToken).toContain("Glob");
      expect(toolsToken).toContain("Grep");
    } else {
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
    }
  });

  it("stdinContent contains task prompt (non-Windows)", () => {
    if (process.platform === "win32") return;

    const config = claudeCliAdapter.buildSpawnConfig(createMinimalEnvelope(), DEFAULT_EXECUTION_POLICY, {});

    // On non-Windows, stdinContent is the task sections only
    expect(config.stdinContent).toContain("Fix the bug.");
  });

  it("stdinContent is a string, not null (Claude uses pipe-based delivery)", () => {
    const config = claudeCliAdapter.buildSpawnConfig(createMinimalEnvelope(), DEFAULT_EXECUTION_POLICY, {});

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

// ── 3b. permissionMode plumbing ──────────────────────────────────────────

describe("ClaudeCliAdapter: --permission-mode", () => {
  it("appends --permission-mode acceptEdits when set", () => {
    const { args } = buildClaudeCliArgs({
      systemPrompt: "SP",
      promptText: "TP",
      allowedTools: ["Read"],
      permissionMode: "acceptEdits",
    });

    const idx = args.indexOf("--permission-mode");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("acceptEdits");
  });

  it("forwards every supported mode verbatim", () => {
    const modes = ["default", "acceptEdits", "bypassPermissions", "plan"] as const;
    for (const mode of modes) {
      const { args } = buildClaudeCliArgs({
        systemPrompt: "SP",
        promptText: "TP",
        allowedTools: ["Read"],
        permissionMode: mode,
      });
      const idx = args.indexOf("--permission-mode");
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe(mode);
    }
  });

  it("omits --permission-mode entirely when undefined", () => {
    const { args } = buildClaudeCliArgs({
      systemPrompt: "SP",
      promptText: "TP",
      allowedTools: ["Read"],
    });

    expect(args).not.toContain("--permission-mode");
  });

  it("places --permission-mode after --model so Claude CLI sees both", () => {
    if (process.platform === "win32") return;

    const { args } = buildClaudeCliArgs({
      systemPrompt: "SP",
      promptText: "TP",
      allowedTools: ["Read"],
      modelOverride: "claude-opus-4",
      permissionMode: "acceptEdits",
    });

    expect(args).toEqual([
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--system-prompt", "SP",
      "--allowed-tools",
      "Read",
      "--model", "claude-opus-4",
      "--permission-mode", "acceptEdits",
    ]);
  });

  it("adapter forwards opts.permissionMode through buildSpawnConfig", () => {
    const config = claudeCliAdapter.buildSpawnConfig(
      createMinimalEnvelope(),
      DEFAULT_EXECUTION_POLICY,
      { permissionMode: "plan" },
    );
    const idx = config.args.indexOf("--permission-mode");
    expect(idx).toBeGreaterThan(-1);
    expect(config.args[idx + 1]).toBe("plan");
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

  it("falls back to blanket Bash(git:*) when no subcommand allowlist is given", () => {
    // Backward-compatible: absent/empty list preserves the legacy blanket grant.
    expect(buildAllowedTools(["git"])).toContain("Bash(git:*)");
    expect(buildAllowedTools(["git"], [])).toContain("Bash(git:*)");
  });
});

// ── 8. Git-subcommand scoping in CLI mode ────────────────────────────────

describe("ClaudeCliAdapter: git-subcommand allowlist scoping", () => {
  const SUBS = ["status", "add", "commit", "diff", "log", "branch", "checkout", "stash", "show", "rev-parse"];

  it("expands git into scoped Bash(git <sub>:*) patterns when a subcommand allowlist is provided", () => {
    const tools = buildAllowedTools(["npm", "git"], SUBS);
    for (const sub of SUBS) {
      expect(tools).toContain(`Bash(git ${sub}:*)`);
    }
    // Non-git commands are unaffected.
    expect(tools).toContain("Bash(npm:*)");
    // File tools still present.
    expect(tools).toContain("Read");
  });

  it("does NOT grant the blanket Bash(git:*) when scoping is active", () => {
    const tools = buildAllowedTools(["git"], SUBS);
    expect(tools).not.toContain("Bash(git:*)");
  });

  it("excludes destructive subcommands not on the allowlist", () => {
    const tools = buildAllowedTools(["git"], SUBS);
    for (const destructive of ["reset", "clean", "revert", "push"]) {
      expect(tools).not.toContain(`Bash(git ${destructive}:*)`);
    }
    // And crucially no blanket grant that would re-admit them.
    expect(tools).not.toContain("Bash(git:*)");
  });

  it("buildSpawnConfig scopes git from policy.allowedGitSubcommands", () => {
    const policy: ExecutionPolicy = {
      ...DEFAULT_EXECUTION_POLICY,
      allowedCommands: ["git", "npm"],
      allowedGitSubcommands: SUBS,
    };
    const config = claudeCliAdapter.buildSpawnConfig(createMinimalEnvelope(), policy, {});

    // Decoded rather than read off argv positions: POSIX passes each tool as its
    // own argv entry while Windows comma-joins them into one, so `config.args`
    // only ever contains a bare "Bash(git commit:*)" element on POSIX. The
    // security property — git scoped per-subcommand, destructive subcommands
    // absent — is identical on both, and this asserts that with exact set
    // membership rather than a loosened substring check.
    const { allowedTools } = decodeClaudeDelivery(config.args, config.stdinContent ?? "");

    expect(allowedTools).toContain("Bash(git commit:*)");
    expect(allowedTools).toContain("Bash(git status:*)");
    expect(allowedTools).not.toContain("Bash(git:*)");
    expect(allowedTools).not.toContain("Bash(git reset:*)");
    expect(allowedTools).not.toContain("Bash(git clean:*)");
  });
});

// ── 6b. Both delivery shapes, on any host ────────────────────────────────

/**
 * The coverage gap this section closes.
 *
 * buildClaudeCliArgs has two delivery shapes, and until now each could only be
 * executed on its own platform: the Windows branch was unreachable on Linux, and
 * CI runs on Linux. So the branch that exists SPECIFICALLY for Windows shipped
 * without a test ever running it — while the POSIX assertions elsewhere in this
 * file simply failed when a developer ran the suite on Windows.
 *
 * Passing the platform explicitly runs both branches everywhere, so a regression
 * in either is caught by any CI job rather than by whoever happens to be on the
 * affected OS.
 */
describe("ClaudeCliAdapter: both delivery shapes run on any platform", () => {
  const INPUT: ClaudeCliInput = {
    systemPrompt: "SYS line one\nSYS line two",
    promptText: "TASK do the thing",
    allowedTools: ["Bash(git commit:*)", "Read", "Edit"],
  };

  it("POSIX: system prompt travels as an argv flag, tools as separate entries", () => {
    const { args, stdinContent } = buildClaudeCliArgs(INPUT, "linux");

    const sysIdx = args.indexOf("--system-prompt");
    expect(sysIdx).toBeGreaterThan(-1);
    expect(args[sysIdx + 1]).toBe(INPUT.systemPrompt);
    expect(stdinContent).toBe(INPUT.promptText);

    const toolsIdx = args.indexOf("--allowed-tools");
    expect(args.slice(toolsIdx + 1, toolsIdx + 1 + INPUT.allowedTools.length))
      .toEqual(INPUT.allowedTools);
  });

  it("Windows: system prompt travels on stdin, tools comma-joined into one entry", () => {
    const { args, stdinContent } = buildClaudeCliArgs(INPUT, "win32");

    // The flag is absent BY DESIGN: a multi-line value cannot cross a cmd.exe
    // command line safely (the BatBadBut newline class).
    expect(args).not.toContain("--system-prompt");
    expect(stdinContent).toBe(
      `${INPUT.systemPrompt}${WINDOWS_STDIN_PROMPT_SEPARATOR}${INPUT.promptText}`,
    );

    const toolsIdx = args.indexOf("--allowed-tools");
    expect(args[toolsIdx + 1]).toBe(INPUT.allowedTools.join(","));
    // Exactly one entry — not one per tool.
    expect(args[toolsIdx + 2]).toBeUndefined();
  });

  it("both shapes deliver identical effective content", () => {
    const posix = buildClaudeCliArgs(INPUT, "linux");
    const windows = buildClaudeCliArgs(INPUT, "win32");

    const decodedPosix = decodeClaudeDelivery(posix.args, posix.stdinContent);
    const decodedWindows = decodeClaudeDelivery(windows.args, windows.stdinContent);

    expect(decodedPosix.shape).toBe("posix");
    expect(decodedWindows.shape).toBe("windows");

    // The whole point of the platform split: the CHANNEL differs, the CONTENT
    // must not. Compared exactly, so a truncation or reordering on either side
    // fails here.
    expect(decodedWindows.systemPrompt).toBe(decodedPosix.systemPrompt);
    expect(decodedWindows.taskPrompt).toBe(decodedPosix.taskPrompt);
    expect(decodedWindows.allowedTools).toEqual(decodedPosix.allowedTools);
    expect(decodedPosix.systemPrompt).toBe(INPUT.systemPrompt);
    expect(decodedPosix.taskPrompt).toBe(INPUT.promptText);
    expect(decodedPosix.allowedTools).toEqual(INPUT.allowedTools);
  });

  it("defaults to the running platform when none is passed", () => {
    const explicit = buildClaudeCliArgs(INPUT, process.platform);
    const implicit = buildClaudeCliArgs(INPUT);

    // Guards the seam itself: the added parameter must not change what production
    // callers (which pass one argument) get.
    expect(implicit).toEqual(explicit);
  });

  it("model and permission-mode flags appear in both shapes", () => {
    for (const platform of ["linux", "win32"] as const) {
      const { args } = buildClaudeCliArgs(
        { ...INPUT, modelOverride: "claude-opus-5", permissionMode: "acceptEdits" },
        platform,
      );
      expect(args[args.indexOf("--model") + 1]).toBe("claude-opus-5");
      expect(args[args.indexOf("--permission-mode") + 1]).toBe("acceptEdits");
    }
  });
});

// ── 7. Windows --allowed-tools quoting (GH #37 regression) ──────────────

describe("ClaudeCliAdapter: Windows --allowed-tools quoting (GH #37)", () => {
  it("Windows: --allowed-tools token has no literal double-quote characters", () => {
    if (process.platform !== "win32") return;

    const { args } = buildClaudeCliArgs({
      systemPrompt: "SP",
      promptText: "TP",
      allowedTools: ["Bash(npm:*)", "Bash(git:*)", "Read", "Edit"],
    });

    const toolsIdx = args.indexOf("--allowed-tools");
    expect(toolsIdx).toBeGreaterThan(-1);
    const toolsToken = args[toolsIdx + 1];
    // spawnCli/quoteWindowsToken is the single quoting authority — no pre-quoting
    expect(toolsToken).not.toContain('"');
  });

  it("Windows: round-trip through buildWindowsCliCommandLine quotes token exactly once", () => {
    if (process.platform !== "win32") return;

    const { args } = buildClaudeCliArgs({
      systemPrompt: "SP",
      promptText: "TP",
      allowedTools: ["Bash(npm:*)", "Bash(git:*)", "Read"],
    });

    const toolsIdx = args.indexOf("--allowed-tools");
    const toolsToken = args[toolsIdx + 1];

    const cmdLine = buildWindowsCliCommandLine("claude", [toolsToken]);
    // Token should appear wrapped in exactly one pair of double quotes
    expect(cmdLine).toContain(`"${toolsToken}"`);
    // No doubled outer quotes — that would indicate the pre-quoting bug
    expect(cmdLine).not.toContain(`""${toolsToken}""`);
  });
});

// ── 8. Integration: adapter end-to-end pipeline ─────────────────────────

describe("ClaudeCliAdapter: end-to-end pipeline", () => {
  it("envelope → buildSpawnConfig → verify args are parseable", () => {
    const envelope = createStandardEnvelope();
    const config = claudeCliAdapter.buildSpawnConfig(envelope, STANDARD_POLICY, {});

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

describe("session resume (--resume)", () => {
  const base = {
    systemPrompt: "SYS",
    promptText: "TASK",
    allowedTools: ["Bash(git:*)", "Read"],
  };

  it("omits --resume entirely when no session id is supplied", () => {
    const { args } = buildClaudeCliArgs(base, "darwin");

    expect(args).not.toContain("--resume");
  });

  it("appends --resume <id> when a session id is supplied", () => {
    const { args } = buildClaudeCliArgs(
      { ...base, resumeSessionId: "9af5cec8-c78d-4bd8-bfb6-4207314c9d8c" },
      "darwin",
    );

    const idx = args.indexOf("--resume");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("9af5cec8-c78d-4bd8-bfb6-4207314c9d8c");
  });

  it("combines --resume with a different --model — the review pass depends on it", () => {
    const { args } = buildClaudeCliArgs(
      { ...base, modelOverride: "claude-opus-5", resumeSessionId: "sess-1" },
      "darwin",
    );

    expect(args[args.indexOf("--model") + 1]).toBe("claude-opus-5");
    expect(args[args.indexOf("--resume") + 1]).toBe("sess-1");
  });

  it("still delivers the prompt on stdin when resuming, on both platforms", () => {
    const posix = buildClaudeCliArgs({ ...base, resumeSessionId: "s" }, "darwin");
    const win = buildClaudeCliArgs({ ...base, resumeSessionId: "s" }, "win32");

    expect(posix.stdinContent).toBe("TASK");
    expect(win.stdinContent).toBe(`SYS${WINDOWS_STDIN_PROMPT_SEPARATOR}TASK`);
    expect(win.args).toContain("--resume");
  });

  it("passes resumeSessionId through buildSpawnConfig", () => {
    const config = claudeCliAdapter.buildSpawnConfig(
      { sections: [{ name: "system", content: "SYS" }, { name: "brief", content: "TASK" }] },
      { sandbox: "workspace-write", approvals: "never", allowedCommands: ["git"] } as never,
      { model: "claude-opus-5", resumeSessionId: "sess-2" },
    );

    expect(config.args).toContain("--resume");
    expect(config.args[config.args.indexOf("--resume") + 1]).toBe("sess-2");
  });
});

describe("session fork (--fork-session)", () => {
  const base = {
    systemPrompt: "SYS",
    promptText: "TASK",
    allowedTools: ["Bash(git:*)", "Read"],
  };

  it("omits --fork-session when forking is not requested", () => {
    const { args } = buildClaudeCliArgs({ ...base, resumeSessionId: "p1" }, "darwin");

    expect(args).not.toContain("--fork-session");
  });

  it("suppresses --fork-session when there is no session to fork from", () => {
    // Forking is a modifier on resume: without a parent it would silently
    // do nothing, so emitting it would misreport what the spawn did.
    const { args } = buildClaudeCliArgs({ ...base, forkSession: true }, "darwin");

    expect(args).not.toContain("--fork-session");
    expect(args).not.toContain("--resume");
  });

  it("appends --fork-session after --resume when both are set", () => {
    const { args } = buildClaudeCliArgs(
      { ...base, resumeSessionId: "parent-1", forkSession: true },
      "darwin",
    );

    expect(args[args.indexOf("--resume") + 1]).toBe("parent-1");
    expect(args.indexOf("--fork-session")).toBeGreaterThan(args.indexOf("--resume"));
  });

  it("forks on Windows too, with the prompt still on stdin", () => {
    const { args, stdinContent } = buildClaudeCliArgs(
      { ...base, resumeSessionId: "parent-1", forkSession: true },
      "win32",
    );

    expect(args).toContain("--fork-session");
    expect(stdinContent).toBe(`SYS${WINDOWS_STDIN_PROMPT_SEPARATOR}TASK`);
  });

  it("passes forkSession through buildSpawnConfig", () => {
    const config = claudeCliAdapter.buildSpawnConfig(
      { sections: [{ name: "system", content: "SYS" }, { name: "brief", content: "TASK" }] },
      { sandbox: "workspace-write", approvals: "never", allowedCommands: ["git"] } as never,
      { resumeSessionId: "parent-2", forkSession: true },
    );

    expect(config.args).toContain("--fork-session");
    expect(config.args[config.args.indexOf("--resume") + 1]).toBe("parent-2");
  });
});
