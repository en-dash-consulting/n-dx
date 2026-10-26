import { describe, expect, it } from "vitest";
import {
  claudeSessionDriver,
  codexSessionDriver,
  vendorSessionDriver,
  WINDOWS_STDIN_PROMPT_SEPARATOR,
} from "../../src/vendor-session-driver.js";
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
