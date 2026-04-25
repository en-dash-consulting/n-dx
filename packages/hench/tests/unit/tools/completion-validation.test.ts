import { describe, it, expect, vi, beforeEach } from "vitest";
import { toolRexUpdateStatus } from "../../../src/tools/rex.js";

/**
 * Tests that toolRexUpdateStatus integrates completion validation
 * when a projectDir is provided and status is "completed".
 */

vi.mock("../../../src/validation/completion.js", () => ({
  validateCompletion: vi.fn(),
  formatValidationResult: vi.fn((r: { reason?: string }) => r.reason ?? ""),
}));

import { validateCompletion, formatValidationResult } from "../../../src/validation/completion.js";

const mockValidate = vi.mocked(validateCompletion);
const mockFormat = vi.mocked(formatValidationResult);

function mockStore() {
  return {
    updateItem: vi.fn().mockResolvedValue(undefined),
    appendLog: vi.fn().mockResolvedValue(undefined),
    addItem: vi.fn().mockResolvedValue(undefined),
    loadDocument: vi.fn().mockResolvedValue({
      schema: "rex/v1",
      title: "Test",
      items: [],
    }),
    saveDocument: vi.fn(),
    getItem: vi.fn().mockResolvedValue({
      id: "task-1",
      title: "Test task",
      status: "in_progress",
      level: "task",
    }),
    removeItem: vi.fn(),
    loadConfig: vi.fn(),
    saveConfig: vi.fn(),
    readLog: vi.fn(),
    loadWorkflow: vi.fn(),
    saveWorkflow: vi.fn(),
    capabilities: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("toolRexUpdateStatus with completion validation", () => {
  it("rejects completion when validation fails", async () => {
    const store = mockStore();

    mockValidate.mockResolvedValue({
      valid: false,
      hasChanges: false,
      reason: "No changes detected in git diff",
    });
    mockFormat.mockReturnValue("No changes detected in git diff");

    const result = await toolRexUpdateStatus(
      store,
      "task-1",
      { status: "completed" },
      { projectDir: "/project" },
    );

    expect(result).toContain("COMPLETION_REJECTED");
    expect(result).toContain("No changes detected");
    // Should NOT have updated the item status
    expect(store.updateItem).not.toHaveBeenCalled();
    // Should have logged the rejection
    expect(store.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "completion_rejected",
        itemId: "task-1",
      }),
    );
  });

  it("allows completion when validation passes", async () => {
    const store = mockStore();

    mockValidate.mockResolvedValue({
      valid: true,
      hasChanges: true,
      diffSummary: "1 file changed",
    });

    const result = await toolRexUpdateStatus(
      store,
      "task-1",
      { status: "completed" },
      { projectDir: "/project" },
    );

    expect(result).toContain("completed");
    expect(result).not.toContain("COMPLETION_REJECTED");
    expect(store.updateItem).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ status: "completed" }),
      expect.anything(),
    );
  });

  it("passes testCommand to validation", async () => {
    const store = mockStore();

    mockValidate.mockResolvedValue({
      valid: true,
      hasChanges: true,
    });

    await toolRexUpdateStatus(
      store,
      "task-1",
      { status: "completed" },
      { projectDir: "/project", testCommand: "npm test" },
    );

    expect(mockValidate).toHaveBeenCalledWith("/project", {
      testCommand: "npm test",
    });
  });

  it("skips validation when no projectDir provided", async () => {
    const store = mockStore();

    const result = await toolRexUpdateStatus(
      store,
      "task-1",
      { status: "completed" },
    );

    expect(mockValidate).not.toHaveBeenCalled();
    expect(result).toContain("completed");
    expect(store.updateItem).toHaveBeenCalled();
  });

  it("skips validation for non-completed statuses", async () => {
    const store = mockStore();
    store.getItem.mockResolvedValue({
      id: "task-1",
      title: "Test task",
      status: "pending",
      level: "task",
    });

    await toolRexUpdateStatus(
      store,
      "task-1",
      { status: "in_progress" },
      { projectDir: "/project" },
    );

    expect(mockValidate).not.toHaveBeenCalled();
    expect(store.updateItem).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ status: "in_progress" }),
      expect.anything(),
    );
  });

  it("rejects completion when tests fail", async () => {
    const store = mockStore();

    mockValidate.mockResolvedValue({
      valid: false,
      hasChanges: true,
      testsRan: true,
      testsPassed: false,
      reason: "Tests failed: 2 tests failed",
    });
    mockFormat.mockReturnValue("Tests failed: 2 tests failed");

    const result = await toolRexUpdateStatus(
      store,
      "task-1",
      { status: "completed" },
      { projectDir: "/project", testCommand: "npm test" },
    );

    expect(result).toContain("COMPLETION_REJECTED");
    expect(result).toContain("Tests failed");
    expect(store.updateItem).not.toHaveBeenCalled();
  });

  it("passes startingHead to validation", async () => {
    const store = mockStore();

    mockValidate.mockResolvedValue({
      valid: true,
      hasChanges: true,
    });

    await toolRexUpdateStatus(
      store,
      "task-1",
      { status: "completed" },
      { projectDir: "/project", startingHead: "abc123" },
    );

    expect(mockValidate).toHaveBeenCalledWith("/project", {
      startingHead: "abc123",
    });
  });

  it("passes both startingHead and testCommand to validation", async () => {
    const store = mockStore();

    mockValidate.mockResolvedValue({
      valid: true,
      hasChanges: true,
      testsRan: true,
      testsPassed: true,
    });

    await toolRexUpdateStatus(
      store,
      "task-1",
      { status: "completed" },
      { projectDir: "/project", startingHead: "abc123", testCommand: "pnpm test" },
    );

    expect(mockValidate).toHaveBeenCalledWith("/project", {
      testCommand: "pnpm test",
      startingHead: "abc123",
    });
  });

  it("rejection message includes guidance about staging changes", async () => {
    const store = mockStore();

    mockValidate.mockResolvedValue({
      valid: false,
      hasChanges: false,
      reason: "No changes detected in git diff. Task must produce meaningful changes to be marked complete.",
    });
    mockFormat.mockReturnValue("No changes detected in git diff");

    const result = await toolRexUpdateStatus(
      store,
      "task-1",
      { status: "completed" },
      { projectDir: "/project" },
    );

    expect(result).toContain("COMPLETION_REJECTED");
    expect(result).toContain("committed or staged");
  });

  it("logs formatted validation detail on rejection", async () => {
    const store = mockStore();

    mockValidate.mockResolvedValue({
      valid: false,
      hasChanges: true,
      testsRan: true,
      testsPassed: false,
      reason: "Tests failed: FAIL src/app.test.ts",
    });
    mockFormat.mockReturnValue("Changes detected: yes\nTests failed: FAIL src/app.test.ts");

    await toolRexUpdateStatus(
      store,
      "task-1",
      { status: "completed" },
      { projectDir: "/project", testCommand: "npm test" },
    );

    expect(store.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "completion_rejected",
        itemId: "task-1",
        detail: "Changes detected: yes\nTests failed: FAIL src/app.test.ts",
      }),
    );
  });

  it("skips validation for deferred status even with projectDir", async () => {
    const store = mockStore();
    store.getItem.mockResolvedValue({
      id: "task-1",
      title: "Test task",
      status: "in_progress",
      level: "task",
    });
    store.loadDocument.mockResolvedValue({
      schema: "rex/v1",
      title: "Test",
      items: [],
    });

    await toolRexUpdateStatus(
      store,
      "task-1",
      { status: "deferred" },
      { projectDir: "/project" },
    );

    expect(mockValidate).not.toHaveBeenCalled();
    expect(store.updateItem).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ status: "deferred" }),
      expect.anything(),
    );
  });
});
