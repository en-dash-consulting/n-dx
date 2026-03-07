// @vitest-environment jsdom
/**
 * Integration tests for virtual scroll rendering in PRDTree.
 *
 * Verifies that the PRDTree component correctly renders all items when the
 * scroll container has no measured height (jsdom / initial render) and that
 * the virtual scroll infrastructure (spacer elements, container classes)
 * is present and functional.
 *
 * Note: In jsdom, element dimensions are always 0, so virtual scrolling
 * falls back to rendering all items. The pure function tests in
 * virtual-scroll.test.ts cover the viewport-based slicing logic.
 *
 * IMPORTANT: This file avoids vi.stubGlobal(), vi.useFakeTimers(), and any
 * global mocking to prevent test isolation leaks to parallel test files.
 */
import { describe, it, expect, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { PRDTree } from "../../../src/viewer/components/prd-tree/prd-tree.js";
import type { PRDDocumentData, PRDItemData } from "../../../src/viewer/components/prd-tree/types.js";

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

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("PRDTree virtual scroll integration", () => {
  describe("small trees (renders all items)", () => {
    it("renders all nodes for a small tree", () => {
      const doc = generateLargeDoc(10);
      // 1 epic + 1 feature + 10 tasks = 12
      const root = renderToDiv(h(PRDTree, { document: doc, defaultExpandDepth: 3 }));

      // All tasks visible
      expect(root.textContent).toContain("Task 0");
      expect(root.textContent).toContain("Task 9");
    });

    it("does not show load more UI (replaced by virtual scroll)", () => {
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

  describe("virtual scroll container", () => {
    it("renders tree with virtual scroll container class", () => {
      const doc = generateLargeDoc(10);
      const root = renderToDiv(h(PRDTree, { document: doc, defaultExpandDepth: 3 }));

      const tree = root.querySelector(".prd-tree-virtual");
      expect(tree).not.toBeNull();
    });

    it("has tree role on the virtual scroll container", () => {
      const doc = generateLargeDoc(10);
      const root = renderToDiv(h(PRDTree, { document: doc, defaultExpandDepth: 3 }));

      const tree = root.querySelector(".prd-tree-virtual");
      expect(tree!.getAttribute("role")).toBe("tree");
    });

    it("has accessible label on the virtual scroll container", () => {
      const doc = generateLargeDoc(10);
      const root = renderToDiv(h(PRDTree, { document: doc, defaultExpandDepth: 3 }));

      const tree = root.querySelector(".prd-tree-virtual");
      expect(tree!.getAttribute("aria-label")).toBe("PRD hierarchy");
    });
  });

  describe("large trees (fallback rendering without measured container)", () => {
    it("renders all nodes when container has no measured height (jsdom)", () => {
      // In jsdom, clientHeight is 0, so virtual scrolling renders all items
      const doc = generateLargeDoc(100);
      const root = renderToDiv(h(PRDTree, { document: doc, defaultExpandDepth: 3 }));

      // 1 epic + 1 feature + 100 tasks = 102 visible nodes
      const nodeCount = countNodeRows(root);
      expect(nodeCount).toBe(102);
    });

    it("renders 500+ item tree completely in fallback mode", () => {
      const doc = generateLargeDoc(500);
      const root = renderToDiv(h(PRDTree, { document: doc, defaultExpandDepth: 3 }));

      const nodeCount = countNodeRows(root);
      // 1 epic + 1 feature + 500 tasks = 502
      expect(nodeCount).toBe(502);
    });

    it("does not show load more UI for large trees (virtual scroll replaces it)", () => {
      const doc = generateLargeDoc(100);
      const root = renderToDiv(h(PRDTree, { document: doc, defaultExpandDepth: 3 }));

      expect(root.querySelector(".prd-load-more")).toBeNull();
    });
  });

  describe("expansion and collapse", () => {
    it("respects defaultExpandDepth for rendering", () => {
      const doc = generateLargeDoc(10);

      // Depth 0 = only epics visible
      const root0 = renderToDiv(h(PRDTree, { document: doc, defaultExpandDepth: 0 }));
      expect(root0.textContent).toContain("Big Epic");
      expect(root0.textContent).not.toContain("Big Feature");

      // Depth 3 = epics + features + tasks visible
      const root3 = renderToDiv(h(PRDTree, { document: doc, defaultExpandDepth: 3 }));
      expect(root3.textContent).toContain("Big Feature");
      expect(root3.textContent).toContain("Task 0");
    });

    it("renders node rows as flat list (no nested prd-children)", () => {
      const doc = generateLargeDoc(5);
      const root = renderToDiv(h(PRDTree, { document: doc, defaultExpandDepth: 3 }));

      // With virtual scrolling, node rows are flat siblings — no nested
      // .prd-children wrappers (those were part of the recursive renderer)
      const tree = root.querySelector(".prd-tree-virtual");
      const nodeRows = tree!.querySelectorAll(".prd-node-row");
      expect(nodeRows.length).toBe(7); // 1 epic + 1 feature + 5 tasks
    });

    it("renders correct depth-based indentation", () => {
      const doc = generateLargeDoc(2);
      const root = renderToDiv(h(PRDTree, { document: doc, defaultExpandDepth: 3 }));

      const nodeRows = root.querySelectorAll(".prd-node-row");
      // Epic at depth 0: padding-left = 0*24 + 8 = 8px
      expect(nodeRows[0].getAttribute("style")).toContain("padding-left: 8px");
      // Feature at depth 1: padding-left = 1*24 + 8 = 32px
      expect(nodeRows[1].getAttribute("style")).toContain("padding-left: 32px");
      // Task at depth 2: padding-left = 2*24 + 8 = 56px
      expect(nodeRows[2].getAttribute("style")).toContain("padding-left: 56px");
    });
  });

  describe("filter interaction", () => {
    it("summary bar always shows stats for full tree (not sliced)", () => {
      const doc = generateLargeDoc(100);
      const root = renderToDiv(
        h(PRDTree, { document: doc, defaultExpandDepth: 3 }),
      );

      // Summary bar should reflect the full tree, not just the visible slice
      const summary = root.querySelector(".prd-summary-stats");
      expect(summary).not.toBeNull();
      expect(summary!.textContent).toContain("Pending");
    });
  });

  describe("accessibility", () => {
    it("node rows have proper ARIA attributes", () => {
      const doc = generateLargeDoc(3);
      const root = renderToDiv(h(PRDTree, { document: doc, defaultExpandDepth: 3 }));

      const nodeRows = root.querySelectorAll("[role='treeitem']");
      expect(nodeRows.length).toBeGreaterThan(0);

      // Expandable nodes have aria-expanded
      const epic = root.querySelector("[data-node-id='epic-1']");
      expect(epic!.getAttribute("aria-expanded")).toBe("true");
    });

    it("virtual spacers are hidden from screen readers", () => {
      const doc = generateLargeDoc(100);
      const root = renderToDiv(h(PRDTree, { document: doc, defaultExpandDepth: 3 }));

      const spacers = root.querySelectorAll(".prd-virtual-spacer");
      for (const spacer of spacers) {
        expect(spacer.getAttribute("aria-hidden")).toBe("true");
      }
    });
  });

  describe("backward compatibility", () => {
    it("accepts chunkSize prop without errors (deprecated, ignored)", () => {
      const doc = generateLargeDoc(10);
      // chunkSize is accepted but has no effect with virtual scrolling
      expect(() => {
        renderToDiv(h(PRDTree, { document: doc, defaultExpandDepth: 3, chunkSize: 5 }));
      }).not.toThrow();
    });
  });
});
