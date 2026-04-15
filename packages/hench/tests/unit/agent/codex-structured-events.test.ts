import { describe, it, expect } from "vitest";
import { processCodexJsonLine } from "../../../src/agent/lifecycle/event-accumulator.js";
import type { CliRunResult } from "../../../src/agent/lifecycle/event-accumulator.js";

function createResult(): CliRunResult {
  return {
    turns: 0,
    toolCalls: [],
    tokenUsage: { input: 0, output: 0 },
    turnTokenUsage: [],
  };
}

describe("processCodexJsonLine", () => {
  describe("message events", () => {
    it("parses assistant message with text content blocks", () => {
      const result = createResult();
      const turnCounter = { value: 0 };

      const line = JSON.stringify({
        type: "message",
        content: [
          { type: "text", text: "I'll help you with that." },
        ],
      });

      const parsed = processCodexJsonLine(line, result, turnCounter);

      expect(parsed).toBe(true);
      expect(turnCounter.value).toBe(1);
      expect(result.summary).toContain("I'll help you with that.");
    });

    it("parses message with tool_use content blocks", () => {
      const result = createResult();
      const turnCounter = { value: 0 };

      const line = JSON.stringify({
        type: "message",
        content: [
          { type: "text", text: "Let me read the file." },
          { type: "tool_use", name: "read_file", input: { path: "README.md" } },
        ],
      });

      const parsed = processCodexJsonLine(line, result, turnCounter);

      expect(parsed).toBe(true);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]).toMatchObject({
        turn: 1,
        tool: "read_file",
        input: { path: "README.md" },
      });
    });

    it("parses message with function_call content blocks", () => {
      const result = createResult();
      const turnCounter = { value: 0 };

      const line = JSON.stringify({
        type: "message",
        content: [
          { type: "function_call", name: "shell", arguments: "{\"command\":\"ls\"}" },
        ],
      });

      const parsed = processCodexJsonLine(line, result, turnCounter);

      expect(parsed).toBe(true);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].tool).toBe("shell");
      expect(result.toolCalls[0].input).toEqual({ command: "ls" });
    });

    it("extracts token usage from message event", () => {
      const result = createResult();
      const turnCounter = { value: 0 };
      const tokenMetadata = { vendor: "codex" as const, model: "gpt-5-codex" };

      const line = JSON.stringify({
        type: "message",
        content: [{ type: "text", text: "Done" }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const parsed = processCodexJsonLine(line, result, turnCounter, tokenMetadata);

      expect(parsed).toBe(true);
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

    it("parses direct text on message event without content array", () => {
      const result = createResult();
      const turnCounter = { value: 0 };

      const line = JSON.stringify({
        type: "message",
        text: "Simple text response",
      });

      const parsed = processCodexJsonLine(line, result, turnCounter);

      expect(parsed).toBe(true);
      expect(result.summary).toBe("Simple text response");
    });
  });

  describe("function_call events", () => {
    it("parses standalone function_call event", () => {
      const result = createResult();
      const turnCounter = { value: 1 };

      const line = JSON.stringify({
        type: "function_call",
        name: "shell",
        arguments: "{\"command\":\"npm test\"}",
      });

      const parsed = processCodexJsonLine(line, result, turnCounter);

      expect(parsed).toBe(true);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]).toMatchObject({
        turn: 1,
        tool: "shell",
        input: { command: "npm test" },
      });
    });

    it("handles missing tool name gracefully", () => {
      const result = createResult();
      const turnCounter = { value: 1 };

      const line = JSON.stringify({
        type: "function_call",
        arguments: "{}",
      });

      const parsed = processCodexJsonLine(line, result, turnCounter);

      expect(parsed).toBe(true);
      expect(result.toolCalls[0].tool).toBe("unknown");
    });
  });

  describe("function_call_output events", () => {
    it("attaches output to last tool call", () => {
      const result = createResult();
      result.toolCalls.push({
        turn: 1,
        tool: "shell",
        input: { command: "ls" },
        output: "",
        durationMs: 0,
      });
      const turnCounter = { value: 1 };

      const line = JSON.stringify({
        type: "function_call_output",
        output: "file1.txt\nfile2.txt",
      });

      const parsed = processCodexJsonLine(line, result, turnCounter);

      expect(parsed).toBe(true);
      expect(result.toolCalls[0].output).toBe("file1.txt\nfile2.txt");
    });

    it("handles content field as fallback for output", () => {
      const result = createResult();
      result.toolCalls.push({
        turn: 1,
        tool: "shell",
        input: {},
        output: "",
        durationMs: 0,
      });
      const turnCounter = { value: 1 };

      const line = JSON.stringify({
        type: "function_call_output",
        content: "result text",
      });

      const parsed = processCodexJsonLine(line, result, turnCounter);

      expect(parsed).toBe(true);
      expect(result.toolCalls[0].output).toBe("result text");
    });
  });

  describe("error events", () => {
    it("records error from message field", () => {
      const result = createResult();
      const turnCounter = { value: 0 };

      const line = JSON.stringify({
        type: "error",
        message: "Rate limit exceeded",
      });

      const parsed = processCodexJsonLine(line, result, turnCounter);

      expect(parsed).toBe(true);
      expect(result.error).toBe("Rate limit exceeded");
    });

    it("records error from error field as fallback", () => {
      const result = createResult();
      const turnCounter = { value: 0 };

      const line = JSON.stringify({
        type: "error",
        error: "Auth failed",
      });

      const parsed = processCodexJsonLine(line, result, turnCounter);

      expect(parsed).toBe(true);
      expect(result.error).toBe("Auth failed");
    });
  });

  describe("completion events", () => {
    it("parses summary event with result text", () => {
      const result = createResult();
      const turnCounter = { value: 0 };

      const line = JSON.stringify({
        type: "summary",
        result: "Task completed successfully",
        num_turns: 5,
        cost_usd: 0.05,
      });

      const parsed = processCodexJsonLine(line, result, turnCounter);

      expect(parsed).toBe(true);
      expect(result.summary).toBe("Task completed successfully");
      expect(result.turns).toBe(5);
      expect(result.costUsd).toBe(0.05);
    });

    it("parses response.completed event type", () => {
      const result = createResult();
      const turnCounter = { value: 0 };

      const line = JSON.stringify({
        type: "response.completed",
        text: "All done",
        usage: { input_tokens: 200, output_tokens: 100 },
      });

      const parsed = processCodexJsonLine(line, result, turnCounter);

      expect(parsed).toBe(true);
      expect(result.summary).toBe("All done");
    });

    it("records error from is_error completion", () => {
      const result = createResult();
      const turnCounter = { value: 0 };

      const line = JSON.stringify({
        type: "summary",
        is_error: true,
        result: "Task failed: compilation error",
      });

      const parsed = processCodexJsonLine(line, result, turnCounter);

      expect(parsed).toBe(true);
      expect(result.error).toBe("Task failed: compilation error");
    });

    it("extracts token usage from completion event as fallback", () => {
      const result = createResult();
      const turnCounter = { value: 0 };

      const line = JSON.stringify({
        type: "summary",
        result: "Done",
        usage: { input_tokens: 300, output_tokens: 150 },
      });

      const parsed = processCodexJsonLine(line, result, turnCounter);

      expect(parsed).toBe(true);
      // Token usage from completion is a fallback — only used when per-turn is absent
      // Since result.tokenUsage starts at 0, this fallback should populate it
      expect(result.tokenUsage.input).toBe(300);
      expect(result.tokenUsage.output).toBe(150);
    });
  });

  describe("unrecognized events", () => {
    it("returns false for unknown event types", () => {
      const result = createResult();
      const turnCounter = { value: 0 };

      const line = JSON.stringify({
        type: "response.delta",
        delta: "partial text",
      });

      const parsed = processCodexJsonLine(line, result, turnCounter);

      expect(parsed).toBe(false);
    });

    it("returns false for non-JSON lines", () => {
      const result = createResult();
      const turnCounter = { value: 0 };

      expect(processCodexJsonLine("not json", result, turnCounter)).toBe(false);
      expect(processCodexJsonLine("", result, turnCounter)).toBe(false);
      expect(processCodexJsonLine("  ", result, turnCounter)).toBe(false);
    });

    it("returns false for JSON without type field", () => {
      const result = createResult();
      const turnCounter = { value: 0 };

      const line = JSON.stringify({ status: "completed", text: "hello" });

      expect(processCodexJsonLine(line, result, turnCounter)).toBe(false);
    });
  });

  describe("multi-event sequences", () => {
    it("accumulates state across multiple events like Claude processStreamLine", () => {
      const result = createResult();
      const turnCounter = { value: 0 };
      const meta = { vendor: "codex" as const, model: "gpt-5-codex" };

      // Event 1: assistant message
      processCodexJsonLine(
        JSON.stringify({
          type: "message",
          content: [{ type: "text", text: "Let me check the file." }],
          usage: { input_tokens: 50, output_tokens: 20 },
        }),
        result,
        turnCounter,
        meta,
      );

      // Event 2: function call
      processCodexJsonLine(
        JSON.stringify({
          type: "function_call",
          name: "read_file",
          arguments: "{\"path\":\"src/main.ts\"}",
        }),
        result,
        turnCounter,
        meta,
      );

      // Event 3: function result
      processCodexJsonLine(
        JSON.stringify({
          type: "function_call_output",
          output: "export function main() { ... }",
        }),
        result,
        turnCounter,
        meta,
      );

      // Event 4: second assistant message
      processCodexJsonLine(
        JSON.stringify({
          type: "message",
          content: [{ type: "text", text: "I've read the file. Making changes." }],
          usage: { input_tokens: 80, output_tokens: 40 },
        }),
        result,
        turnCounter,
        meta,
      );

      // Event 5: summary
      processCodexJsonLine(
        JSON.stringify({
          type: "summary",
          result: "Changes applied successfully",
          num_turns: 2,
        }),
        result,
        turnCounter,
        meta,
      );

      // Verify accumulated state matches what Claude's processStreamLine would produce
      expect(turnCounter.value).toBe(2);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].tool).toBe("read_file");
      expect(result.toolCalls[0].output).toBe("export function main() { ... }");
      expect(result.tokenUsage.input).toBe(130); // 50 + 80
      expect(result.tokenUsage.output).toBe(60); // 20 + 40
      expect(result.turnTokenUsage).toHaveLength(2);
      expect(result.turns).toBe(2);
      expect(result.summary).toBe("Changes applied successfully");
    });
  });
});
