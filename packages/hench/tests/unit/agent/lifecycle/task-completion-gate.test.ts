import { describe, it, expect } from "vitest";
import { validateTaskCompletion } from "../../../../src/agent/lifecycle/task-completion-gate.js";
import type { RunRecord } from "../../../../src/schema/index.js";

describe("Task Completion Gate", () => {
  const createRun = (overrides?: Partial<RunRecord>): RunRecord => ({
    id: "test-run",
    taskId: "test-task",
    taskTitle: "Test Task",
    status: "completed",
    turns: 1,
    vendor: "claude",
    model: "claude-sonnet",
    tokenUsage: { input: 100, output: 50 },
    toolCalls: [],
    summary: "Task completed",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    ...overrides,
  });

  describe("Docs-only tasks (no code-modifying tool calls)", () => {
    it("allows completion when no tool calls made", () => {
      const run = createRun({
        toolCalls: [],
      });

      const result = validateTaskCompletion(run);

      expect(result.valid).toBe(true);
      expect(result.taskClassification).toBe("docs-only");
      expect(result.codeFiles).toEqual([]);
    });

    it("allows completion when only reading files (non-code-modifying)", () => {
      const run = createRun({
        toolCalls: [
          {
            turn: 1,
            tool: "read_file",
            input: { path: "README.md" },
            output: "contents",
            durationMs: 100,
          },
          {
            turn: 1,
            tool: "search_files",
            input: { pattern: "test" },
            output: "results",
            durationMs: 50,
          },
        ],
      });

      const result = validateTaskCompletion(run);

      expect(result.valid).toBe(true);
      expect(result.taskClassification).toBe("docs-only");
    });

    it("allows completion when modifying only docs without code-modifying tools", () => {
      // This represents a docs-only task where the agent didn't use
      // write_file but somehow documentation was changed (e.g., by git)
      const run = createRun({
        toolCalls: [
          {
            turn: 1,
            tool: "read_file",
            input: { path: "README.md" },
            output: "contents",
            durationMs: 100,
          },
        ],
      });

      const result = validateTaskCompletion(run);

      expect(result.valid).toBe(true);
      expect(result.taskClassification).toBe("docs-only");
    });
  });

  describe("Code-classified tasks (made code-modifying calls)", () => {
    it("allows completion when code files are modified", () => {
      const run = createRun({
        toolCalls: [
          {
            turn: 1,
            tool: "write_file",
            input: { path: "src/index.ts", content: "code" },
            output: "File written",
            durationMs: 100,
          },
        ],
      });

      const result = validateTaskCompletion(run);

      expect(result.valid).toBe(true);
      expect(result.taskClassification).toBe("code");
      expect(result.codeFiles).toEqual(["src/index.ts"]);
    });

    it("rejects completion when write_file was used but only docs changed", () => {
      const run = createRun({
        toolCalls: [
          {
            turn: 1,
            tool: "write_file",
            input: { path: "README.md", content: "docs" },
            output: "File written",
            durationMs: 100,
          },
        ],
      });

      const result = validateTaskCompletion(run);

      expect(result.valid).toBe(false);
      expect(result.taskClassification).toBe("code");
      expect(result.codeFiles).toEqual([]);
      expect(result.reason).toMatch(/Code-modifying tool calls were made/);
      expect(result.reason).toMatch(/zero code files were changed/);
    });

    it("rejects completion when write_file was used but only config changed", () => {
      const run = createRun({
        toolCalls: [
          {
            turn: 1,
            tool: "write_file",
            input: { path: "package.json", content: '{"name":"test"}' },
            output: "File written",
            durationMs: 100,
          },
        ],
      });

      const result = validateTaskCompletion(run);

      expect(result.valid).toBe(false);
      expect(result.taskClassification).toBe("code");
      expect(result.codeFiles).toEqual([]);
    });

    it("rejects completion when git was used but only docs changed", () => {
      const run = createRun({
        toolCalls: [
          {
            turn: 1,
            tool: "write_file",
            input: { path: "CHANGELOG.md", content: "changelog" },
            output: "File written",
            durationMs: 100,
          },
          {
            turn: 2,
            tool: "git",
            input: { args: ["add", "CHANGELOG.md"] },
            output: "Added to staging",
            durationMs: 50,
          },
        ],
      });

      const result = validateTaskCompletion(run);

      expect(result.valid).toBe(false);
      expect(result.taskClassification).toBe("code");
      expect(result.codeFiles).toEqual([]);
    });

    it("allows completion when mix of code and docs files changed", () => {
      const run = createRun({
        toolCalls: [
          {
            turn: 1,
            tool: "write_file",
            input: { path: "src/feature.ts", content: "code" },
            output: "File written",
            durationMs: 100,
          },
          {
            turn: 1,
            tool: "write_file",
            input: { path: "CHANGELOG.md", content: "changelog" },
            output: "File written",
            durationMs: 100,
          },
        ],
      });

      const result = validateTaskCompletion(run);

      expect(result.valid).toBe(true);
      expect(result.taskClassification).toBe("code");
      expect(result.codeFiles).toEqual(["src/feature.ts"]);
    });

    it("rejects completion when run_command was used but no code files changed", () => {
      const run = createRun({
        toolCalls: [
          {
            turn: 1,
            tool: "run_command",
            input: { command: "npm run docs" },
            output: "Built docs",
            durationMs: 1000,
          },
        ],
      });

      const result = validateTaskCompletion(run);

      expect(result.valid).toBe(false);
      expect(result.taskClassification).toBe("code");
      expect(result.reason).toMatch(/Code-modifying tool calls were made/);
    });

    it("detects code files correctly (test files are not code)", () => {
      const run = createRun({
        toolCalls: [
          {
            turn: 1,
            tool: "write_file",
            input: { path: "src/feature.test.ts", content: "test" },
            output: "File written",
            durationMs: 100,
          },
        ],
      });

      const result = validateTaskCompletion(run);

      expect(result.valid).toBe(false);
      expect(result.codeFiles).toEqual([]);
    });

    it("detects PRD metadata files correctly", () => {
      const run = createRun({
        toolCalls: [
          {
            turn: 1,
            tool: "rex_update_status",
            input: { status: "completed" },
            output: "Status updated",
            durationMs: 100,
          },
        ],
      });

      const result = validateTaskCompletion(run);

      expect(result.valid).toBe(false);
      expect(result.taskClassification).toBe("code");
      expect(result.codeFiles).toEqual([]);
    });

    it("includes error message with actionable guidance", () => {
      const run = createRun({
        toolCalls: [
          {
            turn: 1,
            tool: "write_file",
            input: { path: "docs/guide.md", content: "guide" },
            output: "File written",
            durationMs: 100,
          },
        ],
      });

      const result = validateTaskCompletion(run);

      expect(result.reason).toBeDefined();
      expect(result.reason).toMatch(/ensure all changes are documentation/);
    });
  });

  describe("Classification of various file types", () => {
    it("classifies .ts/.js files as code", () => {
      const run = createRun({
        toolCalls: [
          {
            turn: 1,
            tool: "write_file",
            input: { path: "src/utils.ts", content: "code" },
            output: "Written",
            durationMs: 50,
          },
        ],
      });

      const result = validateTaskCompletion(run);
      expect(result.codeFiles).toEqual(["src/utils.ts"]);
      expect(result.valid).toBe(true);
    });

    it("classifies .jsx/.tsx files as code", () => {
      const run = createRun({
        toolCalls: [
          {
            turn: 1,
            tool: "write_file",
            input: { path: "src/Button.tsx", content: "component" },
            output: "Written",
            durationMs: 50,
          },
        ],
      });

      const result = validateTaskCompletion(run);
      expect(result.codeFiles).toEqual(["src/Button.tsx"]);
      expect(result.valid).toBe(true);
    });

    it("classifies .py files as code", () => {
      const run = createRun({
        toolCalls: [
          {
            turn: 1,
            tool: "write_file",
            input: { path: "script.py", content: "python code" },
            output: "Written",
            durationMs: 50,
          },
        ],
      });

      const result = validateTaskCompletion(run);
      expect(result.codeFiles).toEqual(["script.py"]);
      expect(result.valid).toBe(true);
    });

    it("classifies .md files as docs (not code)", () => {
      const run = createRun({
        toolCalls: [
          {
            turn: 1,
            tool: "write_file",
            input: { path: "README.md", content: "documentation" },
            output: "Written",
            durationMs: 50,
          },
        ],
      });

      const result = validateTaskCompletion(run);
      expect(result.codeFiles).toEqual([]);
      expect(result.valid).toBe(false);
    });

    it("classifies .json files as config (not code)", () => {
      const run = createRun({
        toolCalls: [
          {
            turn: 1,
            tool: "write_file",
            input: { path: "config.json", content: "{}" },
            output: "Written",
            durationMs: 50,
          },
        ],
      });

      const result = validateTaskCompletion(run);
      expect(result.codeFiles).toEqual([]);
      expect(result.valid).toBe(false);
    });

    it("classifies .test.ts files as test (not code)", () => {
      const run = createRun({
        toolCalls: [
          {
            turn: 1,
            tool: "write_file",
            input: { path: "src/feature.test.ts", content: "test code" },
            output: "Written",
            durationMs: 50,
          },
        ],
      });

      const result = validateTaskCompletion(run);
      expect(result.codeFiles).toEqual([]);
      expect(result.valid).toBe(false);
    });

    it("classifies files in /tests/ directory as test (not code)", () => {
      const run = createRun({
        toolCalls: [
          {
            turn: 1,
            tool: "write_file",
            input: { path: "tests/unit/utils.ts", content: "test code" },
            output: "Written",
            durationMs: 50,
          },
        ],
      });

      const result = validateTaskCompletion(run);
      expect(result.codeFiles).toEqual([]);
      expect(result.valid).toBe(false);
    });

    it("classifies .rex/ files as metadata (not code)", () => {
      const run = createRun({
        toolCalls: [
          {
            turn: 1,
            tool: "write_file",
            input: { path: ".rex/prd_tree/item/index.md", content: "metadata" },
            output: "Written",
            durationMs: 50,
          },
        ],
      });

      const result = validateTaskCompletion(run);
      expect(result.codeFiles).toEqual([]);
      expect(result.valid).toBe(false);
    });
  });
});
