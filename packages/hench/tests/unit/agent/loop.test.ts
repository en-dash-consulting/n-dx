import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureHenchDir, initConfig } from "../../../src/store/config.js";

describe("agentLoop", () => {
  let projectDir: string;
  let henchDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-test-loop-"));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);

    // Create minimal .rex/ for store
    const rexDir = join(projectDir, ".rex");
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
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("dry run prints brief without API calls", async () => {
    // Dynamic import to avoid loading Anthropic SDK at module level
    const { agentLoop } = await import("../../../src/agent/lifecycle/loop.js");
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../../src/store/config.js");

    const config = await loadConfig(henchDir);
    const rexDir = join(projectDir, ".rex");
    const store = createStore("file", rexDir);

    const consoleSpy = vi.spyOn(console, "log");

    const result = await agentLoop({
      config,
      store,
      projectDir,
      henchDir,
      dryRun: true,
    });

    expect(result.run.status).toBe("completed");
    expect(result.run.turns).toBe(0);
    expect(result.run.summary).toContain("Dry run");
    expect(result.run.tokenUsage.input).toBe(0);
    expect(result.run.tokenUsage.output).toBe(0);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Dry Run"),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Test task"),
    );

    consoleSpy.mockRestore();
  });

  it("fails without API key in non-dry-run mode", async () => {
    const { agentLoop } = await import("../../../src/agent/lifecycle/loop.js");
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../../src/store/config.js");

    const config = await loadConfig(henchDir);
    const rexDir = join(projectDir, ".rex");
    const store = createStore("file", rexDir);

    // Ensure the env var is not set
    const origKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      await expect(
        agentLoop({ config, store, projectDir, henchDir }),
      ).rejects.toThrow("API key not found");
    } finally {
      if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
    }
  });

  it("removes SIGINT handler after run completes", async () => {
    const { agentLoop } = await import("../../../src/agent/lifecycle/loop.js");
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../../src/store/config.js");

    const config = await loadConfig(henchDir);
    const rexDir = join(projectDir, ".rex");
    const store = createStore("file", rexDir);

    const origKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key-12345";

    try {
      // Count listeners before
      const listenersBefore = process.listenerCount("SIGINT");

      // Run dry run (no API calls, quick completion)
      await agentLoop({
        config,
        store,
        projectDir,
        henchDir,
        dryRun: true,
      });

      // Count listeners after
      const listenersAfter = process.listenerCount("SIGINT");

      // Should be same as before (handler was removed)
      expect(listenersAfter).toBe(listenersBefore);
    } finally {
      if (origKey) {
        process.env.ANTHROPIC_API_KEY = origKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
  });

  it("sends cache breakpoints and records cache tokens across turns", async () => {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const { agentLoop } = await import("../../../src/agent/lifecycle/loop.js");
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../../src/store/config.js");

    const config = await loadConfig(henchDir);
    const store = createStore("file", join(projectDir, ".rex"));

    const usage = {
      input_tokens: 120,
      output_tokens: 40,
      cache_creation_input_tokens: 900,
      cache_read_input_tokens: 800,
    };
    // Turn 1 truncates, so the loop appends a continuation message and re-sends
    // without executing any tools; turn 2 ends the run.
    const responses = [
      {
        id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "Reading the files." }],
        stop_reason: "max_tokens", stop_sequence: null, usage,
      },
      {
        id: "msg_2", type: "message", role: "assistant", model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "Done." }],
        stop_reason: "end_turn", stop_sequence: null, usage,
      },
    ];

    const messagesProto = Object.getPrototypeOf(new Anthropic({ apiKey: "test" }).messages);
    let call = 0;
    const spy = vi
      .spyOn(messagesProto, "create")
      .mockImplementation(async () => responses[call++]);

    const origKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key-12345";

    try {
      const result = await agentLoop({
        // Plan-only re-prompting would add a third turn; this test is about the
        // request body, not completion policy.
        config: { ...config, planOnlyMaxRetries: 0 },
        store,
        projectDir,
        henchDir,
        maxTurns: 3,
      });

      expect(spy).toHaveBeenCalledTimes(2);
      const [first] = spy.mock.calls[0] as [any];
      const [second] = spy.mock.calls[1] as [any];

      // Stable prefix: the system block carries an ephemeral breakpoint, which
      // covers the tool definitions because tools precede system in the prompt.
      expect(first.system).toEqual([
        { type: "text", text: expect.any(String), cache_control: { type: "ephemeral" } },
      ]);
      expect(first.tools.length).toBeGreaterThan(0);

      // Trailing boundary: the last block of the last message is marked.
      const firstTail = first.messages.at(-1).content;
      expect(firstTail.at(-1).cache_control).toEqual({ type: "ephemeral" });

      // The second turn repeats the first turn's prefix verbatim.
      expect(JSON.stringify(second.system)).toBe(JSON.stringify(first.system));
      expect(JSON.stringify(second.tools)).toBe(JSON.stringify(first.tools));
      const strip = (v: unknown) =>
        JSON.stringify(v, (k, val) => (k === "cache_control" ? undefined : val));
      expect(strip(second.messages.slice(0, first.messages.length))).toBe(
        strip(first.messages),
      );
      const secondTail = second.messages.at(-1).content;
      expect(secondTail.at(-1).cache_control).toEqual({ type: "ephemeral" });

      // Cache tokens reach the run record, which is what `ndx usage` reads.
      expect(result.run.tokenUsage.cacheCreationInput).toBe(1800);
      expect(result.run.tokenUsage.cacheReadInput).toBe(1600);
      expect(result.run.turnTokenUsage?.[0].cacheCreationInput).toBe(900);
      expect(result.run.turnTokenUsage?.[0].cacheReadInput).toBe(800);
    } finally {
      spy.mockRestore();
      if (origKey) {
        process.env.ANTHROPIC_API_KEY = origKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
  });

  it("resets task to pending on cancellation", async () => {
    // Test that when a run is cancelled (SIGINT), the task is reset from in_progress to pending
    const { finalizeRun } = await import("../../../src/agent/lifecycle/shared.js");
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const rexDir = join(projectDir, ".rex");
    const store = createStore("file", rexDir);

    // Transition task to in_progress first
    await store.updateItem("task-1", { status: "in_progress" });
    let item = await store.getItem("task-1");
    expect(item.status).toBe("in_progress");

    // Create a cancelled run
    const run: any = {
      id: "run-1",
      taskId: "task-1",
      taskTitle: "Test task",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: "cancelled",
      turns: 1,
      tokenUsage: { input: 100, output: 50 },
      turnTokenUsage: [],
      toolCalls: [],
      model: "claude-3-5-sonnet-20241022",
    };

    // Finalize the run with cancelled status
    await finalizeRun({
      run,
      henchDir,
      projectDir,
      store,
      rollbackOnFailure: false, // Skip rollback for this test
      yes: true, // Non-interactive
    });

    // Verify task was reset to pending despite cancellation
    item = await store.getItem("task-1");
    expect(item.status).toBe("pending");
  });
});
