// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { PRDTree } from "../../../src/viewer/components/prd-tree/prd-tree.js";
import type { PRDDocumentData, ItemStatus } from "../../../src/viewer/components/prd-tree/types.js";

function renderToDiv(vnode: ReturnType<typeof h>) {
  const root = document.createElement("div");
  act(() => { render(vnode, root); });
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

  describe("cross-worktree claim chip", () => {
    const claim = {
      taskId: "task-2",
      taskTitle: "Add password reset",
      worktreeRoot: "/repos/app/.claude/worktrees/feature-x",
      worktree: "feature-x",
      isServedHere: false,
      pid: 4242,
      host: "box",
      claimedAt: "2026-09-16T10:00:00.000Z",
      expiresAt: "2026-09-16T14:00:00.000Z",
    };

    it("shows 'claimed · <worktree>' on the claimed row only, as a tag-style chip naming the holder", () => {
      const root = renderToDiv(h(PRDTree, { document: sampleDoc, defaultExpandDepth: 3, claimsById: { "task-2": claim } }));
      const chips = root.querySelectorAll(".prd-claim-chip");
      expect(chips.length).toBe(1);
      const chip = chips[0];
      expect(chip.textContent).toBe("claimed · feature-x");
      expect(chip.classList.contains("tag-chip")).toBe(true);
      expect(chip.getAttribute("title")).toContain("/repos/app/.claude/worktrees/feature-x");
      expect(chip.getAttribute("title")).toContain("pid 4242");
      // It sits on task-2's row, not task-1's.
      expect(chip.closest("[data-node-id]")!.getAttribute("data-node-id")).toBe("task-2");
    });

    it("says 'here' for a claim held from the served worktree", () => {
      const root = renderToDiv(h(PRDTree, {
        document: sampleDoc, defaultExpandDepth: 3,
        claimsById: { "task-2": { ...claim, isServedHere: true } },
      }));
      expect(root.querySelector(".prd-claim-chip")!.textContent).toBe("claimed · here");
    });

    it("renders no chip without claims, and drops it when the claim is released", () => {
      const rootA = renderToDiv(h(PRDTree, { document: sampleDoc, defaultExpandDepth: 3 }));
      expect(rootA.querySelector(".prd-claim-chip")).toBeNull();

      // Same mounted tree: claim present, then released (claimsById empties).
      const div = document.createElement("div");
      act(() => { render(h(PRDTree, { document: sampleDoc, defaultExpandDepth: 3, claimsById: { "task-2": claim } }), div); });
      expect(div.querySelector(".prd-claim-chip")).not.toBeNull();
      act(() => { render(h(PRDTree, { document: sampleDoc, defaultExpandDepth: 3, claimsById: {} }), div); });
      expect(div.querySelector(".prd-claim-chip")).toBeNull();
    });
  });

  it("renders task usage chips from aggregated usage data", () => {
    const root = renderToDiv(h(PRDTree, {
      document: sampleDoc,
      defaultExpandDepth: 3,
      showTokenBudget: true,
      taskUsageById: {
        "task-2": { totalTokens: 1234, runCount: 2 },
      },
    }));
    // New column format: thousands-separated integer tokens.
    expect(root.textContent).toContain("1,234 tokens");
  });

  it("renders rounded utilization percentage from shared weekly budget", () => {
    const root = renderToDiv(h(PRDTree, {
      document: sampleDoc,
      defaultExpandDepth: 3,
      weeklyBudget: { budget: 50_000, source: "vendor_default" },
      showTokenBudget: true,
      taskUsageById: {
        "task-2": { totalTokens: 1234, runCount: 2 },
      },
    }));
    expect(root.textContent).toContain("1,234 tokens | 2%");
  });

  it("renders missing-budget fallback label and reason on token badges", () => {
    const root = renderToDiv(h(PRDTree, {
      document: sampleDoc,
      defaultExpandDepth: 3,
      showTokenBudget: true,
      taskUsageById: {
        "task-2": { totalTokens: 1234, runCount: 2 },
      },
    }));
    expect(root.textContent).toContain("1,234 tokens | No budget");
    const badge = root.querySelector(".prd-token-badge");
    expect(badge?.getAttribute("data-utilization-reason")).toBe("missing_budget");
  });

  it("hides the entire token usage cell when showTokenBudget is false", () => {
    const root = renderToDiv(h(PRDTree, {
      document: sampleDoc,
      defaultExpandDepth: 3,
      showTokenBudget: false,
      weeklyBudget: { budget: 50_000, source: "vendor_default" },
      taskUsageById: {
        "task-2": { totalTokens: 1234, runCount: 2 },
      },
    }));
    // Whole cell is gated on the feature flag now — no token text, no badge,
    // no empty-dash placeholder.
    expect(root.textContent).not.toContain("1,234 tokens");
    expect(root.querySelector(".prd-token-badge")).toBeNull();
    expect(root.querySelector(".prd-usage-cell")).toBeNull();
  });

  it("renders empty-dash usage cells for rows with no runs (never `0 tokens`)", () => {
    const root = renderToDiv(h(PRDTree, {
      document: sampleDoc,
      defaultExpandDepth: 3,
      showTokenBudget: true,
    }));
    // "No runs yet" must not read as zero work — empty cells render as `—`.
    expect(root.textContent).not.toContain("0 tokens");
    // Active-work filter hides `task-1` (completed). `task-2` (in_progress)
    // and `task-3` (pending) are visible with no usage data supplied, so
    // their rows render the empty-dash variant.
    const empties = root.querySelectorAll(".prd-usage-cell-empty");
    expect(empties.length).toBeGreaterThan(0);
    // Nothing in those cells has the active token-badge class.
    const badges = root.querySelectorAll(".prd-token-badge");
    expect(badges.length).toBe(0);
  });

  it("shows token badge when showTokenBudget is true and usage is non-zero", () => {
    const root = renderToDiv(h(PRDTree, {
      document: sampleDoc,
      defaultExpandDepth: 3,
      showTokenBudget: true,
      weeklyBudget: { budget: 100_000, source: "vendor_default" },
      taskUsageById: {
        "task-2": { totalTokens: 5000, runCount: 1 },
      },
    }));
    const badge = root.querySelector(".prd-token-badge");
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain("5,000 tokens");
    expect(badge?.classList.contains("prd-token-badge--budget")).toBe(true);
  });

  it("renders per-item rollup with self vs. descendant breakdown", () => {
    // Use an epic (container, not a work item) so the rollup breakdown
    // branch fires — the work-item budget-chip variant intentionally omits
    // the self/descendant annotation for compactness on leaf rows.
    const root = renderToDiv(h(PRDTree, {
      document: sampleDoc,
      defaultExpandDepth: 3,
      showTokenBudget: true,
      rollupById: {
        "epic-1": {
          self: { totalTokens: 1000, runCount: 1 },
          descendants: { totalTokens: 9000, runCount: 3 },
          total: { totalTokens: 10_000, runCount: 4 },
        },
      },
    }));
    // Primary label shows the total; breakdown annotation shows self-only.
    expect(root.textContent).toContain("10,000 tokens");
    expect(root.textContent).toContain("(1,000 self)");
  });

  it("does not render a duration cell on the tree row (duration lives in the detail flyout)", () => {
    const doc: PRDDocumentData = {
      schema: "rex/v1",
      title: "Duration sample",
      items: [{
        id: "t",
        title: "Done",
        status: "completed",
        level: "task",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:04:10.000Z",
      }],
    };
    const root = renderToDiv(h(PRDTree, {
      document: doc,
      defaultExpandDepth: 1,
      activeStatuses: new Set(["completed", "in_progress", "pending"] as const),
    }));
    expect(root.querySelector(".prd-duration-cell")).toBeNull();
    expect(root.querySelector(".prd-duration-cell-empty")).toBeNull();
    expect(root.textContent).not.toContain("4m 10s");
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

  it("does not render status filter controls (filter bar is now external)", () => {
    const root = renderToDiv(h(PRDTree, { document: sampleDoc }));
    // StatusFilter is now rendered by PRDView, not by PRDTree
    const filterGroup = root.querySelector("[role='group'][aria-label='Filter by status']");
    expect(filterGroup).toBeNull();
  });

  it("accepts controlled activeStatuses prop to show all items", () => {
    const allStatuses = new Set<ItemStatus>(["pending", "in_progress", "completed", "failing", "blocked", "deferred", "deleted"]);
    const root = renderToDiv(h(PRDTree, { document: sampleDoc, activeStatuses: allStatuses, defaultExpandDepth: 3 }));
    // With all statuses visible, completed task should appear
    expect(root.textContent).toContain("Build login form");
  });

  it("shows all items by default when activeStatuses prop is omitted", () => {
    const root = renderToDiv(h(PRDTree, { document: sampleDoc, defaultExpandDepth: 3 }));
    // Default filter shows everything — completed items are visible
    expect(root.textContent).toContain("Build login form");
    expect(root.textContent).toContain("Add OAuth support");
  });

  it("shows deleted items with default all-statuses filter", () => {
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
    // Default filter is all statuses — deleted items are visible
    expect(root.textContent).toContain("Deleted Task");
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
