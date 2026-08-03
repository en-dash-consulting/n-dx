// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { h } from "preact";
import { TreeView, type TreeNode } from "../../../src/viewer/components/data-display/tree-view.js";
import { renderToDiv } from "../../helpers/preact-test-support.js";

describe("TreeView", () => {
  const nodes: TreeNode[] = [
    {
      id: "root",
      children: [
        {
          id: "child-a",
          children: [
            { id: "grandchild", children: [] },
          ],
        },
        { id: "child-b", children: [] },
      ],
    },
  ];

  const renderNode = (node: TreeNode) => h("span", null, node.id);

  it("renders root nodes", () => {
    const root = renderToDiv(h(TreeView, { nodes, renderNode }));
    expect(root.textContent).toContain("root");
  });

  it("renders children within default expand depth", () => {
    const root = renderToDiv(h(TreeView, { nodes, renderNode, defaultExpandDepth: 2 }));
    expect(root.textContent).toContain("child-a");
    expect(root.textContent).toContain("child-b");
  });

  it("respects defaultExpandDepth=0 by not showing children", () => {
    const root = renderToDiv(h(TreeView, { nodes, renderNode, defaultExpandDepth: 0 }));
    expect(root.textContent).toContain("root");
    expect(root.textContent).not.toContain("child-a");
  });

  it("renders with filterMatch expanding matching nodes", () => {
    const matchSet = new Set(["grandchild"]);
    const root = renderToDiv(h(TreeView, { nodes, renderNode, filterMatch: matchSet }));
    expect(root.textContent).toContain("grandchild");
  });

  it("renders tree role for accessibility", () => {
    const root = renderToDiv(h(TreeView, { nodes, renderNode }));
    const tree = root.querySelector("[role='tree']");
    expect(tree).not.toBeNull();
  });

  it("gives role=treeitem to all nodes, including leaves", () => {
    const root = renderToDiv(h(TreeView, { nodes, renderNode, defaultExpandDepth: 3 }));
    // All four nodes (root, child-a, grandchild, child-b) should have role=treeitem
    const treeitems = root.querySelectorAll("[role='treeitem']");
    expect(treeitems.length).toBe(4);
  });

  it("applies aria-expanded only to nodes with children", () => {
    const root = renderToDiv(h(TreeView, { nodes, renderNode, defaultExpandDepth: 3 }));
    const withExpanded = Array.from(root.querySelectorAll("[aria-expanded]"));
    // Only root and child-a have children
    expect(withExpanded.length).toBe(2);
    // Leaves must not have aria-expanded
    const grandchild = Array.from(root.querySelectorAll("[role='treeitem']")).find(
      (el) => el.textContent?.includes("grandchild"),
    );
    expect(grandchild?.hasAttribute("aria-expanded")).toBe(false);
  });

  it("uses roving tabIndex — first item tabIndex=0, rest tabIndex=-1", () => {
    const root = renderToDiv(h(TreeView, { nodes, renderNode, defaultExpandDepth: 3 }));
    const treeitems = Array.from(root.querySelectorAll<HTMLElement>("[role='treeitem']"));
    const zeroCount = treeitems.filter((el) => el.tabIndex === 0).length;
    const negCount = treeitems.filter((el) => el.tabIndex === -1).length;
    expect(zeroCount).toBe(1);
    expect(negCount).toBe(treeitems.length - 1);
  });

  it("exposes data-tree-id on each treeitem", () => {
    const root = renderToDiv(h(TreeView, { nodes, renderNode, defaultExpandDepth: 3 }));
    const treeitems = Array.from(root.querySelectorAll<HTMLElement>("[role='treeitem']"));
    const ids = treeitems.map((el) => el.dataset.treeId);
    expect(ids).toContain("root");
    expect(ids).toContain("child-a");
    expect(ids).toContain("grandchild");
    expect(ids).toContain("child-b");
  });
});
