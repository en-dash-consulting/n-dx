// @vitest-environment jsdom
/**
 * Integration tests for progressive tree loading in PRDTree.
 *
 * Verifies that the PRDTree component correctly limits rendering for large
 * datasets, shows the "Load More" indicator, and supports on-demand chunk
 * loading. Also confirms that small trees render without any progressive
 * loading UI.
 *
 * IMPORTANT: This file avoids vi.stubGlobal(), vi.useFakeTimers(), and any
 * global mocking to prevent test isolation leaks to parallel test files.
 */
import { describe, it, expect, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { PRDTree } from "../../../src/viewer/components/prd-tree/prd-tree.js";
import type { PRDDocumentData, PRDItemData } from "../../../src/viewer/components/prd-tree/types.js";
import { PROGRESSIVE_THRESHOLD } from "../../../src/viewer/components/prd-tree/progressive-loader.js";

// ─── jsdom polyfills ────────────────────────────────────────────────────────

// jsdom doesn't implement scrollIntoView
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function renderToDiv(vnode: ReturnType<typeof h>) {
  const root = document.createElement("div");
  act(() => {
    render(vnode, root);
  });
  return root;
}

/** Generate a large PRD document with many tasks. */
function generateLargeDoc(taskCount: number): PRDDocumentData {
  const tasks: PRDItemData[] = Array.from({ length: taskCount }, (_, i) => ({
    id: `task-${i}`,
    title: `Task ${i}`,
    level: "task" as const,
    status: "pending" as const,
  }));

  return {
    schema: "rex/v1",
    title: "Large Project",
    items: [
      {
        id: "epic-1",
        title: "Big Epic",
        level: "epic",
        status: "in_progress",
        children: [
          {
            id: "feature-1",
            title: "Big Feature",
            level: "feature",
            status: "in_progress",
            children: tasks,
          },
        ],
      },
    ],
  };
}

/** Count all rendered tree node rows in the DOM. */
function countNodeRows(root: HTMLElement): number {
  return root.querySelectorAll(".prd-node-row").length;
}

/**
 * Wait for pending requestAnimationFrame callbacks and Preact batches.
 * Uses a real rAF + setTimeout round-trip (no fake timers) so we
 * don't pollute the global timer state for parallel test files.
 */
function waitForFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      // One more tick to let Preact flush the state update
      setTimeout(resolve, 0);
    });
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("PRDTree progressive loading integration", () => {
  describe("small trees (no progressive loading)", () => {
    it("renders all nodes when tree is under threshold", () => {
      const doc = generateLargeDoc(10);
      // 1 epic + 1 feature + 10 tasks = 12, under threshold of 50
      const root = renderToDiv(h(PRDTree, { document: doc, defaultExpandDepth: 3 }));

      // No load more indicator
      expect(root.querySelector(".prd-load-more")).toBeNull();
      // All tasks visible
      expect(root.textContent).toContain("Task 0");
      expect(root.textContent).toContain("Task 9");
    });

    it("does not show load more for a tiny tree", () => {
      const doc: PRDDocumentData = {
        schema: "rex/v1",
        title: "Small",
        items: [
          { id: "t1", title: "Only Task", level: "task", status: "pending" },
        ],
      };
      const root = renderToDiv(h(PRDTree, { document: doc }));
      expect(root.querySelector(".prd-load-more")).toBeNull();
    });
  });

  describe("large trees (progressive loading active)", () => {
    it("limits rendered nodes to chunkSize", () => {
      // 1 epic + 1 feature + 100 tasks = 102 visible nodes
      const doc = generateLargeDoc(100);
      const chunkSize = 20;
      const root = renderToDiv(
        h(PRDTree, { document: doc, defaultExpandDepth: 3, chunkSize }),
      );

      // Should render fewer nodes than total
      const nodeCount = countNodeRows(root);
      expect(nodeCount).toBeLessThanOrEqual(chunkSize);
      expect(nodeCount).toBeGreaterThan(0);
    });

    it("shows load more indicator for large trees", () => {
      const doc = generateLargeDoc(100);
      const root = renderToDiv(
        h(PRDTree, { document: doc, defaultExpandDepth: 3, chunkSize: 20 }),
      );

      const loadMore = root.querySelector(".prd-load-more");
      expect(loadMore).not.toBeNull();
      expect(loadMore!.textContent).toContain("of");
      expect(loadMore!.textContent).toContain("nodes");
    });

    it("displays correct counts in load more indicator", () => {
      // 1 epic + 1 feature + 100 tasks = 102 total visible nodes
      const doc = generateLargeDoc(100);
      const root = renderToDiv(
        h(PRDTree, { document: doc, defaultExpandDepth: 3, chunkSize: 20 }),
      );

      const info = root.querySelector(".prd-load-more-info");
      expect(info).not.toBeNull();
      expect(info!.textContent).toContain("Showing 20 of 102 nodes");
    });

    it("has load more and load all buttons", () => {
      const doc = generateLargeDoc(100);
      const root = renderToDiv(
        h(PRDTree, { document: doc, defaultExpandDepth: 3, chunkSize: 20 }),
      );

      const primary = root.querySelector(".prd-load-more-btn-primary");
      const secondary = root.querySelector(".prd-load-more-btn-secondary");
      expect(primary).not.toBeNull();
      expect(secondary).not.toBeNull();
      expect(primary!.textContent).toContain("Load 20 more");
      expect(secondary!.textContent).toContain("Load all");
    });

    it("loads more nodes when load more button is clicked", async () => {
      const doc = generateLargeDoc(100);
      const chunkSize = 20;
      const root = document.createElement("div");

      act(() => {
        render(h(PRDTree, { document: doc, defaultExpandDepth: 3, chunkSize }), root);
      });

      const initialCount = countNodeRows(root);

      // Click "Load More" — the hook uses rAF internally
      const loadMoreBtn = root.querySelector(".prd-load-more-btn-primary") as HTMLButtonElement;
      act(() => {
        loadMoreBtn.click();
      });

      // Wait for the rAF callback and Preact re-render
      await act(async () => {
        await waitForFrame();
      });

      const newCount = countNodeRows(root);
      expect(newCount).toBeGreaterThan(initialCount);
    });

    it("loads all remaining nodes when load all button is clicked", async () => {
      const doc = generateLargeDoc(100);
      const root = document.createElement("div");

      act(() => {
        render(h(PRDTree, { document: doc, defaultExpandDepth: 3, chunkSize: 20 }), root);
      });

      // Click "Load All"
      const loadAllBtn = root.querySelector(".prd-load-more-btn-secondary") as HTMLButtonElement;
      act(() => {
        loadAllBtn.click();
      });

      await act(async () => {
        await waitForFrame();
      });

      // Load more indicator should be gone — all nodes are rendered
      expect(root.querySelector(".prd-load-more")).toBeNull();
    });

    it("uses configurable chunkSize prop", () => {
      const doc = generateLargeDoc(200);

      // Small chunk size
      const root10 = renderToDiv(
        h(PRDTree, { document: doc, defaultExpandDepth: 3, chunkSize: 10 }),
      );
      const count10 = countNodeRows(root10);

      // Larger chunk size
      const root30 = renderToDiv(
        h(PRDTree, { document: doc, defaultExpandDepth: 3, chunkSize: 30 }),
      );
      const count30 = countNodeRows(root30);

      expect(count30).toBeGreaterThan(count10);
    });
  });

  describe("filter interaction", () => {
    it("summary bar always shows stats for full tree (not sliced)", () => {
      const doc = generateLargeDoc(100);
      const root = renderToDiv(
        h(PRDTree, { document: doc, defaultExpandDepth: 3, chunkSize: 20 }),
      );

      // Summary bar should reflect the full tree, not just the visible slice
      const summary = root.querySelector(".prd-summary-stats");
      expect(summary).not.toBeNull();
      expect(summary!.textContent).toContain("Pending");
    });
  });

  describe("progressive threshold", () => {
    it("does not show load more when visible count equals threshold", () => {
      // Create a tree with exactly PROGRESSIVE_THRESHOLD visible nodes
      // threshold = 50, so 48 tasks + 1 feature + 1 epic = 50
      const doc = generateLargeDoc(PROGRESSIVE_THRESHOLD - 2);
      const root = renderToDiv(
        h(PRDTree, { document: doc, defaultExpandDepth: 3, chunkSize: PROGRESSIVE_THRESHOLD }),
      );

      expect(root.querySelector(".prd-load-more")).toBeNull();
    });

    it("shows load more when visible count exceeds threshold", () => {
      // 50 tasks + 1 feature + 1 epic = 52 > threshold of 50
      const doc = generateLargeDoc(PROGRESSIVE_THRESHOLD);
      const root = renderToDiv(
        h(PRDTree, { document: doc, defaultExpandDepth: 3, chunkSize: PROGRESSIVE_THRESHOLD }),
      );

      expect(root.querySelector(".prd-load-more")).not.toBeNull();
    });
  });

  describe("accessibility", () => {
    it("load more region has role=status for screen readers", () => {
      const doc = generateLargeDoc(100);
      const root = renderToDiv(
        h(PRDTree, { document: doc, defaultExpandDepth: 3, chunkSize: 20 }),
      );

      const loadMore = root.querySelector(".prd-load-more");
      expect(loadMore!.getAttribute("role")).toBe("status");
    });

    it("load more region has aria-live for live announcements", () => {
      const doc = generateLargeDoc(100);
      const root = renderToDiv(
        h(PRDTree, { document: doc, defaultExpandDepth: 3, chunkSize: 20 }),
      );

      const loadMore = root.querySelector(".prd-load-more");
      expect(loadMore!.getAttribute("aria-live")).toBe("polite");
    });

    it("progress bar has correct ARIA attributes", () => {
      const doc = generateLargeDoc(100);
      const root = renderToDiv(
        h(PRDTree, { document: doc, defaultExpandDepth: 3, chunkSize: 20 }),
      );

      // Query within the load more indicator (not the summary bar progress)
      const loadMore = root.querySelector(".prd-load-more");
      expect(loadMore).not.toBeNull();
      const progressBar = loadMore!.querySelector("[role='progressbar']");
      expect(progressBar).not.toBeNull();
      expect(progressBar!.getAttribute("aria-valuenow")).toBe("20");
      expect(progressBar!.getAttribute("aria-valuemax")).toBe("102");
    });
  });
});
