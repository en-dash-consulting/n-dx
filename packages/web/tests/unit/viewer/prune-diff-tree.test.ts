// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { PruneDiffTree } from "../../../src/viewer/components/prd-tree/prune-diff-tree.js";
import type { EpicImpact } from "../../../src/viewer/components/prd-tree/prune-diff-tree.js";
import type { PRDDocumentData } from "../../../src/viewer/components/prd-tree/types.js";

const sampleDoc: PRDDocumentData = {
  schema: "rex/v1",
  title: "Test Project",
  items: [
    {
      id: "epic-1",
      title: "Authentication",
      status: "in_progress",
      level: "epic",
      children: [
        {
          id: "task-1",
          title: "Login Form",
          status: "completed",
          level: "task",
          completedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "task-2",
          title: "OAuth Support",
          status: "in_progress",
          level: "task",
        },
        {
          id: "task-3",
          title: "Error Handling",
          status: "pending",
          level: "task",
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
          title: "Layout",
          status: "pending",
          level: "task",
        },
      ],
    },
  ],
};

const sampleEpicImpact: EpicImpact[] = [
  {
    id: "epic-1",
    title: "Authentication",
    before: { total: 3, completed: 1, pct: 33 },
    after: { total: 2, completed: 0, pct: 0 },
    removedCount: 1,
  },
];

/**
 * Render the component and wait for the async data fetch to complete.
 * Uses the onLoad callback to know when data has loaded.
 */
async function renderAndWait(
  prunableIds: Set<string>,
  epicImpact: EpicImpact[],
): Promise<HTMLDivElement> {
  const root = document.createElement("div");

  return new Promise<HTMLDivElement>((resolve) => {
    const onLoad = () => {
      // After data loads, we need one more tick for Preact to re-render
      setTimeout(() => resolve(root), 20);
    };
    render(
      h(PruneDiffTree, { prunableIds, epicImpact, onLoad }),
      root,
    );
  });
}

describe("PruneDiffTree", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  /** Container for cleaning up rendered components. */
  let cleanupRoot: HTMLDivElement | null = null;

  beforeEach(() => {
    // Use mockImplementation to return a fresh Response each call
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify(sampleDoc), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  afterEach(() => {
    // Unmount any rendered component to prevent stale effects
    if (cleanupRoot) {
      render(null, cleanupRoot);
      cleanupRoot = null;
    }
    fetchSpy.mockRestore();
  });

  it("renders loading state initially", () => {
    const root = document.createElement("div");
    cleanupRoot = root;
    render(
      h(PruneDiffTree, {
        prunableIds: new Set(["task-1"]),
        epicImpact: sampleEpicImpact,
      }),
      root,
    );
    expect(root.querySelector(".prune-diff-loading")).not.toBeNull();
  });

  it("renders tree after loading data", async () => {
    const root = await renderAndWait(new Set(["task-1"]), sampleEpicImpact);
    expect(fetchSpy).toHaveBeenCalledWith("/data/prd.json");
    // After load, loading state is gone and diff container appears
    expect(root.querySelector(".prune-diff-loading")).toBeNull();
    const container = root.querySelector(".prune-diff-container");
    expect(container).not.toBeNull();
  });

  it("marks prunable items with strikethrough class", async () => {
    const root = await renderAndWait(new Set(["task-1"]), sampleEpicImpact);

    const prunableRows = root.querySelectorAll(".prune-diff-node-prunable");
    expect(prunableRows.length).toBeGreaterThan(0);

    const prunableTitles = root.querySelectorAll(".prune-diff-title-prunable");
    expect(prunableTitles.length).toBeGreaterThan(0);
  });

  it("marks affected parent with modified indicator", async () => {
    const root = await renderAndWait(new Set(["task-1"]), sampleEpicImpact);

    // epic-1 is an affected parent (has prunable descendant task-1)
    const affectedRows = root.querySelectorAll(".prune-diff-node-affected");
    expect(affectedRows.length).toBeGreaterThan(0);
  });

  it("renders epic impact badge for affected epics", async () => {
    const root = await renderAndWait(new Set(["task-1"]), sampleEpicImpact);

    const impactBadges = root.querySelectorAll(".prune-diff-epic-impact");
    expect(impactBadges.length).toBe(1);

    const badge = impactBadges[0];
    // before: 1/3, after: 0/2
    expect(badge.textContent).toContain("1/3");
    expect(badge.textContent).toContain("0/2");
  });

  it("renders legend with remove and affected indicators", async () => {
    const root = await renderAndWait(new Set(["task-1"]), sampleEpicImpact);

    const legend = root.querySelector(".prune-diff-legend");
    expect(legend).not.toBeNull();
    expect(legend!.textContent).toContain("Will be removed");
    expect(legend!.textContent).toContain("Children affected");
  });

  it("renders filter controls and overall completion impact", async () => {
    const root = await renderAndWait(new Set(["task-1"]), sampleEpicImpact);

    // Filter buttons
    const filterBtns = root.querySelectorAll(".prune-diff-filter-btn");
    expect(filterBtns.length).toBe(2);

    // Overall impact section
    const overallImpact = root.querySelector(".prune-diff-overall-impact");
    expect(overallImpact).not.toBeNull();
  });

  it("filters to only show affected branches by default", async () => {
    const root = await renderAndWait(new Set(["task-1"]), sampleEpicImpact);

    // "Affected" filter should be active by default
    const activeFilter = root.querySelector(".prune-diff-filter-btn.active");
    expect(activeFilter).not.toBeNull();
    expect(activeFilter!.textContent).toBe("Affected");

    // epic-2 (not affected) should not be visible in filtered mode
    const allTitles = Array.from(root.querySelectorAll(".prune-diff-title")).map(
      (el) => el.textContent,
    );
    expect(allTitles).not.toContain("Dashboard");
    // epic-1 (affected) should be visible
    expect(allTitles).toContain("Authentication");
  });

  it("shows remove indicator for prunable items", async () => {
    const root = await renderAndWait(new Set(["task-1"]), sampleEpicImpact);

    const removeIndicators = root.querySelectorAll(".prune-diff-indicator-remove");
    expect(removeIndicators.length).toBeGreaterThan(0);
  });

  it("handles error when PRD fetch fails", async () => {
    fetchSpy.mockReset();
    fetchSpy.mockImplementation(async () => new Response("", { status: 500 }));

    const root = document.createElement("div");
    cleanupRoot = root;
    render(
      h(PruneDiffTree, {
        prunableIds: new Set(["task-1"]),
        epicImpact: sampleEpicImpact,
      }),
      root,
    );

    // Wait for the async fetch to complete and state to update
    await new Promise((r) => setTimeout(r, 50));

    const errorEl = root.querySelector(".prune-diff-error");
    expect(errorEl).not.toBeNull();
  });
});
