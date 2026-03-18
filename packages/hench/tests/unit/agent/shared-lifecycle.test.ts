import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initConfig } from "../../../src/store/config.js";

/**
 * Tests for the shared lifecycle module that extracts common validation
 * and orchestration logic used by both API and CLI agent loops.
 *
 * These tests verify that shared functions produce identical behavior
 * regardless of which loop invokes them.
 */

describe("shared lifecycle", () => {
  let projectDir: string;
  let henchDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-test-shared-"));
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
          {
            id: "task-2",
            title: "In-progress task",
            status: "in_progress",
            level: "task",
            priority: "medium",
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

  describe("prepareBrief", () => {
    it("assembles brief, formats text, builds system prompt, and displays task info", async () => {
      const { prepareBrief } = await import("../../../src/agent/lifecycle/shared.js");
      const { createStore } = await import("@n-dx/rex/dist/store/index.js");
      const { loadConfig } = await import("../../../src/store/config.js");

      const config = await loadConfig(henchDir);
      const rexDir = join(projectDir, ".rex");
      const store = createStore("file", rexDir);

      const consoleSpy = vi.spyOn(console, "log");

      const result = await prepareBrief(store, config, "task-1");

      expect(result.brief.task.id).toBe("task-1");
      expect(result.brief.task.title).toBe("Test task");
      expect(result.taskId).toBe("task-1");
      expect(result.briefText).toContain("Test task");
      expect(result.systemPrompt).toBeTruthy();

      // displayTaskInfo should have been called
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Test task"),
      );

      consoleSpy.mockRestore();
    });

    it("auto-selects a task when no taskId is provided", async () => {
      const { prepareBrief } = await import("../../../src/agent/lifecycle/shared.js");
      const { createStore } = await import("@n-dx/rex/dist/store/index.js");
      const { loadConfig } = await import("../../../src/store/config.js");

      const config = await loadConfig(henchDir);
      const rexDir = join(projectDir, ".rex");
      const store = createStore("file", rexDir);

      vi.spyOn(console, "log");

      const result = await prepareBrief(store, config);

      // Should have selected one of the tasks
      expect(result.taskId).toBeTruthy();
      expect(result.brief.task.title).toBeTruthy();

      vi.restoreAllMocks();
    });
  });

  describe("executeDryRun", () => {
    it("creates a completed run record with zero tokens", async () => {
      const { executeDryRun } = await import("../../../src/agent/lifecycle/shared.js");

      vi.spyOn(console, "log");

      const run = executeDryRun({
        label: "API",
        briefText: "test brief",
        systemPrompt: "test prompt",
        taskId: "task-1",
        taskTitle: "Test task",
        model: "claude-sonnet-4-6",
      });

      expect(run.status).toBe("completed");
      expect(run.turns).toBe(0);
      expect(run.summary).toContain("Dry run");
      expect(run.tokenUsage.input).toBe(0);
      expect(run.tokenUsage.output).toBe(0);
      expect(run.toolCalls).toEqual([]);
      expect(run.taskId).toBe("task-1");
      expect(run.taskTitle).toBe("Test task");
      expect(run.finishedAt).toBeTruthy();

      vi.restoreAllMocks();
    });

    it("includes extra info sections when provided", async () => {
      const { executeDryRun } = await import("../../../src/agent/lifecycle/shared.js");

      const consoleSpy = vi.spyOn(console, "log");

      executeDryRun({
        label: "CLI",
        briefText: "test brief",
        systemPrompt: "test prompt",
        taskId: "task-1",
        taskTitle: "Test task",
        model: "claude-sonnet-4-6",
        extraInfo: [
          { heading: "Provider", content: "cli (claude binary)" },
        ],
      });

      // Should have printed the extra info
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Provider"),
      );

      consoleSpy.mockRestore();
    });
  });

  describe("transitionToInProgress", () => {
    it("transitions pending task to in_progress", async () => {
      const { transitionToInProgress } = await import("../../../src/agent/lifecycle/shared.js");
      const { createStore } = await import("@n-dx/rex/dist/store/index.js");

      const rexDir = join(projectDir, ".rex");
      const store = createStore("file", rexDir);

      vi.spyOn(console, "log");

      await transitionToInProgress(store, "task-1", "pending");

      // Verify the task was transitioned
      const doc = await store.loadDocument();
      const task = doc.items.find((i: { id: string }) => i.id === "task-1");
      expect(task?.status).toBe("in_progress");

      vi.restoreAllMocks();
    });

    it("skips transition for already in_progress tasks", async () => {
      const { transitionToInProgress } = await import("../../../src/agent/lifecycle/shared.js");
      const { createStore } = await import("@n-dx/rex/dist/store/index.js");

      const rexDir = join(projectDir, ".rex");
      const store = createStore("file", rexDir);

      // task-2 is already in_progress — should not throw
      await transitionToInProgress(store, "task-2", "in_progress");

      const doc = await store.loadDocument();
      const task = doc.items.find((i: { id: string }) => i.id === "task-2");
      expect(task?.status).toBe("in_progress");
    });
  });

  describe("initRunRecord", () => {
    it("creates a running run record and persists it", async () => {
      const { initRunRecord } = await import("../../../src/agent/lifecycle/shared.js");
      const { readFile } = await import("node:fs/promises");

      const { run, memoryCtx } = await initRunRecord({
        taskId: "task-1",
        taskTitle: "Test task",
        model: "claude-sonnet-4-6",
        henchDir,
      });

      expect(run.status).toBe("running");
      expect(run.taskId).toBe("task-1");
      expect(run.taskTitle).toBe("Test task");
      expect(run.model).toBe("claude-sonnet-4-6");
      expect(run.turns).toBe(0);
      expect(run.tokenUsage).toEqual({ input: 0, output: 0 });
      expect(run.toolCalls).toEqual([]);
      expect(run.turnTokenUsage).toEqual([]);
      expect(run.lastActivityAt).toBeTruthy();
      expect(run.id).toBeTruthy();

      // Verify memory context was captured
      expect(memoryCtx).toBeDefined();
      expect(typeof memoryCtx.systemTotalBytes).toBe("number");
      expect(typeof memoryCtx.systemAvailableAtStartBytes).toBe("number");

      // Verify it was persisted
      const savedFile = join(henchDir, "runs", `${run.id}.json`);
      const savedContent = await readFile(savedFile, "utf-8");
      const savedRun = JSON.parse(savedContent);
      expect(savedRun.status).toBe("running");
      expect(savedRun.taskId).toBe("task-1");
    });
  });

  describe("handleRunFailure", () => {
    it("updates task status and logs the failure", async () => {
      const { handleRunFailure } = await import("../../../src/agent/lifecycle/shared.js");
      const { createStore } = await import("@n-dx/rex/dist/store/index.js");

      const rexDir = join(projectDir, ".rex");
      const store = createStore("file", rexDir);

      // First transition to in_progress so we can defer it
      await store.updateItem("task-1", { status: "in_progress" });

      await handleRunFailure(
        store, "task-1", "deferred", "task_failed", "API error occurred",
      );

      const doc = await store.loadDocument();
      const task = doc.items.find((i: { id: string }) => i.id === "task-1");
      expect(task?.status).toBe("deferred");
    });
  });

  describe("handleBudgetExceeded", () => {
    it("sets run status and error, then updates task", async () => {
      const { handleBudgetExceeded } = await import("../../../src/agent/lifecycle/shared.js");
      const { createStore } = await import("@n-dx/rex/dist/store/index.js");
      const { randomUUID } = await import("node:crypto");

      const rexDir = join(projectDir, ".rex");
      const store = createStore("file", rexDir);

      vi.spyOn(console, "log");

      // Transition task to in_progress first
      await store.updateItem("task-1", { status: "in_progress" });

      const run = {
        id: randomUUID(),
        taskId: "task-1",
        taskTitle: "Test task",
        startedAt: new Date().toISOString(),
        status: "running" as const,
        turns: 5,
        tokenUsage: { input: 80000, output: 20000 },
        toolCalls: [],
        model: "claude-sonnet-4-6",
      };

      await handleBudgetExceeded(store, "task-1", run, 100000, 50000);

      expect(run.status).toBe("budget_exceeded");
      expect(run.error).toContain("Token budget exceeded");
      expect(run.error).toContain("100000");
      expect(run.error).toContain("50000");

      vi.restoreAllMocks();
    });
  });

  describe("dry run parity between API and CLI loops", () => {
    it("both loops produce consistent dry run results through shared module", async () => {
      const { agentLoop } = await import("../../../src/agent/lifecycle/loop.js");
      const { cliLoop } = await import("../../../src/agent/lifecycle/cli-loop.js");
      const { createStore } = await import("@n-dx/rex/dist/store/index.js");
      const { loadConfig } = await import("../../../src/store/config.js");

      const config = await loadConfig(henchDir);
      const rexDir = join(projectDir, ".rex");
      const store = createStore("file", rexDir);

      vi.spyOn(console, "log");

      const apiResult = await agentLoop({
        config,
        store,
        projectDir,
        henchDir,
        dryRun: true,
        taskId: "task-1",
      });

      const cliResult = await cliLoop({
        config,
        store,
        projectDir,
        henchDir,
        dryRun: true,
        taskId: "task-1",
      });

      // Both should produce identical structural outcomes
      expect(apiResult.run.status).toBe(cliResult.run.status);
      expect(apiResult.run.turns).toBe(cliResult.run.turns);
      expect(apiResult.run.tokenUsage.input).toBe(cliResult.run.tokenUsage.input);
      expect(apiResult.run.tokenUsage.output).toBe(cliResult.run.tokenUsage.output);
      expect(apiResult.run.toolCalls).toEqual(cliResult.run.toolCalls);
      expect(apiResult.run.taskId).toBe(cliResult.run.taskId);
      expect(apiResult.run.taskTitle).toBe(cliResult.run.taskTitle);

      // Both should include "Dry run" in summary
      expect(apiResult.run.summary).toContain("Dry run");
      expect(cliResult.run.summary).toContain("Dry run");

      vi.restoreAllMocks();
    });
  });
});
