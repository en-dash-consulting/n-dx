/**
 * Unit tests for task completion and advancement in hench run loop.
 *
 * Verifies that updateCompletedTaskStatus:
 * - Updates task status from pending/in_progress to completed
 * - Is idempotent when task is already completed
 * - Returns true if update was performed, false if skipped
 * - Logs completion events
 */

import { describe, it, expect, vi } from "vitest";
import type { PRDStore } from "../../../src/prd/rex-gateway.js";
import type { RunRecord } from "../../../src/schema/index.js";
import { updateCompletedTaskStatus } from "../../../src/agent/lifecycle/shared.js";

describe("updateCompletedTaskStatus", () => {
  function mockStore(initialStatus: string): {
    store: PRDStore;
    getUpdatedStatus: () => string;
  } {
    let currentStatus = initialStatus;
    const store: PRDStore = {
      async getItem(id: string) {
        return { id, status: currentStatus } as any;
      },
      async updateItem(_id: string, updates: any) {
        if (updates.status) currentStatus = updates.status;
      },
      async appendLog() {},
      async loadDocument() {
        return { version: 1, title: "Test", items: [] };
      },
      async saveDocument() {},
      async addItem() {},
      async removeItem() {},
      async loadConfig() {
        return {};
      },
      async saveConfig() {},
      async readLog() {
        return [];
      },
      async loadWorkflow() {
        return "";
      },
      async saveWorkflow() {},
      async withTransaction(fn: any) {
        const doc = await this.loadDocument();
        return fn(doc);
      },
      capabilities() {
        return { adapter: "mock", supportsTransactions: false, supportsWatch: false };
      },
    };

    return { store, getUpdatedStatus: () => currentStatus };
  }

  it("updates task status from pending to completed", async () => {
    const { store, getUpdatedStatus } = mockStore("pending");
    const run: RunRecord = {
      id: "run-1",
      taskId: "task-1",
      taskTitle: "Task 1",
      status: "completed",
      startedAt: new Date().toISOString(),
      turns: [],
      toolCalls: [],
      summary: "Task completed",
    };

    const updated = await updateCompletedTaskStatus(store, "task-1", run);

    expect(updated).toBe(true);
    expect(getUpdatedStatus()).toBe("completed");
  });

  it("updates task status from in_progress to completed", async () => {
    const { store, getUpdatedStatus } = mockStore("in_progress");
    const run: RunRecord = {
      id: "run-1",
      taskId: "task-1",
      taskTitle: "Task 1",
      status: "completed",
      startedAt: new Date().toISOString(),
      turns: [],
      toolCalls: [],
      summary: "Task completed",
    };

    const updated = await updateCompletedTaskStatus(store, "task-1", run);

    expect(updated).toBe(true);
    expect(getUpdatedStatus()).toBe("completed");
  });

  it("is idempotent when task is already completed", async () => {
    const { store, getUpdatedStatus } = mockStore("completed");
    const run: RunRecord = {
      id: "run-1",
      taskId: "task-1",
      taskTitle: "Task 1",
      status: "completed",
      startedAt: new Date().toISOString(),
      turns: [],
      toolCalls: [],
      summary: "Task completed",
    };

    const updated = await updateCompletedTaskStatus(store, "task-1", run);

    expect(updated).toBe(false);
    expect(getUpdatedStatus()).toBe("completed");
  });

  it("returns false when run status is not completed", async () => {
    const { store, getUpdatedStatus } = mockStore("pending");
    const run: RunRecord = {
      id: "run-1",
      taskId: "task-1",
      taskTitle: "Task 1",
      status: "failed",
      startedAt: new Date().toISOString(),
      turns: [],
      toolCalls: [],
      summary: "Task failed",
    };

    const updated = await updateCompletedTaskStatus(store, "task-1", run);

    expect(updated).toBe(false);
    expect(getUpdatedStatus()).toBe("pending");
  });

  it("returns false when taskId is empty", async () => {
    const { store, getUpdatedStatus } = mockStore("pending");
    const run: RunRecord = {
      id: "run-1",
      taskId: undefined,
      taskTitle: "Task 1",
      status: "completed",
      startedAt: new Date().toISOString(),
      turns: [],
      toolCalls: [],
      summary: "Task completed",
    };

    const updated = await updateCompletedTaskStatus(store, "", run);

    expect(updated).toBe(false);
    expect(getUpdatedStatus()).toBe("pending");
  });

  it("calls appendLog to record completion event", async () => {
    const { store } = mockStore("pending");
    const appendLogSpy = vi.spyOn(store, "appendLog");

    const run: RunRecord = {
      id: "run-1",
      taskId: "task-1",
      taskTitle: "Task 1",
      status: "completed",
      startedAt: new Date().toISOString(),
      turns: [],
      toolCalls: [],
      summary: "Task completed successfully",
    };

    await updateCompletedTaskStatus(store, "task-1", run);

    // appendLog is called twice: once for status_updated by toolRexUpdateStatus,
    // once for task_completed by toolRexAppendLog in updateCompletedTaskStatus
    expect(appendLogSpy).toHaveBeenCalledTimes(2);

    // Verify the "task_completed" event is in one of the calls
    const completionCall = appendLogSpy.mock.calls.find(
      (call) => call[0].event === "task_completed"
    );
    expect(completionCall).toBeDefined();
    expect(completionCall![0].detail).toContain("Task completed successfully");
  });

  it("catches errors and returns false without crashing", async () => {
    const store: PRDStore = {
      async getItem() {
        throw new Error("Store error");
      },
      async appendLog() {},
      async updateItem() {},
      async loadDocument() {
        return { version: 1, title: "Test", items: [] };
      },
      async saveDocument() {},
      async addItem() {},
      async removeItem() {},
      async loadConfig() {
        return {};
      },
      async saveConfig() {},
      async readLog() {
        return [];
      },
      async loadWorkflow() {
        return "";
      },
      async saveWorkflow() {},
      async withTransaction(fn: any) {
        const doc = await this.loadDocument();
        return fn(doc);
      },
      capabilities() {
        return { adapter: "mock", supportsTransactions: false, supportsWatch: false };
      },
    };

    const run: RunRecord = {
      id: "run-1",
      taskId: "task-1",
      taskTitle: "Task 1",
      status: "completed",
      startedAt: new Date().toISOString(),
      turns: [],
      toolCalls: [],
      summary: "Task completed",
    };

    const updated = await updateCompletedTaskStatus(store, "task-1", run);

    expect(updated).toBe(false);
  });
});
