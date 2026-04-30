import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  detectPlanOnlyIteration,
  runHasCodeModifications,
  createExecutionReminder,
} from "../../../src/agent/analysis/plan-only-detection.js";
import type { ToolCallRecord } from "../../../src/schema/index.js";

describe("plan-only detection", () => {
  describe("detectPlanOnlyIteration", () => {
    it("detects plan-only when only text content is present", () => {
      const content: Anthropic.ContentBlock[] = [
        {
          type: "text",
          text: "I will fix the bug by updating the function signature and adding validation.",
        },
      ];

      const result = detectPlanOnlyIteration(content);

      expect(result.isPlanOnly).toBe(true);
      expect(result.toolCalls).toEqual([]);
      expect(result.codeModifyingCalls).toEqual([]);
    });

    it("detects code execution when write_file is present", () => {
      const content: Anthropic.ContentBlock[] = [
        { type: "text", text: "Let me fix this file." },
        {
          type: "tool_use",
          id: "1",
          name: "write_file",
          input: { path: "src/foo.ts", content: "fixed" },
        },
      ];

      const result = detectPlanOnlyIteration(content);

      expect(result.isPlanOnly).toBe(false);
      expect(result.toolCalls).toContain("write_file");
      expect(result.codeModifyingCalls).toContain("write_file");
    });

    it("detects code execution when git is used to commit", () => {
      const content: Anthropic.ContentBlock[] = [
        { type: "text", text: "Now I'll commit these changes." },
        {
          type: "tool_use",
          id: "2",
          name: "git",
          input: { subcommand: "commit", args: "-m 'Fix bug'" },
        },
      ];

      const result = detectPlanOnlyIteration(content);

      expect(result.isPlanOnly).toBe(false);
      expect(result.codeModifyingCalls).toContain("git");
    });

    it("detects code execution when run_command is used", () => {
      const content: Anthropic.ContentBlock[] = [
        { type: "text", text: "Let me run the tests." },
        {
          type: "tool_use",
          id: "3",
          name: "run_command",
          input: { command: "npm test" },
        },
      ];

      const result = detectPlanOnlyIteration(content);

      expect(result.isPlanOnly).toBe(false);
      expect(result.codeModifyingCalls).toContain("run_command");
    });

    it("detects plan-only with read_file calls (no code modification)", () => {
      const content: Anthropic.ContentBlock[] = [
        { type: "text", text: "Let me check the current implementation." },
        {
          type: "tool_use",
          id: "4",
          name: "read_file",
          input: { path: "src/main.ts" },
        },
      ];

      const result = detectPlanOnlyIteration(content);

      expect(result.isPlanOnly).toBe(true);
      expect(result.toolCalls).toContain("read_file");
      expect(result.codeModifyingCalls).toEqual([]);
    });

    it("detects plan-only with search_files and list_directory (non-modifying tools)", () => {
      const content: Anthropic.ContentBlock[] = [
        { type: "text", text: "I'll search for usages." },
        {
          type: "tool_use",
          id: "5",
          name: "search_files",
          input: { pattern: "function foo", path: "src" },
        },
        {
          type: "tool_use",
          id: "6",
          name: "list_directory",
          input: { path: "src" },
        },
      ];

      const result = detectPlanOnlyIteration(content);

      expect(result.isPlanOnly).toBe(true);
      expect(result.toolCalls).toHaveLength(2);
      expect(result.codeModifyingCalls).toHaveLength(0);
    });

    it("detects code execution when rex_update_status is used", () => {
      const content: Anthropic.ContentBlock[] = [
        { type: "text", text: "Marking task as complete." },
        {
          type: "tool_use",
          id: "7",
          name: "rex_update_status",
          input: { status: "completed", resolutionType: "code-change" },
        },
      ];

      const result = detectPlanOnlyIteration(content);

      expect(result.isPlanOnly).toBe(false);
      expect(result.codeModifyingCalls).toContain("rex_update_status");
    });

    it("handles multiple code-modifying tools", () => {
      const content: Anthropic.ContentBlock[] = [
        { type: "text", text: "Fixing the issue." },
        {
          type: "tool_use",
          id: "8",
          name: "write_file",
          input: { path: "src/fix.ts", content: "fix" },
        },
        {
          type: "tool_use",
          id: "9",
          name: "git",
          input: { subcommand: "add", args: "src/fix.ts" },
        },
      ];

      const result = detectPlanOnlyIteration(content);

      expect(result.isPlanOnly).toBe(false);
      expect(result.codeModifyingCalls).toContain("write_file");
      expect(result.codeModifyingCalls).toContain("git");
    });

    it("handles empty content blocks", () => {
      const content: Anthropic.ContentBlock[] = [];

      const result = detectPlanOnlyIteration(content);

      expect(result.isPlanOnly).toBe(true);
      expect(result.toolCalls).toEqual([]);
    });
  });

  describe("runHasCodeModifications", () => {
    it("returns true when write_file was called", () => {
      const toolCalls: ToolCallRecord[] = [
        {
          turn: 1,
          tool: "write_file",
          input: { path: "src/foo.ts", content: "x" },
          output: "wrote",
          durationMs: 10,
        },
      ];

      expect(runHasCodeModifications(toolCalls)).toBe(true);
    });

    it("returns true when git was called", () => {
      const toolCalls: ToolCallRecord[] = [
        {
          turn: 1,
          tool: "git",
          input: { subcommand: "commit" },
          output: "committed",
          durationMs: 10,
        },
      ];

      expect(runHasCodeModifications(toolCalls)).toBe(true);
    });

    it("returns false when only read_file was called", () => {
      const toolCalls: ToolCallRecord[] = [
        {
          turn: 1,
          tool: "read_file",
          input: { path: "src/main.ts" },
          output: "content",
          durationMs: 10,
        },
      ];

      expect(runHasCodeModifications(toolCalls)).toBe(false);
    });

    it("returns false when tool calls list is empty", () => {
      const toolCalls: ToolCallRecord[] = [];

      expect(runHasCodeModifications(toolCalls)).toBe(false);
    });

    it("returns true if any call is code-modifying", () => {
      const toolCalls: ToolCallRecord[] = [
        {
          turn: 1,
          tool: "read_file",
          input: { path: "src/main.ts" },
          output: "content",
          durationMs: 10,
        },
        {
          turn: 2,
          tool: "write_file",
          input: { path: "src/fix.ts", content: "x" },
          output: "wrote",
          durationMs: 10,
        },
        {
          turn: 3,
          tool: "search_files",
          input: { pattern: "foo", path: "src" },
          output: "found",
          durationMs: 10,
        },
      ];

      expect(runHasCodeModifications(toolCalls)).toBe(true);
    });
  });

  describe("createExecutionReminder", () => {
    it("creates a basic reminder without plan summary", () => {
      const reminder = createExecutionReminder();

      expect(reminder).toContain("provided a plan");
      expect(reminder).toContain("did not execute");
      expect(reminder).toContain("write_file");
      expect(reminder).toContain("git");
      expect(reminder).toContain("run_command");
    });

    it("includes plan summary when provided", () => {
      const plan = "I will update the database schema and run migrations.";
      const reminder = createExecutionReminder(plan);

      expect(reminder).toContain(plan.substring(0, 200));
      expect(reminder).toContain("EXECUTE the plan");
    });

    it("includes attempt number when provided", () => {
      const reminder = createExecutionReminder(undefined, 2);

      expect(reminder).toContain("attempt 2");
    });

    it("omits attempt number for first attempt", () => {
      const reminder = createExecutionReminder(undefined, 1);

      expect(reminder).not.toContain("attempt");
    });

    it("truncates long plan summaries", () => {
      const longPlan = "a".repeat(500);
      const reminder = createExecutionReminder(longPlan);

      expect(reminder.length).toBeLessThan(longPlan.length);
      expect(reminder).toContain("...");
    });

    it("handles combined plan and attempt info", () => {
      const plan = "Fix the bug.";
      const reminder = createExecutionReminder(plan, 3);

      expect(reminder).toContain(plan);
      expect(reminder).toContain("attempt 3");
    });
  });
});
