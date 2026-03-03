// @vitest-environment jsdom
/**
 * Integration tests for virtual scroll rendering in PRDTree.
 *
 * The old CulledNode + IntersectionObserver culling approach has been replaced
 * by virtual scrolling (see virtual-scroll.ts). These tests verify that the
 * virtual scroll container renders correctly, nodes are laid out as a flat
 * list, and the tree remains functional without the old culling infrastructure.
 *
 * Pure function tests for the virtual scroll engine live in virtual-scroll.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { PRDTree } from "../../../src/viewer/components/prd-tree/prd-tree.js";
import type { PRDDocumentData } from "../../../src/viewer/components/prd-tree/types.js";

// ─── jsdom polyfills ─────────────────────────────────────────────────────────

// jsdom doesn't implement scrollIntoView
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}

// ─── Test data ───────────────────────────────────────────────────────────────

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
          title: "Build login form",
          status: "in_progress",
          level: "task",
        },
        {
          id: "task-2",
          title: "Add OAuth support",
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
    },
  ],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderToDiv(vnode: ReturnType<typeof h>) {
  const root = document.createElement("div");
  act(() => {
    render(vnode, root);
  });
  return root;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("PRDTree virtual scroll rendering", () => {
  it("renders all nodes in the flat virtual list", () => {
    const root = renderToDiv(h(PRDTree, { document: sampleDoc, defaultExpandDepth: 2 }));
    expect(root.textContent).toContain("Authentication");
    expect(root.textContent).toContain("Dashboard");
    expect(root.textContent).toContain("Add OAuth support");
  });

  it("renders the virtual scroll container with correct classes", () => {
    const root = renderToDiv(h(PRDTree, { document: sampleDoc }));
    const tree = root.querySelector(".prd-tree.prd-tree-virtual");
    expect(tree).not.toBeNull();
  });

  it("renders node rows directly inside the tree container (flat layout)", () => {
    const root = renderToDiv(h(PRDTree, { document: sampleDoc, defaultExpandDepth: 2 }));
    const tree = root.querySelector(".prd-tree-virtual");
    const nodeRows = tree!.querySelectorAll(".prd-node-row");
    // All expanded visible items rendered as flat siblings
    expect(nodeRows.length).toBeGreaterThan(0);
    // No nested .prd-children wrappers (old recursive approach)
    expect(tree!.querySelector(".prd-children")).toBeNull();
  });

  it("does not use IntersectionObserver for culling", () => {
    // Virtual scrolling replaces IntersectionObserver-based culling.
    // No .prd-node-culled placeholders should appear.
    const root = renderToDiv(h(PRDTree, { document: sampleDoc, defaultExpandDepth: 2 }));
    expect(root.querySelector(".prd-node-culled")).toBeNull();
  });

  it("does not render CulledNode wrapper divs", () => {
    // Old approach wrapped each item in .prd-node; virtual scroll renders flat
    const root = renderToDiv(h(PRDTree, { document: sampleDoc, defaultExpandDepth: 2 }));
    // .prd-node wrappers should not exist in the virtual scroll tree
    const tree = root.querySelector(".prd-tree-virtual");
    expect(tree!.querySelector(".prd-node")).toBeNull();
  });

  it("renders highlighted nodes without special culling protection", () => {
    // In the old approach, highlighted nodes had neverCull=true.
    // With virtual scrolling, highlighted nodes are just normal items.
    const root = renderToDiv(h(PRDTree, {
      document: sampleDoc,
      defaultExpandDepth: 2,
      highlightedItemId: "epic-2",
      deepLinkExpandIds: new Set<string>(),
    }));

    // Dashboard should be visible
    expect(root.textContent).toContain("Dashboard");

    // The highlighted node should have the highlight class
    const highlightedNode = root.querySelector(".prd-node-highlighted");
    expect(highlightedNode).not.toBeNull();
    expect(highlightedNode!.textContent).toContain("Dashboard");
  });

  it("renders event target data attributes on node rows", () => {
    // Event delegation relies on data-node-id attributes
    const root = renderToDiv(h(PRDTree, { document: sampleDoc, defaultExpandDepth: 2 }));

    const epicRow = root.querySelector("[data-node-id='epic-1']");
    expect(epicRow).not.toBeNull();
    // Expandable nodes have data-has-children
    expect(epicRow!.hasAttribute("data-has-children")).toBe(true);

    const taskRow = root.querySelector("[data-node-id='task-1']");
    expect(taskRow).not.toBeNull();
  });

  it("renders proper ARIA attributes on tree items", () => {
    const root = renderToDiv(h(PRDTree, { document: sampleDoc, defaultExpandDepth: 2 }));

    const treeItems = root.querySelectorAll("[role='treeitem']");
    expect(treeItems.length).toBeGreaterThan(0);

    // Epic (expanded) should have aria-expanded="true"
    const epicRow = root.querySelector("[data-node-id='epic-1']");
    expect(epicRow!.getAttribute("aria-expanded")).toBe("true");

    // Leaf node should not have aria-expanded
    const taskRow = root.querySelector("[data-node-id='task-1']");
    expect(taskRow!.getAttribute("aria-expanded")).toBeNull();
  });

  it("cleans up when component unmounts", () => {
    const root = document.createElement("div");
    act(() => {
      render(h(PRDTree, { document: sampleDoc }), root);
    });

    // Verify component is rendered
    expect(root.querySelector(".prd-tree-virtual")).not.toBeNull();

    // Unmount
    act(() => {
      render(null, root);
    });

    // Verify cleanup
    expect(root.querySelector(".prd-tree-virtual")).toBeNull();
  });

  it("renders inline delete buttons when onRemoveItem is provided", () => {
    const root = renderToDiv(h(PRDTree, {
      document: sampleDoc,
      defaultExpandDepth: 2,
      onSelectItem: vi.fn(),
      onRemoveItem: vi.fn(),
    }));

    const deleteButtons = root.querySelectorAll(".prd-node-action-delete");
    expect(deleteButtons.length).toBeGreaterThan(0);
  });

  it("renders correct depth indentation for all visible items", () => {
    const root = renderToDiv(h(PRDTree, { document: sampleDoc, defaultExpandDepth: 2 }));

    // Epic-1 at depth 0: padding-left: 8px
    const epic = root.querySelector("[data-node-id='epic-1']") as HTMLElement;
    expect(epic.style.paddingLeft).toBe("8px");

    // Task-1 at depth 1: padding-left: 32px
    const task = root.querySelector("[data-node-id='task-1']") as HTMLElement;
    expect(task.style.paddingLeft).toBe("32px");
  });

  it("renders all tree items in correct order", () => {
    const root = renderToDiv(h(PRDTree, { document: sampleDoc, defaultExpandDepth: 2 }));

    const nodeRows = root.querySelectorAll("[role='treeitem']");
    const ids = Array.from(nodeRows).map(el => el.getAttribute("data-node-id"));

    // Depth-first, pre-order: epic-1 → task-1 → task-2 → epic-2
    expect(ids).toEqual(["epic-1", "task-1", "task-2", "epic-2"]);
  });
});
