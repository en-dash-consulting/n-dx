import { describe, expect, it } from "vitest";
import {
  claudeSessionDriver,
  codexSessionDriver,
  vendorSessionDriver,
  WINDOWS_STDIN_PROMPT_SEPARATOR,
} from "../../src/vendor-session-driver.js";
import type { VendorSessionDriver } from "../../src/vendor-session-driver.js";
import { UsageMessageFilter } from "../../src/usage-dedup.js";

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
  it("ignores fork and drops policy flags on resume", () => {
    const { args } = codexSessionDriver.turnSpawn({
      systemPrompt: "",
      prompt: "hi",
      model: "m",
      resume: { sessionId: "t", fork: true },
      codex: { policyFlags: ["-s", "read-only"] },
    });
    expect(args).toEqual(["exec", "resume", "t", "--json", "--skip-git-repo-check", "-m", "m", "-"]);
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
      ["tool_result", 2, { tool: "unknown", output: "     1\tconst a = 1;", durationMs: 0, callId: "toolu_01A" }],
      ["tool_result", 2, { tool: "unknown", output: "line one\nline two", durationMs: 0, callId: "toolu_01B" }],
    ]);
    expect(claudeSessionDriver.parseLine(twoResults, 2)?.toolResult?.callId).toBe("toolu_01A");
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
