/**
 * @module rex/store/folder-tree-index-generator
 */

import { describe, it, expect } from "vitest";
import type { PRDItem, LogEntry } from "../../../src/schema/index.js";
import { generateIndexMd } from "../../../src/store/folder-tree-index-generator.js";

describe("generateIndexMd", () => {
  it("generates deterministic output for epic with description", () => {
    const item: PRDItem = {
      id: "epic-1",
      level: "epic",
      title: "Web Dashboard",
      status: "in_progress",
      description: "Unified dashboard for PRD management",
      children: [],
    };

    const output = generateIndexMd(item, [], []);
    expect(output).toContain("---");
    expect(output).toContain('id: "epic-1"');
    expect(output).toContain('level: "epic"');
    expect(output).toContain('title: "Web Dashboard"');
    expect(output).toContain('status: "in_progress"');
    expect(output).toContain("# Web Dashboard");
    expect(output).toContain("[in_progress]");
    expect(output).toContain("## Summary");
    expect(output).toContain("Unified dashboard for PRD management");
    expect(output).toContain("## Info");
  });

  it("regenerates identically given same input", () => {
    const item: PRDItem = {
      id: "task-1",
      level: "task",
      title: "Implement feature X",
      status: "completed",
      description: "Description here",
      acceptanceCriteria: ["Criterion A", "Criterion B"],
      startedAt: "2026-04-15T10:00:00Z",
      completedAt: "2026-04-17T14:30:00Z",
      children: [],
    };

    const output1 = generateIndexMd(item, [], []);
    const output2 = generateIndexMd(item, [], []);
    expect(output1).toBe(output2);
  });

  it("includes priority indicator for critical priority", () => {
    const item: PRDItem = {
      id: "f-1",
      level: "feature",
      title: "Critical task",
      status: "in_progress",
      priority: "critical",
      description: "",
      acceptanceCriteria: [],
      children: [],
    };

    const output = generateIndexMd(item, [], []);
    expect(output).toContain("🔴 [in_progress]");
  });

  it("includes priority indicator for high priority", () => {
    const item: PRDItem = {
      id: "f-2",
      level: "feature",
      title: "High priority",
      status: "pending",
      priority: "high",
      description: "",
      acceptanceCriteria: [],
      children: [],
    };

    const output = generateIndexMd(item, [], []);
    expect(output).toContain("🟠 [pending]");
  });

  it("includes priority indicator for medium priority", () => {
    const item: PRDItem = {
      id: "f-3",
      level: "feature",
      title: "Medium priority",
      status: "pending",
      priority: "medium",
      description: "",
      acceptanceCriteria: [],
      children: [],
    };

    const output = generateIndexMd(item, [], []);
    expect(output).toContain("🟡 [pending]");
  });

  it("includes priority indicator for low priority", () => {
    const item: PRDItem = {
      id: "f-4",
      level: "feature",
      title: "Low priority",
      status: "completed",
      priority: "low",
      description: "",
      acceptanceCriteria: [],
      children: [],
    };

    const output = generateIndexMd(item, [], []);
    expect(output).toContain("⚪ [completed]");
  });

  it("omits priority indicator when priority is not set", () => {
    const item: PRDItem = {
      id: "e-1",
      level: "epic",
      title: "Epic no priority",
      status: "pending",
      description: "",
      children: [],
    };

    const output = generateIndexMd(item, [], []);
    expect(output).not.toContain("🔴");
    expect(output).not.toContain("🟠");
    expect(output).not.toContain("🟡");
    expect(output).not.toContain("⚪");
    expect(output).toContain("[pending]");
  });

  it("shows default summary when description is empty", () => {
    const item: PRDItem = {
      id: "t-1",
      level: "task",
      title: "Task with no description",
      status: "pending",
      description: "",
      acceptanceCriteria: [],
      children: [],
    };

    const output = generateIndexMd(item, [], []);
    expect(output).toContain("## Summary");
    expect(output).toContain("No summary provided.");
  });

  it("generates Progress table for epic with children", () => {
    const parent: PRDItem = {
      id: "epic-1",
      level: "epic",
      title: "Parent Epic",
      status: "in_progress",
      description: "Epic description",
      children: [],
    };

    const child1: PRDItem = {
      id: "f-1",
      level: "feature",
      title: "Feature A",
      status: "completed",
      startedAt: "2026-04-10T00:00:00Z",
      completedAt: "2026-04-15T00:00:00Z",
      description: "",
      acceptanceCriteria: [],
      children: [],
    };

    const child2: PRDItem = {
      id: "f-2",
      level: "feature",
      title: "Feature B",
      status: "in_progress",
      startedAt: "2026-04-15T00:00:00Z",
      description: "",
      acceptanceCriteria: [],
      children: [],
    };

    const output = generateIndexMd(parent, [child1, child2], []);
    expect(output).toContain("## Progress");
    expect(output).toContain("| Child | Level | Status | Last Updated |");
    expect(output).toContain("| Feature A | feature | completed | 2026-04-15 |");
    expect(output).toContain("| Feature B | feature | in_progress | 2026-04-15 |");
  });

  it("omits Progress section for epic with no children", () => {
    const item: PRDItem = {
      id: "epic-empty",
      level: "epic",
      title: "Empty Epic",
      status: "pending",
      description: "An empty container",
      children: [],
    };

    const output = generateIndexMd(item, [], []);
    expect(output).not.toContain("## Progress");
  });

  it("generates Progress table for feature with children", () => {
    const parent: PRDItem = {
      id: "f-1",
      level: "feature",
      title: "Parent Feature",
      status: "in_progress",
      description: "Feature description",
      acceptanceCriteria: [],
      children: [],
    };

    const child: PRDItem = {
      id: "t-1",
      level: "task",
      title: "Task 1",
      status: "pending",
      startedAt: "2026-04-20T00:00:00Z",
      description: "",
      acceptanceCriteria: [],
      children: [],
    };

    const output = generateIndexMd(parent, [child], []);
    expect(output).toContain("## Progress");
    expect(output).toContain("| Task 1 | task | pending | 2026-04-20 |");
  });

  it("omits Commits section when status is pending", () => {
    const item: PRDItem = {
      id: "t-1",
      level: "task",
      title: "Pending Task",
      status: "pending",
      description: "",
      acceptanceCriteria: [],
      children: [],
    };

    const output = generateIndexMd(item, [], []);
    expect(output).not.toContain("## Commits");
  });

  it("includes Commits section for completed status (placeholder)", () => {
    const item: PRDItem = {
      id: "t-1",
      level: "task",
      title: "Completed Task",
      status: "completed",
      description: "",
      acceptanceCriteria: [],
      children: [],
    };

    const output = generateIndexMd(item, [], []);
    // Currently empty since extractCommits is a placeholder
    // But the section structure should be there when commits are implemented
  });

  it("includes Commits section for in_progress status (placeholder)", () => {
    const item: PRDItem = {
      id: "t-1",
      level: "task",
      title: "In Progress Task",
      status: "in_progress",
      description: "",
      acceptanceCriteria: [],
      children: [],
    };

    const output = generateIndexMd(item, [], []);
    // Currently empty since extractCommits is a placeholder
  });

  it("generates Changes section from execution log", () => {
    const item: PRDItem = {
      id: "t-1",
      level: "task",
      title: "Task with changes",
      status: "completed",
      description: "",
      acceptanceCriteria: [],
      children: [],
    };

    const log: LogEntry[] = [
      {
        timestamp: "2026-04-20T14:00:00Z",
        event: "status_changed",
        itemId: "t-1",
        detail: "in_progress → completed",
      },
      {
        timestamp: "2026-04-20T10:00:00Z",
        event: "task_completed",
        itemId: "t-1",
        detail: "Run completed with 150 tokens",
      },
    ];

    const output = generateIndexMd(item, [], log);
    expect(output).toContain("## Changes");
    expect(output).toContain("**Status changed:** in_progress → completed");
    expect(output).toContain("**Task completed:** Run completed with 150 tokens");
  });

  it("limits Changes section to 10 most recent entries", () => {
    const item: PRDItem = {
      id: "t-1",
      level: "task",
      title: "Task with many changes",
      status: "completed",
      description: "",
      acceptanceCriteria: [],
      children: [],
    };

    const log: LogEntry[] = [];
    for (let i = 0; i < 15; i++) {
      log.push({
        timestamp: new Date(Date.now() - i * 1000).toISOString(),
        event: "status_updated",
        itemId: "t-1",
        detail: `Change ${i}`,
      });
    }

    const output = generateIndexMd(item, [], log);
    const changeCount = (output.match(/\*\*Status updated:\*\*/g) || []).length;
    expect(changeCount).toBe(10);
  });

  it("omits Changes section when no log entries exist", () => {
    const item: PRDItem = {
      id: "t-1",
      level: "task",
      title: "Task with no changes",
      status: "pending",
      description: "",
      acceptanceCriteria: [],
      children: [],
    };

    const output = generateIndexMd(item, [], []);
    expect(output).not.toContain("## Changes");
  });

  it("generates Info section with all applicable fields", () => {
    const item: PRDItem = {
      id: "t-1",
      level: "task",
      title: "Task with full info",
      status: "completed",
      priority: "high",
      tags: ["urgent", "web"],
      description: "",
      acceptanceCriteria: [],
      startedAt: "2026-04-15T10:00:00Z",
      completedAt: "2026-04-17T14:30:00Z",
      children: [],
    };

    const output = generateIndexMd(item, [], []);
    expect(output).toContain("## Info");
    expect(output).toContain("- **Status:** completed");
    expect(output).toContain("- **Priority:** high");
    expect(output).toContain("- **Tags:** urgent, web");
    expect(output).toContain("- **Level:** task");
    expect(output).toContain("- **Started:** 2026-04-15T10:00:00Z");
    expect(output).toContain("- **Completed:** 2026-04-17T14:30:00Z");
    expect(output).toContain("- **Duration:** 2d 4h 30m");
  });

  it("omits priority from Info when not set", () => {
    const item: PRDItem = {
      id: "e-1",
      level: "epic",
      title: "Epic without priority",
      status: "in_progress",
      description: "",
      children: [],
    };

    const output = generateIndexMd(item, [], []);
    expect(output).toContain("- **Status:** in_progress");
    expect(output).toContain("- **Level:** epic");
    expect(output).not.toContain("- **Priority:**");
  });

  it("omits tags from Info when empty", () => {
    const item: PRDItem = {
      id: "t-1",
      level: "task",
      title: "Task without tags",
      status: "pending",
      description: "",
      acceptanceCriteria: [],
      children: [],
    };

    const output = generateIndexMd(item, [], []);
    expect(output).not.toContain("- **Tags:**");
  });

  it("generates subtask sections for task with subtasks", () => {
    const item: PRDItem = {
      id: "t-1",
      level: "task",
      title: "Parent Task",
      status: "in_progress",
      description: "Parent description",
      acceptanceCriteria: [],
      children: [
        {
          id: "st-1",
          level: "subtask",
          title: "Subtask 1",
          status: "completed",
          priority: "high",
          description: "Subtask description 1",
          acceptanceCriteria: ["Criterion A", "Criterion B"],
        },
        {
          id: "st-2",
          level: "subtask",
          title: "Subtask 2",
          status: "pending",
          description: "Subtask description 2",
          acceptanceCriteria: [],
        },
      ],
    };

    const output = generateIndexMd(item, [], []);
    expect(output).toContain("## Subtask: Subtask 1");
    expect(output).toContain("**ID:** `st-1`");
    expect(output).toContain("**Status:** completed");
    expect(output).toContain("**Priority:** high");
    expect(output).toContain("Subtask description 1");
    expect(output).toContain("**Acceptance Criteria**");
    expect(output).toContain("- Criterion A");
    expect(output).toContain("- Criterion B");

    expect(output).toContain("## Subtask: Subtask 2");
    expect(output).toContain("**Status:** pending");
    expect(output).toContain("Subtask description 2");
  });

  it("includes horizontal rule between subtasks", () => {
    const item: PRDItem = {
      id: "t-1",
      level: "task",
      title: "Task with subtasks",
      status: "pending",
      description: "",
      acceptanceCriteria: [],
      children: [
        {
          id: "st-1",
          level: "subtask",
          title: "Subtask 1",
          status: "pending",
        },
        {
          id: "st-2",
          level: "subtask",
          title: "Subtask 2",
          status: "pending",
        },
      ],
    };

    const output = generateIndexMd(item, [], []);
    // Should have one --- between subtasks (not after the last one)
    const lines = output.split("\n");
    let horizCount = 0;
    for (const line of lines) {
      if (line.trim() === "---") {
        horizCount++;
      }
    }
    // Frontmatter opens with ---, closes with ---, then one between subtasks = 3 total
    expect(horizCount).toBe(3);
  });

  it("omits Subtask section when task has no subtasks", () => {
    const item: PRDItem = {
      id: "t-1",
      level: "task",
      title: "Task without subtasks",
      status: "pending",
      description: "",
      acceptanceCriteria: [],
      children: [],
    };

    const output = generateIndexMd(item, [], []);
    expect(output).not.toContain("## Subtask:");
  });

  it("computes duration correctly for completed items", () => {
    const item: PRDItem = {
      id: "t-1",
      level: "task",
      title: "Task with duration",
      status: "completed",
      description: "",
      acceptanceCriteria: [],
      startedAt: "2026-04-15T10:00:00Z",
      completedAt: "2026-04-22T14:30:00Z",
      children: [],
    };

    const output = generateIndexMd(item, [], []);
    expect(output).toContain("- **Duration:** 7d 4h 30m");
  });

  it("omits duration when only startedAt exists", () => {
    const item: PRDItem = {
      id: "t-1",
      level: "task",
      title: "Task started but not ended",
      status: "in_progress",
      description: "",
      acceptanceCriteria: [],
      startedAt: "2026-04-15T10:00:00Z",
      children: [],
    };

    const output = generateIndexMd(item, [], []);
    expect(output).not.toContain("- **Duration:**");
  });

  it("preserves multiple tags in Info section", () => {
    const item: PRDItem = {
      id: "f-1",
      level: "feature",
      title: "Feature with tags",
      status: "in_progress",
      description: "",
      acceptanceCriteria: [],
      tags: ["web", "perf", "dx", "critical"],
      children: [],
    };

    const output = generateIndexMd(item, [], []);
    expect(output).toContain("- **Tags:** web, perf, dx, critical");
  });

  it("handles subtask without priority correctly", () => {
    const item: PRDItem = {
      id: "t-1",
      level: "task",
      title: "Parent Task",
      status: "pending",
      description: "",
      acceptanceCriteria: [],
      children: [
        {
          id: "st-1",
          level: "subtask",
          title: "Subtask without priority",
          status: "pending",
          description: "Some description",
        },
      ],
    };

    const output = generateIndexMd(item, [], []);
    expect(output).toContain("## Subtask: Subtask without priority");
    expect(output).toContain("**ID:** `st-1`");
    expect(output).toContain("**Status:** pending");
    const lines = output.split("\n");
    const subtaskSectionStart = lines.findIndex(l =>
      l.includes("## Subtask: Subtask without priority")
    );
    const nextFewLines = lines
      .slice(subtaskSectionStart, subtaskSectionStart + 5)
      .join("\n");
    expect(nextFewLines).not.toContain("**Priority:**");
  });

  it("handles subtask without description", () => {
    const item: PRDItem = {
      id: "t-1",
      level: "task",
      title: "Parent Task",
      status: "pending",
      description: "",
      acceptanceCriteria: [],
      children: [
        {
          id: "st-1",
          level: "subtask",
          title: "Subtask",
          status: "pending",
          description: "",
          acceptanceCriteria: ["Criterion 1"],
        },
      ],
    };

    const output = generateIndexMd(item, [], []);
    expect(output).toContain("## Subtask: Subtask");
    expect(output).toContain("**Acceptance Criteria**");
    expect(output).toContain("- Criterion 1");
  });
});
