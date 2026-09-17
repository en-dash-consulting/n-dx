import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { displayTaskInfo } from "../../../src/agent/lifecycle/task-display.js";
import { explainSelection, collectCompletedIds } from "../../../src/prd/rex-gateway.js";
import type { PRDItem, SelectionExplanation } from "../../../src/prd/rex-gateway.js";
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

  describe("selection reason is read from the reason code, not the prose", () => {
    /** A feature whose only child is completed — the finalize-ready shape. */
    function finalizeReadyTree(): { items: PRDItem[]; selected: PRDItem } {
      const child: PRDItem = {
        id: "task-1",
        title: "Child task",
        level: "task",
        status: "completed",
        priority: "medium",
      };
      const parent: PRDItem = {
        id: "feat-1",
        title: "Feature One",
        level: "feature",
        status: "pending",
        priority: "medium",
        children: [child],
      };
      return { items: [parent], selected: parent };
    }

    function explainFor(items: PRDItem[], selected: PRDItem): SelectionExplanation {
      return explainSelection(items, { item: selected, parents: [] }, collectCompletedIds(items));
    }

    it("renders the finalize label for a parent whose children are all completed", () => {
      const { items, selected } = finalizeReadyTree();
      displayTaskInfo(makeBrief({ id: selected.id, title: selected.title }), "auto", explainFor(items, selected));

      const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(allOutput).toContain("all children completed, ready to finalize");
    });

    it("renders the finalize label even when rex rewords its summary", () => {
      const { items, selected } = finalizeReadyTree();
      const reworded: SelectionExplanation = {
        ...explainFor(items, selected),
        summary: '"Feature One" — all children done, ready to wrap up',
      };
      displayTaskInfo(makeBrief({ id: selected.id, title: selected.title }), "auto", reworded);

      const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(allOutput).toContain("all children completed, ready to finalize");
      expect(allOutput).not.toContain("medium priority");
    });

    it("renders the resuming label even when rex rewords its summary", () => {
      const task: PRDItem = {
        id: "task-1",
        title: "Child task",
        level: "task",
        status: "in_progress",
        priority: "medium",
      };
      const reworded: SelectionExplanation = {
        ...explainFor([task], task),
        summary: '"Child task" is still being worked on',
      };
      displayTaskInfo(makeBrief({ id: task.id, title: task.title }), "auto", reworded);

      const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(allOutput).toContain("resuming in-progress task");
      expect(allOutput).not.toContain("medium priority");
    });

    it("falls back to the priority label for an ordinary task", () => {
      const task: PRDItem = {
        id: "task-1",
        title: "Child task",
        level: "task",
        status: "pending",
        priority: "high",
      };
      displayTaskInfo(makeBrief({ id: task.id, title: task.title }), "auto", explainFor([task], task));

      const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(allOutput).toContain("high priority");
    });
  });
});
