import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { displayTaskInfo } from "../../../src/agent/lifecycle/task-display.js";
import type { TaskBrief } from "../../../src/schema/index.js";

describe("displayTaskInfo", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  function makeBrief(overrides?: Partial<TaskBrief["task"]>): TaskBrief {
    return {
      task: {
        id: "task-123",
        title: "Implement feature X",
        level: "task",
        status: "pending",
        priority: "high",
        ...overrides,
      },
      parentChain: [
        { id: "epic-1", title: "Epic One", level: "epic" },
        { id: "feat-1", title: "Feature One", level: "feature" },
      ],
      siblings: [],
      project: { name: "test-project" },
      workflow: "",
      recentLog: [],
    };
  }

  it("displays task ID", () => {
    const brief = makeBrief();
    displayTaskInfo(brief);

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("task-123");
  });

  it("displays task title", () => {
    const brief = makeBrief();
    displayTaskInfo(brief);

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("Implement feature X");
  });

  it("displays task priority", () => {
    const brief = makeBrief({ priority: "critical" });
    displayTaskInfo(brief);

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("critical");
  });

  it("displays parent chain", () => {
    const brief = makeBrief();
    displayTaskInfo(brief);

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("Epic One");
    expect(allOutput).toContain("Feature One");
  });

  it("handles task with no parent chain", () => {
    const brief = makeBrief();
    brief.parentChain = [];
    displayTaskInfo(brief);

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("task-123");
    expect(allOutput).toContain("Implement feature X");
  });

  it("handles task with no priority", () => {
    const brief = makeBrief({ priority: undefined });
    displayTaskInfo(brief);

    // Should not crash
    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("Implement feature X");
  });

  it("displays acceptance criteria count when present", () => {
    const brief = makeBrief({
      acceptanceCriteria: ["Criterion 1", "Criterion 2", "Criterion 3"],
    });
    displayTaskInfo(brief);

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("3");
  });

  it("uses subsection formatting", () => {
    const brief = makeBrief();
    displayTaskInfo(brief);

    // Should use the subsection-style output (contains "──")
    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("──");
  });

  it("shows auto-selection reason when reason is 'auto'", () => {
    const brief = makeBrief();
    displayTaskInfo(brief, "auto");

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("auto");
    expect(allOutput).toContain("highest priority");
  });

  it("does not show selection reason for explicit tasks", () => {
    const brief = makeBrief();
    displayTaskInfo(brief, "explicit");

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).not.toContain("auto");
    expect(allOutput).not.toContain("Selected:");
  });
});
