import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Anthropic from "@anthropic-ai/sdk";
import { initConfig } from "../../../src/store/config.js";

/**
 * Tests that the API agentLoop properly handles task failures:
 * - Failed tasks marked as deferred (not left in_progress)
 * - Error summary logged clearly
 * - Budget exceeded tasks marked as pending (recoverable)
 */

async function setupProjectDir(): Promise<{
  projectDir: string;
  henchDir: string;
  rexDir: string;
}> {
  const projectDir = await mkdtemp(join(tmpdir(), "hench-test-failure-"));
  const henchDir = join(projectDir, ".hench");
  const rexDir = join(projectDir, ".rex");

  await initConfig(henchDir);
  await mkdir(rexDir, { recursive: true });

  await writeFile(
    join(rexDir, "config.json"),
    JSON.stringify({
      schema: "rex/v1",
      project: "test",
      adapter: "file",
    }),
    "utf-8",
  );

  await writeFile(
    join(rexDir, "prd.json"),
    JSON.stringify({
      schema: "rex/v1",
      title: "Test",
      items: [
        {
          id: "task-1",
          title: "Test task",
          status: "pending",
          level: "task",
          priority: "high",
        },
      ],
    }),
    "utf-8",
  );

  await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");

  return { projectDir, henchDir, rexDir };
}

function readPrdTask(rexDir: string) {
  return readFile(join(rexDir, "prd.json"), "utf-8").then((raw) => {
    const prd = JSON.parse(raw);
    return prd.items.find((i: { id: string }) => i.id === "task-1");
  });
}

function readLogEvents(rexDir: string) {
  return readFile(join(rexDir, "execution-log.jsonl"), "utf-8").then((raw) =>
    raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  );
}

// Get the Messages prototype for mocking
const messagesProto = Object.getPrototypeOf(
  new Anthropic({ apiKey: "test" }).messages,
);

describe("API loop task failure handling", () => {
  let projectDir: string;
  let henchDir: string;
  let rexDir: string;

  beforeEach(async () => {
    ({ projectDir, henchDir, rexDir } = await setupProjectDir());
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("marks task as deferred on uncaught exception and logs error", async () => {
    const { agentLoop } = await import("../../../src/agent/lifecycle/loop.js");
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../../src/store/config.js");

    const config = await loadConfig(henchDir);
    const store = createStore("file", rexDir);

    // Set a fake API key — the API call will fail with an auth error (non-transient)
    const origKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key-fake";

    try {
      const result = await agentLoop({ config, store, projectDir, henchDir });

      // Run should be marked failed
      expect(result.run.status).toBe("failed");
      expect(result.run.error).toBeDefined();

      // Task must NOT be left in_progress — should be deferred
      const task = await readPrdTask(rexDir);
      expect(task.status).toBe("deferred");

      // Error should be logged
      const events = await readLogEvents(rexDir);
      const failEvent = events.find(
        (e: { event: string; itemId: string }) =>
          e.event === "task_failed" && e.itemId === "task-1",
      );
      expect(failEvent).toBeDefined();
      expect(failEvent.detail).toBeDefined();
      expect(failEvent.detail.length).toBeGreaterThan(0);
    } finally {
      if (origKey) {
        process.env.ANTHROPIC_API_KEY = origKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
  });

  it("marks task as deferred on timeout and logs error", async () => {
    // Mock Anthropic SDK to return tool_use every turn (forcing timeout at maxTurns=1)
    vi.spyOn(messagesProto, "create").mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "tool-1",
          name: "read_file",
          input: { path: "test.txt" },
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    // Mock dispatchTool to avoid real tool execution
    const toolsModule = await import("../../../src/agent/tools.js");
    vi.spyOn(toolsModule, "dispatchTool").mockResolvedValue("ok");

    const { agentLoop } = await import("../../../src/agent/lifecycle/loop.js");
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../../src/store/config.js");

    const config = await loadConfig(henchDir);
    const store = createStore("file", rexDir);

    const origKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key-fake";

    try {
      const result = await agentLoop({
        config,
        store,
        projectDir,
        henchDir,
        maxTurns: 1, // Force timeout after 1 turn
      });

      expect(result.run.status).toBe("timeout");
      expect(result.run.error).toContain("max turns");

      // Task must be deferred, not left in_progress
      const task = await readPrdTask(rexDir);
      expect(task.status).toBe("deferred");

      // Error logged
      const events = await readLogEvents(rexDir);
      const failEvent = events.find(
        (e: { event: string; itemId: string }) =>
          e.event === "task_failed" && e.itemId === "task-1",
      );
      expect(failEvent).toBeDefined();
      expect(failEvent.detail).toContain("max turns");
    } finally {
      if (origKey) {
        process.env.ANTHROPIC_API_KEY = origKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
  });

  it("marks task as pending on budget exceeded and logs error", async () => {
    // Mock Anthropic to return a response with high token usage
    // Budget check happens before stop_reason processing
    vi.spyOn(messagesProto, "create").mockResolvedValue({
      content: [{ type: "text", text: "Done" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 5000, output_tokens: 5000 },
    });

    const { agentLoop } = await import("../../../src/agent/lifecycle/loop.js");
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../../src/store/config.js");

    const config = await loadConfig(henchDir);
    const store = createStore("file", rexDir);

    const origKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key-fake";

    try {
      const result = await agentLoop({
        config,
        store,
        projectDir,
        henchDir,
        tokenBudget: 100, // Very low budget — will be exceeded immediately
      });

      expect(result.run.status).toBe("budget_exceeded");

      // Budget exceeded is recoverable — task goes to pending
      const task = await readPrdTask(rexDir);
      expect(task.status).toBe("pending");

      // budget_exceeded event logged
      const events = await readLogEvents(rexDir);
      const budgetEvent = events.find(
        (e: { event: string; itemId: string }) =>
          e.event === "budget_exceeded" && e.itemId === "task-1",
      );
      expect(budgetEvent).toBeDefined();
    } finally {
      if (origKey) {
        process.env.ANTHROPIC_API_KEY = origKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
  });
});
