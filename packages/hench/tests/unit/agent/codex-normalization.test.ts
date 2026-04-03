import { describe, it, expect } from "vitest";
import { normalizeCodexResponse } from "../../../src/agent/lifecycle/adapters/codex-cli-adapter.js";

describe("normalizeCodexResponse", () => {
  const malformedFixtures: Array<{
    name: string;
    input: unknown;
    expected: {
      status: "completed" | "error" | "in_progress" | "unknown";
      assistantText: string;
      toolEvents: number;
      warnings: number;
    };
  }> = [
    {
      name: "truncated JSON payload falls back to plain text",
      input: "{\"status\":\"completed\",\"content\":[{\"type\":\"text\",\"text\":\"hello\"}",
      expected: {
        status: "completed",
        assistantText: "{\"status\":\"completed\",\"content\":[{\"type\":\"text\",\"text\":\"hello\"}",
        toolEvents: 0,
        warnings: 0,
      },
    },
    {
      name: "empty content array stays deterministic",
      input: { status: "completed", content: [] },
      expected: {
        status: "completed",
        assistantText: "",
        toolEvents: 0,
        warnings: 0,
      },
    },
    {
      name: "missing block types are ignored with warning",
      input: {
        status: "in_progress",
        content: [{ text: "no type field" }],
      },
      expected: {
        status: "in_progress",
        assistantText: "",
        toolEvents: 0,
        warnings: 1,
      },
    },
  ];

  it("handles mixed text and tool blocks", () => {
    const payload = {
      status: "completed",
      content: [
        { type: "text", text: "Starting work" },
        { type: "tool_use", name: "read_file", input: { path: "README.md" } },
        { type: "tool_result", name: "read_file", output: "file content" },
        { type: "text", text: "Done." },
      ],
    };

    const normalized = normalizeCodexResponse(payload);

    expect(normalized.status).toBe("completed");
    expect(normalized.assistantText).toContain("Starting work");
    expect(normalized.assistantText).toContain("Done.");
    expect(normalized.toolEvents).toHaveLength(2);
    expect(normalized.toolEvents[0]).toMatchObject({
      tool: "read_file",
      eventType: "tool_use",
      input: { path: "README.md" },
    });
    expect(normalized.toolEvents[1]).toMatchObject({
      tool: "read_file",
      eventType: "tool_result",
      output: "file content",
    });
  });

  it("supports partial text blocks and completion markers", () => {
    const payload = {
      status: "in_progress",
      blocks: [
        { type: "text_delta", delta: "Hello" },
        { type: "text_delta", delta: " world" },
        { type: "completion", result: "!" },
      ],
    };

    const normalized = normalizeCodexResponse(payload);

    expect(normalized.assistantText).toBe("Hello\nworld\n!");
    expect(normalized.status).toBe("in_progress");
  });

  it("ignores unknown block types with warnings", () => {
    const payload = {
      status: "completed",
      content: [
        { type: "text", text: "ok" },
        { type: "weird_new_block", foo: "bar" },
      ],
    };

    const normalized = normalizeCodexResponse(payload);

    expect(normalized.assistantText).toBe("ok");
    expect(normalized.warnings).toHaveLength(1);
    expect(normalized.warnings[0]).toContain("Unknown Codex block type");
  });

  it("accepts plain-text codex output safely", () => {
    const normalized = normalizeCodexResponse("Just a final answer");

    expect(normalized.status).toBe("completed");
    expect(normalized.assistantText).toBe("Just a final answer");
    expect(normalized.toolEvents).toHaveLength(0);
    expect(normalized.warnings).toHaveLength(0);
  });

  it("parses json string payloads", () => {
    const normalized = normalizeCodexResponse(JSON.stringify({
      status: "completed",
      content: [
        { type: "text", text: "from json" },
        { type: "tool_use", name: "grep", input: "{\"pattern\":\"foo\"}" },
      ],
    }));

    expect(normalized.status).toBe("completed");
    expect(normalized.assistantText).toBe("from json");
    expect(normalized.toolEvents[0].input).toEqual({ pattern: "foo" });
  });

  it("applies deterministic fallback behavior for malformed fixtures", () => {
    for (const fixture of malformedFixtures) {
      expect(() => normalizeCodexResponse(fixture.input)).not.toThrow();
      const normalized = normalizeCodexResponse(fixture.input);
      expect(normalized.status, fixture.name).toBe(fixture.expected.status);
      expect(normalized.assistantText, fixture.name).toBe(fixture.expected.assistantText);
      expect(normalized.toolEvents, fixture.name).toHaveLength(fixture.expected.toolEvents);
      expect(normalized.warnings, fixture.name).toHaveLength(fixture.expected.warnings);
    }
  });
});
