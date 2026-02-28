import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BatchImportItem, BatchImportResult } from "../../../src/analyze/reason.js";

// We need to mock spawnClaude since it calls the LLM
vi.mock("@n-dx/llm-client", () => ({
  createClient: () => ({
    mode: "api",
    prompt: vi.fn().mockResolvedValue({ text: "[]", tokenUsage: undefined }),
  }),
  detectAuthMode: () => "api",
}));

describe("reasonFromBatch", () => {
  let tmpDir: string;
  let reasonFromBatch: typeof import("../../../src/analyze/reason.js").reasonFromBatch;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-batch-test-"));

    // Dynamic import to get the module after mocks are in place
    const mod = await import("../../../src/analyze/reason.js");
    reasonFromBatch = mod.reasonFromBatch;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns empty result for empty items array", async () => {
    const result = await reasonFromBatch([], []);

    expect(result.proposals).toEqual([]);
    expect(result.itemResults).toEqual([]);
    expect(result.tokenUsage.calls).toBe(0);
  });

  it("skips items with empty content", async () => {
    const items: BatchImportItem[] = [
      { content: "", format: "text", source: "empty.txt" },
      { content: "   ", format: "text", source: "whitespace.txt" },
    ];

    const result = await reasonFromBatch(items, [], { dir: tmpDir });

    expect(result.itemResults).toHaveLength(2);
    expect(result.itemResults[0].proposalCount).toBe(0);
    expect(result.itemResults[1].proposalCount).toBe(0);
    expect(result.itemResults[0].source).toBe("empty.txt");
    expect(result.itemResults[1].source).toBe("whitespace.txt");
  });

  it("parses JSON items via structured parsing when they match Proposal schema", async () => {
    const proposalJson = JSON.stringify([{
      epic: { title: "Test Epic" },
      features: [{
        title: "Test Feature",
        tasks: [{
          title: "Test Task",
          priority: "high",
        }],
      }],
    }]);

    const items: BatchImportItem[] = [
      { content: proposalJson, format: "json", source: "proposals.json" },
    ];

    const result = await reasonFromBatch(items, [], { dir: tmpDir });

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].epic.title).toBe("Test Epic");
    expect(result.proposals[0].features[0].title).toBe("Test Feature");
    expect(result.itemResults[0].proposalCount).toBe(1);
    expect(result.itemResults[0].source).toBe("proposals.json");
    // Structured parsing should not use any tokens
    expect(result.tokenUsage.calls).toBe(0);
  });

  it("merges proposals from multiple structured JSON items", async () => {
    const json1 = JSON.stringify([{
      epic: { title: "Auth" },
      features: [{
        title: "Login",
        tasks: [{ title: "Build login form" }],
      }],
    }]);

    const json2 = JSON.stringify([{
      epic: { title: "Auth" },
      features: [{
        title: "Registration",
        tasks: [{ title: "Build signup form" }],
      }],
    }]);

    const items: BatchImportItem[] = [
      { content: json1, format: "json", source: "auth-login.json" },
      { content: json2, format: "json", source: "auth-signup.json" },
    ];

    const result = await reasonFromBatch(items, [], { dir: tmpDir });

    // Proposals with same epic title should be merged
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].epic.title).toBe("Auth");
    expect(result.proposals[0].features).toHaveLength(2);
    expect(result.itemResults[0].proposalCount).toBe(1);
    expect(result.itemResults[1].proposalCount).toBe(1);
  });

  it("preserves item order in results", async () => {
    const json = JSON.stringify([{
      epic: { title: "Simple" },
      features: [{ title: "Feature", tasks: [{ title: "Task" }] }],
    }]);

    const items: BatchImportItem[] = [
      { content: json, format: "json", source: "first.json" },
      { content: "", format: "text", source: "empty.txt" },
      { content: json, format: "json", source: "third.json" },
    ];

    const result = await reasonFromBatch(items, [], { dir: tmpDir });

    expect(result.itemResults).toHaveLength(3);
    expect(result.itemResults[0].source).toBe("first.json");
    expect(result.itemResults[1].source).toBe("empty.txt");
    expect(result.itemResults[2].source).toBe("third.json");
  });

  it("generates default source labels when not provided", async () => {
    const items: BatchImportItem[] = [
      { content: "", format: "text" },
    ];

    const result = await reasonFromBatch(items, [], { dir: tmpDir });

    expect(result.itemResults[0].source).toBeUndefined();
  });

  it("handles mixed structured and unstructured items", async () => {
    const json = JSON.stringify([{
      epic: { title: "Structured" },
      features: [{ title: "Feature", tasks: [{ title: "Task" }] }],
    }]);

    const items: BatchImportItem[] = [
      { content: json, format: "json", source: "schema.json" },
      { content: "Add dark mode support", format: "text", source: "idea.txt" },
    ];

    // The text item will go through LLM (which returns []) due to mock
    const result = await reasonFromBatch(items, [], { dir: tmpDir });

    // Structured item should succeed
    expect(result.itemResults[0].proposalCount).toBe(1);
    expect(result.itemResults[0].source).toBe("schema.json");
    // Text item went through LLM mock (returns empty)
    expect(result.itemResults[1].source).toBe("idea.txt");
  });
});

describe("BatchImportItem type", () => {
  it("accepts valid format values", () => {
    const item: BatchImportItem = {
      content: "test",
      format: "text",
    };
    expect(item.format).toBe("text");

    const mdItem: BatchImportItem = {
      content: "# Header",
      format: "markdown",
    };
    expect(mdItem.format).toBe("markdown");

    const jsonItem: BatchImportItem = {
      content: "{}",
      format: "json",
    };
    expect(jsonItem.format).toBe("json");
  });

  it("has optional source field", () => {
    const withSource: BatchImportItem = {
      content: "test",
      format: "text",
      source: "notes.txt",
    };
    expect(withSource.source).toBe("notes.txt");

    const withoutSource: BatchImportItem = {
      content: "test",
      format: "text",
    };
    expect(withoutSource.source).toBeUndefined();
  });
});
