import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { initConfig } from "../../src/store/config.js";
import type { RunRecord } from "../../src/schema/index.js";
import type { PRDStore } from "../../src/prd/rex-gateway.js";
import type { PRDItem, PRDDocument, RexConfig, LogEntry } from "rex";

/**
 * Integration tests for PRD task status reset on run failure.
 *
 * When a hench run exits with a failure status and the task is still
 * in_progress in the PRD, finalizeRun must reset it to pending so it
 * reappears as actionable without manual PRD editing.
 */

function buildMinimalRun(status: RunRecord["status"], taskId = "task-1"): RunRecord {
  return {
    id: randomUUID(),
    taskId,
    taskTitle: "Test task",
    startedAt: new Date().toISOString(),
    status,
    turns: 3,
    tokenUsage: { input: 100, output: 50 },
    turnTokenUsage: [],
    toolCalls: [],
    model: "test-model",
  };
}

function buildMockStore(initialStatus: PRDItem["status"]): {
  store: PRDStore;
  updatedStatus: () => PRDItem["status"] | undefined;
  logEntries: () => LogEntry[];
} {
  let currentStatus: PRDItem["status"] = initialStatus;
  const logs: LogEntry[] = [];

  const store: PRDStore = {
    async loadDocument(): Promise<PRDDocument> {
      return { version: 1, title: "Test", items: [] };
    },
    async saveDocument(): Promise<void> {},
    async getItem(id: string): Promise<PRDItem | null> {
      if (id !== "task-1") return null;
      return {
        id: "task-1",
        title: "Test task",
        status: currentStatus,
        level: "task",
      } as PRDItem;
    },
    async addItem(): Promise<void> {},
    async updateItem(_id: string, updates: Partial<PRDItem>): Promise<void> {
      if (updates.status) currentStatus = updates.status;
    },
    async removeItem(): Promise<void> {},
    async loadConfig(): Promise<RexConfig> {
      return {} as RexConfig;
    },
    async saveConfig(): Promise<void> {},
    async appendLog(entry: LogEntry): Promise<void> {
      logs.push(entry);
    },
    async readLog(): Promise<LogEntry[]> {
      return logs;
    },
    async loadWorkflow(): Promise<string> {
      return "";
    },
    async saveWorkflow(): Promise<void> {},
    async withTransaction<T>(fn: (doc: PRDDocument) => Promise<T>): Promise<T> {
      const doc = await this.loadDocument();
      return fn(doc);
    },
    capabilities() {
      return { adapter: "mock", supportsTransactions: false, supportsWatch: false };
    },
  };

  return {
    store,
    updatedStatus: () => currentStatus,
    logEntries: () => logs,
  };
}

describe("finalizeRun PRD task reset on failure", () => {
  let projectDir: string;
  let henchDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-prd-reset-"));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("resets task from in_progress to pending when run fails", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
    const { store, updatedStatus } = buildMockStore("in_progress");

    const run = buildMinimalRun("failed");
    await finalizeRun({ run, henchDir, projectDir, store, rollbackOnFailure: false });

    expect(updatedStatus()).toBe("pending");
  });

  it("resets task for all failure statuses", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
    const failureStatuses: RunRecord["status"][] = [
      "failed",
      "timeout",
      "budget_exceeded",
      "error_transient",
    ];

    for (const status of failureStatuses) {
      const { store, updatedStatus } = buildMockStore("in_progress");
      const run = buildMinimalRun(status);
      await finalizeRun({ run, henchDir, projectDir, store, rollbackOnFailure: false });
      expect(updatedStatus()).toBe("pending");
    }
  });

  it("updates task to completed when run completes successfully", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
    const { store, updatedStatus } = buildMockStore("in_progress");

    const run = buildMinimalRun("completed");
    await finalizeRun({
      run,
      henchDir,
      projectDir,
      store,
      rollbackOnFailure: false,
      skipFullTestGate: true,
    });

    // Task should be marked as completed immediately after test gate passes
    expect(updatedStatus()).toBe("completed");
  });

  it("does not reset task already moved to pending by a failure handler", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
    // Simulate a specific handler having already set status to pending
    const { store, updatedStatus, logEntries } = buildMockStore("pending");

    const run = buildMinimalRun("failed");
    const initialLogCount = logEntries().length;
    await finalizeRun({ run, henchDir, projectDir, store, rollbackOnFailure: false });

    // Still pending — no double update
    expect(updatedStatus()).toBe("pending");
    // No extra log entry was appended by the reset helper
    expect(logEntries().length).toBe(initialLogCount);
  });

  it("does not reset task in deferred status", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
    const { store, updatedStatus } = buildMockStore("deferred");

    const run = buildMinimalRun("failed");
    await finalizeRun({ run, henchDir, projectDir, store, rollbackOnFailure: false });

    expect(updatedStatus()).toBe("deferred");
  });

  it("resets task regardless of rollbackOnFailure setting", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    // rollbackOnFailure: true
    const { store: store1, updatedStatus: status1 } = buildMockStore("in_progress");
    await finalizeRun({ run: buildMinimalRun("failed"), henchDir, projectDir, store: store1, rollbackOnFailure: true });
    expect(status1()).toBe("pending");

    // rollbackOnFailure: false (--no-rollback)
    const { store: store2, updatedStatus: status2 } = buildMockStore("in_progress");
    await finalizeRun({ run: buildMinimalRun("failed"), henchDir, projectDir, store: store2, rollbackOnFailure: false });
    expect(status2()).toBe("pending");
  });

  it("skips reset when no store is provided (backward compatibility)", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    // No store → should complete without error (existing rollback tests)
    const run = buildMinimalRun("failed");
    await expect(
      finalizeRun({ run, henchDir, projectDir, rollbackOnFailure: false }),
    ).resolves.toBeUndefined();
  });

  it("prints confirmation with task ID and title on reset", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
    const { store } = buildMockStore("in_progress");

    // Restore the beforeEach mock so we can capture actual calls
    vi.restoreAllMocks();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const run = buildMinimalRun("failed");
    await finalizeRun({ run, henchDir, projectDir, store, rollbackOnFailure: false });

    // Output should mention task ID, title, and "pending"
    const output = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("task-1");
    expect(output).toContain("Test task");
    expect(output).toContain("pending");
  });
});
