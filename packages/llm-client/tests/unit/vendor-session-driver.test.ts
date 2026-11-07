import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  claudeSessionDriver,
  codexSessionDriver,
  vendorSessionDriver,
  WINDOWS_STDIN_PROMPT_SEPARATOR,
} from "../../src/vendor-session-driver.js";
import type { VendorSessionDriver } from "../../src/vendor-session-driver.js";
import { UsageMessageFilter } from "../../src/usage-dedup.js";
import { codexShellEnvFlags, compileCodexPolicyFlags } from "../../src/codex-cli-provider.js";
import { DEFAULT_EXECUTION_POLICY } from "../../src/runtime-contract.js";

describe("vendorSessionDriver", () => {
  it("covers the two CLI vendors and nothing else", () => {
    expect(vendorSessionDriver("claude")).toBe(claudeSessionDriver);
    expect(vendorSessionDriver("codex")).toBe(codexSessionDriver);
    expect(vendorSessionDriver("openai")).toBeUndefined();
    expect(claudeSessionDriver.canFork).toBe(true);
    expect(codexSessionDriver.canFork).toBe(false);
  });
});

describe("claude turn spawn", () => {
  it("omits the system prompt and allowed tools when the caller sets neither", () => {
    const { args, stdin } = claudeSessionDriver.turnSpawn({ systemPrompt: "", prompt: "hi" }, "linux");
    expect(args).toEqual(["-p", "--output-format", "stream-json", "--verbose"]);
    expect(stdin).toBe("hi");
  });

  it("puts the system prompt on stdin on Windows", () => {
    const { args, stdin } = claudeSessionDriver.turnSpawn(
      { systemPrompt: "sys", prompt: "hi", claude: { allowedTools: ["Read", "Edit"] } },
      "win32",
    );
    expect(args).not.toContain("--system-prompt");
    expect(args).toEqual(expect.arrayContaining(["--allowed-tools", "Read,Edit"]));
    expect(stdin).toBe(`sys${WINDOWS_STDIN_PROMPT_SEPARATOR}hi`);
  });

  it("passes the built-in tool allowlist as one token and an empty setting-sources list as an empty argument", () => {
    for (const platform of ["linux", "win32"] as const) {
      const { args } = claudeSessionDriver.turnSpawn(
        { systemPrompt: "", prompt: "hi", claude: { tools: ["Read", "Grep", "Glob"], settingSources: [] } },
        platform,
      );
      expect(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2)).toEqual(["--tools", "Read,Grep,Glob"]);
      expect(args.slice(args.indexOf("--setting-sources"), args.indexOf("--setting-sources") + 2))
        .toEqual(["--setting-sources", ""]);
    }
  });

  it("omits --tools and --setting-sources when the caller sets neither", () => {
    const { args } = claudeSessionDriver.turnSpawn({ systemPrompt: "", prompt: "hi", claude: {} }, "linux");
    expect(args).not.toContain("--tools");
    expect(args).not.toContain("--setting-sources");
  });

  it("forks only alongside a resume", () => {
    const { args } = claudeSessionDriver.turnSpawn(
      { systemPrompt: "", prompt: "hi", resume: { sessionId: "s", fork: true } },
      "linux",
    );
    expect(args.slice(-3)).toEqual(["--resume", "s", "--fork-session"]);
  });
});

describe("codex turn spawn", () => {
  // `exec resume` rejects the sandbox and approval flags, but config is read
  // per process: the overrides that blank the Codex key in the agent's
  // commands must ride on every resumed turn too.
  it("ignores fork and drops policy flags on resume, keeping the key-blanking overrides", () => {
    const { args } = codexSessionDriver.turnSpawn({
      systemPrompt: "",
      prompt: "hi",
      model: "m",
      resume: { sessionId: "t", fork: true },
      codex: { policyFlags: ["-s", "read-only"] },
    });
    expect(args).toEqual([
      "exec", "resume", "t", "--json", "--skip-git-repo-check",
      ...codexShellEnvFlags(),
      "-m", "m", "-",
    ]);
    expect(args).not.toContain("read-only");
  });

  // startVendorSession is public: a caller whose policy flags lack the
  // overrides, or who passes none, must not start an agent that can read the
  // Codex key. Flags that already end with them are not repeated.
  const compiled = compileCodexPolicyFlags(DEFAULT_EXECUTION_POLICY);
  it.each([
    ["absent", undefined, codexShellEnvFlags()],
    ["without the overrides", ["-s", "read-only"], ["-s", "read-only", ...codexShellEnvFlags()]],
    ["from compileCodexPolicyFlags", compiled, compiled],
  ])("ends a fresh turn's flags with the key-blanking overrides when policy flags are %s", (_label, policyFlags, flags) => {
    const { args } = codexSessionDriver.turnSpawn({
      systemPrompt: "",
      prompt: "hi",
      ...(policyFlags ? { codex: { policyFlags } } : {}),
    });
    expect(args).toEqual(["exec", ...flags, "--json", "--skip-git-repo-check", "-"]);
    expect(args.slice(1 + flags.length - codexShellEnvFlags().length, 1 + flags.length)).toEqual(codexShellEnvFlags());
  });
});

describe("usage events", () => {
  const message = { type: "assistant", message: { id: "m1", usage: { input_tokens: 4, output_tokens: 2 } } };
  const result = { type: "result", usage: { input_tokens: 9, output_tokens: 9 } };

  it("counts a repeated Claude message once", () => {
    const seen = new UsageMessageFilter();
    expect(claudeSessionDriver.usageEvent(message, 1, seen, false)?.tokenUsage).toEqual({ input: 4, output: 2 });
    expect(claudeSessionDriver.usageEvent(message, 1, seen, true)).toBeNull();
  });

  it("uses the Claude result total only when no message reported usage", () => {
    const seen = new UsageMessageFilter();
    expect(claudeSessionDriver.usageEvent(result, 1, seen, true)).toBeNull();
    expect(claudeSessionDriver.usageEvent(result, 1, seen, false)?.tokenUsage).toEqual({ input: 9, output: 9 });
  });

  it("reads Codex turn.completed usage", () => {
    const event = codexSessionDriver.usageEvent(
      { type: "turn.completed", usage: { input_tokens: 10, output_tokens: 3 } },
      2,
      new UsageMessageFilter(),
      false,
    );
    expect(event).toMatchObject({ type: "token_usage", vendor: "codex", turn: 2, tokenUsage: { input: 10, output: 3 } });
    expect(codexSessionDriver.usageEvent({ type: "item.completed" }, 2, new UsageMessageFilter(), false)).toBeNull();
  });
});

describe("session ids", () => {
  it("reads Claude session_id and only Codex thread.started", () => {
    expect(claudeSessionDriver.extractSessionId({ type: "system", session_id: "a" })).toBe("a");
    expect(codexSessionDriver.extractSessionId({ type: "thread.started", thread_id: "t" })).toBe("t");
    expect(codexSessionDriver.extractSessionId({ type: "item.completed", thread_id: "x" })).toBeUndefined();
  });
});

describe("text length", () => {
  const long = "x".repeat(2000);
  const lines: Array<[string, VendorSessionDriver, string, "text" | "completionSummary"]> = [
    ["claude string message", claudeSessionDriver, JSON.stringify({ type: "assistant", message: long }), "text"],
    ["claude result", claudeSessionDriver, JSON.stringify({ type: "result", result: long }), "completionSummary"],
    ["codex agent_message", codexSessionDriver, JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: long } }), "text"],
    ["codex message block", codexSessionDriver, JSON.stringify({ type: "message", content: [{ type: "output_text", text: long }] }), "text"],
    ["codex summary", codexSessionDriver, JSON.stringify({ type: "summary", result: long }), "completionSummary"],
  ];

  it.each(lines)("keeps hench's 500-character summary of a %s by default", (_name, driver, line, field) => {
    expect(driver.parseLine(line, 1)?.[field]).toHaveLength(500);
  });

  it.each(lines)("keeps the whole %s when the caller lifts the limit", (_name, driver, line, field) => {
    expect(driver.parseLine(line, 1, { textLimit: Infinity })?.[field]).toBe(long);
  });
});

describe("claude tool results", () => {
  // Claude CLI stream-json: a call is an assistant tool_use block with an id; its
  // answer is a `user` line whose tool_result blocks name that id.
  const call = JSON.stringify({
    type: "assistant",
    message: {
      id: "msg_01", role: "assistant", model: "claude-sonnet-4-5",
      content: [{ type: "tool_use", id: "toolu_01A", name: "Read", input: { file_path: "/p/a.ts" } }],
    },
    parent_tool_use_id: null, session_id: "s1", uuid: "u1",
  });
  const twoResults = JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [
        { tool_use_id: "toolu_01A", type: "tool_result", content: "     1\tconst a = 1;" },
        {
          tool_use_id: "toolu_01B", type: "tool_result", is_error: false,
          content: [
            { type: "text", text: "line one" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "AA==" } },
            { type: "text", text: "line two" },
          ],
        },
      ],
    },
    parent_tool_use_id: null, session_id: "s1", uuid: "u2",
    tool_use_result: { stdout: "ignored", stderr: "" },
  });

  it("carries the tool_use block's id on the call", () => {
    expect(claudeSessionDriver.parseLine(call, 2)?.toolCall).toEqual({
      tool: "Read", input: { file_path: "/p/a.ts" }, id: "toolu_01A",
    });
  });

  it("turns a user line into one tool_result per block, each naming its call", () => {
    const events = claudeSessionDriver.parseLineEvents(twoResults, 2);
    expect(events.map((e) => [e.type, e.turn, e.toolResult])).toEqual([
      ["tool_result", 2, { tool: "", output: "     1\tconst a = 1;", durationMs: 0, id: "toolu_01A" }],
      ["tool_result", 2, { tool: "", output: "line one\nline two", durationMs: 0, id: "toolu_01B", isError: false }],
    ]);
    expect(claudeSessionDriver.parseLine(twoResults, 2)?.toolResult?.id).toBe("toolu_01A");
  });

  it("flags a result from is_error, and keeps the [error] prefix only when it is true", () => {
    const line = (isError: boolean, text: string) => JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ tool_use_id: "toolu_E", type: "tool_result", is_error: isError, content: text }] },
    });
    expect(claudeSessionDriver.parseLineEvents(line(true, "boom"), 1)[0].toolResult).toEqual({
      tool: "", output: "[error] boom", durationMs: 0, id: "toolu_E", isError: true,
    });
    // A successful call whose output happens to start with "[error] " is still a success.
    expect(claudeSessionDriver.parseLineEvents(line(false, "[error] printed"), 1)[0].toolResult).toEqual({
      tool: "", output: "[error] printed", durationMs: 0, id: "toolu_E", isError: false,
    });
  });

  it("leaves the flag unset when the block says nothing about errors", () => {
    expect(claudeSessionDriver.parseLineEvents(twoResults, 2)[0].toolResult).not.toHaveProperty("isError");
  });

  it("flags a top-level tool_result from is_error when present", () => {
    const top = (extra: Record<string, unknown>) =>
      claudeSessionDriver.parseLine(JSON.stringify({ type: "tool_result", output: "out", ...extra }), 1)?.toolResult;
    expect(top({ is_error: true })?.isError).toBe(true);
    expect(top({ is_error: false })?.isError).toBe(false);
    expect(top({})).not.toHaveProperty("isError");
  });

  it("caps a result's output like any tool output", () => {
    const big = JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ tool_use_id: "toolu_X", type: "tool_result", content: "y".repeat(5000) }] },
    });
    expect(claudeSessionDriver.parseLineEvents(big, 1)[0].toolResult?.output).toHaveLength(2000);
  });

  it("yields nothing for a user line without tool results", () => {
    const prompt = JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "hi" }] } });
    expect(claudeSessionDriver.parseLineEvents(prompt, 1)).toEqual([]);
    expect(claudeSessionDriver.parseLine(prompt, 1)).toBeNull();
  });

  it("lists a single-event line as one event for both vendors", () => {
    expect(claudeSessionDriver.parseLineEvents(call, 1)).toHaveLength(1);
    expect(codexSessionDriver.parseLineEvents(JSON.stringify({ type: "summary", result: "ok" }), 1)).toHaveLength(1);
    expect(codexSessionDriver.parseLineEvents("", 1)).toEqual([]);
  });
});

describe("codex tool results", () => {
  // Modelled on the real fixture packages/hench/tests/fixtures/codex-file-change-real.jsonl;
  // the failed variants are not captured from a live CLI.
  const commandItem = (fields: Record<string, unknown>) => JSON.stringify({
    type: "item.completed",
    item: { id: "item_1", type: "command_execution", command: "bash -lc 'false'", aggregated_output: "out", ...fields },
  });
  const flag = (fields: Record<string, unknown>) => codexSessionDriver.parseLine(commandItem(fields), 1)?.toolResult;

  it("flags a command that exited non-zero or failed", () => {
    expect(flag({ exit_code: 1, status: "failed" })?.isError).toBe(true);
    expect(flag({ exit_code: 2 })?.isError).toBe(true);
    expect(flag({ status: "failed" })?.isError).toBe(true);
  });

  it("marks a command that completed with exit code 0 as not failed", () => {
    expect(flag({ exit_code: 0, status: "completed" })).toEqual({ tool: "shell", output: "out", durationMs: 0, isError: false });
  });

  it("leaves the flag unset when the item carries neither status nor exit code", () => {
    expect(flag({})).not.toHaveProperty("isError");
  });

  it("leaves function_call_output unflagged: it carries no status", () => {
    const line = JSON.stringify({ type: "function_call_output", output: "x" });
    expect(codexSessionDriver.parseLine(line, 1)?.toolResult).not.toHaveProperty("isError");
  });
});

describe("codex mcp tool calls", () => {
  // Verbatim `codex exec --json` lines from codex-cli 0.164.0-alpha.11.1
  // (2026-11-06), in this order: success started, success completed, tool
  // error result, transport failure, timeout.
  const [started, success, toolError, transport, timeout] = readFileSync(
    fileURLToPath(new URL("../fixtures/codex-mcp-tool-call-0.164.0-alpha.11.1.jsonl", import.meta.url)),
    "utf-8",
  ).split("\n").filter(Boolean);
  const result = (line: string) => codexSessionDriver.parseLine(line, 1)?.toolResult;
  const tool = "mcp__ndx-sidecar__propose_status";
  const callError = "tool call error: tool call failed for `ndx-sidecar/propose_status`\n\nCaused by:\n    ";

  it("maps item.started to a tool use named from the event's server and tool", () => {
    const event = codexSessionDriver.parseLine(started, 1);
    expect(event?.type).toBe("tool_use");
    expect(event?.toolCall).toEqual({ tool, input: { mode: "success" }, id: "item_1" });
  });

  it("maps a completed call to a successful result with its text content", () => {
    expect(result(success)).toEqual({ tool, output: "probe accepted", durationMs: 0, id: "item_1", isError: false });
  });

  it("flags a tool error result from status alone: error is null", () => {
    expect(result(toolError)).toEqual({ tool, output: "probe rejected", durationMs: 0, id: "item_2", isError: true });
  });

  it("flags a transport failure and reports error.message", () => {
    const r = result(transport);
    expect(r?.tool).toBe(tool);
    expect(r?.isError).toBe(true);
    expect(r?.output.startsWith(`${callError}Transport send error: `)).toBe(true);
    expect(r?.output.endsWith("error sending request for url (http://127.0.0.1:58821/mcp)")).toBe(true);
  });

  it("flags a timeout and reports error.message", () => {
    expect(result(timeout)).toEqual({
      tool,
      output: `${callError}timed out awaiting tools/call after 1000ms`,
      durationMs: 0,
      id: "item_1",
      isError: true,
    });
  });
});
