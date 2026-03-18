import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initConfig } from "../../../src/store/config.js";
import { toolRexUpdateStatus } from "../../../src/tools/rex.js";

/**
 * Tests that both agentLoop and cliLoop atomically transition
 * the task to in_progress before starting work.
 */

async function setupProjectDir(): Promise<{ projectDir: string; henchDir: string; rexDir: string }> {
  const projectDir = await mkdtemp(join(tmpdir(), "hench-test-atomic-"));
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

  await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");

  return { projectDir, henchDir, rexDir };
}

function mockStore() {
  return {
    updateItem: vi.fn().mockResolvedValue(undefined),
    appendLog: vi.fn().mockResolvedValue(undefined),
    addItem: vi.fn().mockResolvedValue(undefined),
    loadDocument: vi.fn(),
    saveDocument: vi.fn(),
    getItem: vi.fn(),
    removeItem: vi.fn(),
    loadConfig: vi.fn(),
    saveConfig: vi.fn(),
    readLog: vi.fn(),
    loadWorkflow: vi.fn(),
    saveWorkflow: vi.fn(),
    capabilities: vi.fn(),
  };
}

describe("atomic task state transitions", () => {
  describe("agentLoop (file store integration)", () => {
    let projectDir: string;
    let henchDir: string;
    let rexDir: string;

    beforeEach(async () => {
      ({ projectDir, henchDir, rexDir } = await setupProjectDir());
    });

    afterEach(async () => {
      await rm(projectDir, { recursive: true, force: true });
    });

    it("transitions pending task to in_progress before API calls, then deferred on failure", async () => {
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

      const { agentLoop } = await import("../../../src/agent/lifecycle/loop.js");
      const { createStore } = await import("@n-dx/rex/dist/store/index.js");
      const { loadConfig } = await import("../../../src/store/config.js");

      const config = await loadConfig(henchDir);
      const store = createStore("file", rexDir);

      // Set a fake API key so we get past the env check
      const origKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = "test-key-fake";

      try {
        // The API call will fail with auth error — task should be deferred (not left in_progress)
        const result = await agentLoop({ config, store, projectDir, henchDir });

        expect(result.run.status).toBe("failed");

        // Read the PRD back — task should be deferred after failure handling
        const prd = JSON.parse(await readFile(join(rexDir, "prd.json"), "utf-8"));
        const task = prd.items.find((i: { id: string }) => i.id === "task-1");
        expect(task.status).toBe("deferred");
        expect(task.startedAt).toBeDefined();
      } finally {
        if (origKey) {
          process.env.ANTHROPIC_API_KEY = origKey;
        } else {
          delete process.env.ANTHROPIC_API_KEY;
        }
      }
    });

    it("preserves startedAt for already in_progress task that fails", async () => {
      const existingStartedAt = "2025-06-01T00:00:00.000Z";
      await writeFile(
        join(rexDir, "prd.json"),
        JSON.stringify({
          schema: "rex/v1",
          title: "Test",
          items: [
            {
              id: "task-1",
              title: "Resumed task",
              status: "in_progress",
              level: "task",
              priority: "high",
              startedAt: existingStartedAt,
            },
          ],
        }),
        "utf-8",
      );

      const { agentLoop } = await import("../../../src/agent/lifecycle/loop.js");
      const { createStore } = await import("@n-dx/rex/dist/store/index.js");
      const { loadConfig } = await import("../../../src/store/config.js");

      const config = await loadConfig(henchDir);
      const store = createStore("file", rexDir);

      const origKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = "test-key-fake";

      try {
        // Task starts as in_progress — no re-transition happens.
        // On failure it moves to deferred, but startedAt is preserved.
        const result = await agentLoop({ config, store, projectDir, henchDir });

        expect(result.run.status).toBe("failed");

        const prd = JSON.parse(await readFile(join(rexDir, "prd.json"), "utf-8"));
        const task = prd.items.find((i: { id: string }) => i.id === "task-1");
        expect(task.status).toBe("deferred");
        expect(task.startedAt).toBe(existingStartedAt);
      } finally {
        if (origKey) {
          process.env.ANTHROPIC_API_KEY = origKey;
        } else {
          delete process.env.ANTHROPIC_API_KEY;
        }
      }
    });

    it("does not transition status on dry run", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        JSON.stringify({
          schema: "rex/v1",
          title: "Test",
          items: [
            {
              id: "task-1",
              title: "Dry run task",
              status: "pending",
              level: "task",
              priority: "high",
            },
          ],
        }),
        "utf-8",
      );

      const { agentLoop } = await import("../../../src/agent/lifecycle/loop.js");
      const { createStore } = await import("@n-dx/rex/dist/store/index.js");
      const { loadConfig } = await import("../../../src/store/config.js");

      const config = await loadConfig(henchDir);
      const store = createStore("file", rexDir);

      vi.spyOn(console, "log").mockImplementation(() => {});

      await agentLoop({ config, store, projectDir, henchDir, dryRun: true });

      // Task should still be pending — dry run must not mutate state
      const prd = JSON.parse(await readFile(join(rexDir, "prd.json"), "utf-8"));
      const task = prd.items.find((i: { id: string }) => i.id === "task-1");
      expect(task.status).toBe("pending");

      vi.restoreAllMocks();
    });
  });

  describe("cliLoop (file store integration)", () => {
    let projectDir: string;
    let henchDir: string;
    let rexDir: string;

    beforeEach(async () => {
      ({ projectDir, henchDir, rexDir } = await setupProjectDir());
    });

    afterEach(async () => {
      await rm(projectDir, { recursive: true, force: true });
    });

    it("does not transition status on dry run", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        JSON.stringify({
          schema: "rex/v1",
          title: "Test",
          items: [
            {
              id: "task-1",
              title: "CLI dry run task",
              status: "pending",
              level: "task",
              priority: "high",
            },
          ],
        }),
        "utf-8",
      );

      const { cliLoop } = await import("../../../src/agent/lifecycle/cli-loop.js");
      const { createStore } = await import("@n-dx/rex/dist/store/index.js");
      const { loadConfig } = await import("../../../src/store/config.js");

      const config = await loadConfig(henchDir);
      const store = createStore("file", rexDir);

      vi.spyOn(console, "log").mockImplementation(() => {});

      await cliLoop({ config, store, projectDir, henchDir, dryRun: true });

      // Task should still be pending — dry run must not mutate state
      const prd = JSON.parse(await readFile(join(rexDir, "prd.json"), "utf-8"));
      const task = prd.items.find((i: { id: string }) => i.id === "task-1");
      expect(task.status).toBe("pending");

      vi.restoreAllMocks();
    });
  });

  describe("toolRexUpdateStatus idempotency", () => {
    it("transitions pending to in_progress with startedAt", async () => {
      const store = mockStore();
      store.getItem.mockResolvedValue({
        id: "task-1",
        title: "Test",
        status: "pending",
        level: "task",
      });

      await toolRexUpdateStatus(store, "task-1", { status: "in_progress" });

      expect(store.updateItem).toHaveBeenCalledWith(
        "task-1",
        expect.objectContaining({
          status: "in_progress",
          startedAt: expect.any(String),
        }),
      );
    });

    it("re-transition from in_progress to in_progress preserves startedAt", async () => {
      const store = mockStore();
      store.getItem.mockResolvedValue({
        id: "task-1",
        title: "Test",
        status: "in_progress",
        level: "task",
        startedAt: "2025-06-01T00:00:00.000Z",
      });

      await toolRexUpdateStatus(store, "task-1", { status: "in_progress" });

      // The computeTimestampUpdates function handles this — it should not
      // overwrite an existing startedAt when the task is already in_progress.
      const updateCall = store.updateItem.mock.calls[0][1];
      expect(updateCall.status).toBe("in_progress");
      // startedAt should not be reset (either undefined or same value)
      if (updateCall.startedAt) {
        expect(updateCall.startedAt).toBe("2025-06-01T00:00:00.000Z");
      }
    });

    it("sets completedAt when transitioning to completed", async () => {
      const store = mockStore();
      store.getItem.mockResolvedValue({
        id: "task-1",
        title: "Test",
        status: "in_progress",
        level: "task",
        startedAt: "2025-06-01T00:00:00.000Z",
      });
      store.loadDocument.mockResolvedValue({
        schema: "rex/v1",
        title: "Test",
        items: [],
      });

      await toolRexUpdateStatus(store, "task-1", { status: "completed" });

      expect(store.updateItem).toHaveBeenCalledWith(
        "task-1",
        expect.objectContaining({
          status: "completed",
          completedAt: expect.any(String),
        }),
      );
    });

    it("does not overwrite startedAt when transitioning to deferred", async () => {
      const existingStartedAt = "2025-06-01T00:00:00.000Z";
      const store = mockStore();
      const taskItem = {
        id: "task-1",
        title: "Test",
        status: "in_progress",
        level: "task",
        startedAt: existingStartedAt,
      };
      store.getItem.mockResolvedValue(taskItem);
      // loadDocument is called for parent auto-completion checks
      store.loadDocument.mockResolvedValue({
        schema: "rex/v1",
        title: "Test",
        items: [taskItem],
      });

      await toolRexUpdateStatus(store, "task-1", { status: "deferred" });

      const updateCall = store.updateItem.mock.calls[0][1];
      expect(updateCall.status).toBe("deferred");
      // startedAt should not be included in the update (preserved)
      expect(updateCall.startedAt).toBeUndefined();
    });

    it("sets startedAt when completing a pending task directly", async () => {
      const store = mockStore();
      store.getItem.mockResolvedValue({
        id: "task-1",
        title: "Test",
        status: "pending",
        level: "task",
      });
      store.loadDocument.mockResolvedValue({
        schema: "rex/v1",
        title: "Test",
        items: [],
      });

      await toolRexUpdateStatus(store, "task-1", { status: "completed" });

      expect(store.updateItem).toHaveBeenCalledWith(
        "task-1",
        expect.objectContaining({
          status: "completed",
          startedAt: expect.any(String),
          completedAt: expect.any(String),
        }),
      );
    });
  });
});
