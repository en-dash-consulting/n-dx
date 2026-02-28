// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { h, render } from "preact";
import { PRDTree } from "../../../src/viewer/components/prd-tree/prd-tree.js";
import type { PRDDocumentData } from "../../../src/viewer/components/prd-tree/types.js";

function renderToDiv(vnode: ReturnType<typeof h>) {
  const root = document.createElement("div");
  render(vnode, root);
  return root;
}

const sampleDoc: PRDDocumentData = {
  schema: "rex/v1",
  title: "Test Project",
  items: [
    {
      id: "epic-1",
      title: "Authentication",
      status: "in_progress",
      level: "epic",
      priority: "critical",
      children: [
        {
          id: "feature-1",
          title: "Login Flow",
          status: "in_progress",
          level: "feature",
          children: [
            {
              id: "task-1",
              title: "Build login form",
              status: "completed",
              level: "task",
              priority: "high",
              completedAt: "2026-01-10T12:00:00.000Z",
              tags: ["frontend"],
            },
            {
              id: "task-2",
              title: "Add OAuth support",
              status: "in_progress",
              level: "task",
              startedAt: "2026-01-11T08:00:00.000Z",
              children: [
                {
                  id: "subtask-1",
                  title: "Google OAuth",
                  status: "completed",
                  level: "subtask",
                },
                {
                  id: "subtask-2",
                  title: "GitHub OAuth",
                  status: "pending",
                  level: "subtask",
                },
              ],
            },
            {
              id: "task-3",
              title: "Error handling",
              status: "pending",
              level: "task",
              tags: ["frontend"],
            },
          ],
        },
      ],
    },
    {
      id: "epic-2",
      title: "Dashboard",
      status: "pending",
      level: "epic",
      children: [
        {
          id: "task-4",
          title: "Layout scaffold",
          status: "blocked",
          level: "task",
          blockedBy: ["task-1"],
        },
      ],
    },
  ],
};

describe("PRDTree", () => {
  it("renders the project title", () => {
    const root = renderToDiv(h(PRDTree, { document: sampleDoc }));
    expect(root.textContent).toContain("Test Project");
  });

  it("renders epic titles", () => {
    const root = renderToDiv(h(PRDTree, { document: sampleDoc }));
    expect(root.textContent).toContain("Authentication");
    expect(root.textContent).toContain("Dashboard");
  });

  it("renders nested items within default expand depth", () => {
    const root = renderToDiv(h(PRDTree, { document: sampleDoc, defaultExpandDepth: 3 }));
    expect(root.textContent).toContain("Login Flow");
    // "Build login form" is completed and hidden by default Active Work filter
    // Check a visible nested item instead
    expect(root.textContent).toContain("Add OAuth support");
  });

  it("renders status indicators", () => {
    const root = renderToDiv(h(PRDTree, { document: sampleDoc, defaultExpandDepth: 3 }));
    // Default filter is Active Work (pending, in_progress, blocked) so completed icon won't show
    expect(root.textContent).toContain("◐"); // in_progress
    expect(root.textContent).toContain("○"); // pending
  });

  it("renders progress percentages", () => {
    const root = renderToDiv(h(PRDTree, { document: sampleDoc }));
    // The epic has tasks beneath it, so should show a percentage
    expect(root.textContent).toMatch(/\d+%/);
  });

  it("renders priority badges", () => {
    const root = renderToDiv(h(PRDTree, { document: sampleDoc, defaultExpandDepth: 3 }));
    // "critical" is on the epic (in_progress, visible)
    expect(root.textContent).toContain("critical");
    // "high" is on a completed task, hidden by default Active Work filter
  });

  it("renders level badges", () => {
    const root = renderToDiv(h(PRDTree, { document: sampleDoc, defaultExpandDepth: 3 }));
    expect(root.textContent).toContain("Epic");
    expect(root.textContent).toContain("Feature");
    expect(root.textContent).toContain("Task");
  });

  it("renders tags", () => {
    const root = renderToDiv(h(PRDTree, { document: sampleDoc, defaultExpandDepth: 3 }));
    expect(root.textContent).toContain("frontend");
  });

  it("renders task usage chips from aggregated usage data", () => {
    const root = renderToDiv(h(PRDTree, {
      document: sampleDoc,
      defaultExpandDepth: 3,
      taskUsageById: {
        "task-2": { totalTokens: 1234, runCount: 2 },
      },
    }));
    expect(root.textContent).toContain("1.2k tokens");
  });

  it("renders rounded utilization percentage from shared weekly budget", () => {
    const root = renderToDiv(h(PRDTree, {
      document: sampleDoc,
      defaultExpandDepth: 3,
      weeklyBudget: { budget: 50_000, source: "vendor_default" },
      taskUsageById: {
        "task-2": { totalTokens: 1234, runCount: 2 },
      },
    }));
    expect(root.textContent).toContain("1.2k tokens | 2%");
  });

  it("renders missing-budget fallback label and reason on usage chips", () => {
    const root = renderToDiv(h(PRDTree, {
      document: sampleDoc,
      defaultExpandDepth: 3,
      taskUsageById: {
        "task-2": { totalTokens: 1234, runCount: 2 },
      },
    }));
    expect(root.textContent).toContain("1.2k tokens | No budget");
    const chip = root.querySelector(".prd-usage-chip");
    expect(chip?.getAttribute("data-utilization-reason")).toBe("missing_budget");
  });

  it("renders explicit zero usage for tasks without associated runs", () => {
    const root = renderToDiv(h(PRDTree, { document: sampleDoc, defaultExpandDepth: 3 }));
    expect(root.textContent).toContain("0 tokens");
  });

  it("renders tree role for accessibility", () => {
    const root = renderToDiv(h(PRDTree, { document: sampleDoc }));
    const tree = root.querySelector("[role='tree']");
    expect(tree).not.toBeNull();
  });

  it("renders expand/collapse toolbar", () => {
    const root = renderToDiv(h(PRDTree, { document: sampleDoc }));
    expect(root.textContent).toContain("Expand All");
    expect(root.textContent).toContain("Collapse All");
  });

  it("renders summary bar with completion stats", () => {
    const root = renderToDiv(h(PRDTree, { document: sampleDoc }));
    const summaryStats = root.querySelector(".prd-summary-stats");
    expect(summaryStats).not.toBeNull();
    // Should show overall completion
    expect(root.textContent).toMatch(/complete/);
  });

  it("renders empty state when no items", () => {
    const emptyDoc: PRDDocumentData = {
      schema: "rex/v1",
      title: "Empty Project",
      items: [],
    };
    const root = renderToDiv(h(PRDTree, { document: emptyDoc }));
    expect(root.textContent).toContain("No PRD items yet");
  });

  it("respects defaultExpandDepth=0 by hiding children", () => {
    const root = renderToDiv(h(PRDTree, { document: sampleDoc, defaultExpandDepth: 0 }));
    // Epics should show
    expect(root.textContent).toContain("Authentication");
    expect(root.textContent).toContain("Dashboard");
    // Features/tasks below epics should not show since nothing is expanded
    expect(root.textContent).not.toContain("Login Flow");
  });

  it("renders count badges for parent nodes", () => {
    const root = renderToDiv(h(PRDTree, { document: sampleDoc, defaultExpandDepth: 1 }));
    // Should show counts like "2/5" (completed/total)
    const counts = root.querySelectorAll(".prd-count");
    expect(counts.length).toBeGreaterThan(0);
  });

  it("renders progress bars for parent nodes", () => {
    const root = renderToDiv(h(PRDTree, { document: sampleDoc }));
    const progressBars = root.querySelectorAll(".prd-progress-track");
    expect(progressBars.length).toBeGreaterThan(0);
  });

  it("renders summary segments", () => {
    const root = renderToDiv(h(PRDTree, { document: sampleDoc }));
    const segments = root.querySelectorAll(".prd-summary-segment");
    expect(segments.length).toBeGreaterThan(0);
  });

  it("renders status filter controls", () => {
    const root = renderToDiv(h(PRDTree, { document: sampleDoc }));
    const filterGroup = root.querySelector("[role='group'][aria-label='Filter by status']");
    expect(filterGroup).not.toBeNull();
  });

  it("renders status filter chips for all statuses", () => {
    const root = renderToDiv(h(PRDTree, { document: sampleDoc }));
    const chips = root.querySelectorAll(".prd-status-chip");
    // Should have chips for all 7 statuses
    expect(chips.length).toBe(7);
  });

  it("renders filter preset buttons", () => {
    const root = renderToDiv(h(PRDTree, { document: sampleDoc }));
    const presets = root.querySelectorAll(".prd-status-preset");
    expect(presets.length).toBe(4); // "All Items", "Active Work", "Completed", "Blocked/Deferred"
  });

  it("hides deleted items by default", () => {
    const docWithDeleted: PRDDocumentData = {
      schema: "rex/v1",
      title: "Test",
      items: [
        {
          id: "t1",
          title: "Active Task",
          status: "pending",
          level: "task",
        },
        {
          id: "t2",
          title: "Deleted Task",
          status: "deleted",
          level: "task",
        },
      ],
    };
    const root = renderToDiv(h(PRDTree, { document: docWithDeleted }));
    expect(root.textContent).toContain("Active Task");
    // Deleted items should be hidden by default (defaultStatusFilter is Active Work set)
    expect(root.textContent).not.toContain("Deleted Task");
  });

  it("shows parent epic when it has visible children even if epic status is filtered", () => {
    // Default filter is Active Work: pending, in_progress, blocked
    // Epic with deferred status should show because it has a pending child
    const docWithMixed: PRDDocumentData = {
      schema: "rex/v1",
      title: "Test",
      items: [
        {
          id: "e1",
          title: "Deferred Epic",
          status: "deferred",
          level: "epic",
          children: [
            {
              id: "t1",
              title: "Pending Task",
              status: "pending",
              level: "task",
            },
          ],
        },
      ],
    };
    const root = renderToDiv(h(PRDTree, { document: docWithMixed }));
    // Epic should be visible because of its visible child
    expect(root.textContent).toContain("Deferred Epic");
  });
});
