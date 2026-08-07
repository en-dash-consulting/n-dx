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

  it("keeps a tab target when a filter hides the first root node", () => {
    const twoRoots: TreeNode[] = [
      { id: "alpha", children: [] },
      { id: "beta", children: [] },
    ];
    // Filter matches only the second root — "alpha" is not rendered.
    const root = renderToDiv(
      h(TreeView, { nodes: twoRoots, renderNode, filterMatch: new Set(["beta"]) }),
    );
    const treeitems = Array.from(root.querySelectorAll<HTMLElement>("[role='treeitem']"));
    expect(treeitems.length).toBe(1);
    // The remaining visible node must own tabIndex=0 or the tree is
    // unreachable by keyboard.
    expect(treeitems[0].tabIndex).toBe(0);
    expect(treeitems[0].dataset.treeId).toBe("beta");
  });

  it("exposes aria-level, aria-setsize, and aria-posinset on treeitems", () => {
    const root = renderToDiv(h(TreeView, { nodes, renderNode, defaultExpandDepth: 3 }));
    const items = Array.from(root.querySelectorAll<HTMLElement>("[role='treeitem']"));
    const byId = new Map(items.map((el) => [el.dataset.treeId, el]));
    expect(byId.get("root")?.getAttribute("aria-level")).toBe("1");
    expect(byId.get("child-a")?.getAttribute("aria-level")).toBe("2");
    expect(byId.get("grandchild")?.getAttribute("aria-level")).toBe("3");
    expect(byId.get("child-a")?.getAttribute("aria-setsize")).toBe("2");
    expect(byId.get("child-a")?.getAttribute("aria-posinset")).toBe("1");
    expect(byId.get("child-b")?.getAttribute("aria-posinset")).toBe("2");
  });

  it("does not expose the role-less wrapper between tree and treeitem", () => {
    const root = renderToDiv(h(TreeView, { nodes, renderNode }));
    const wrappers = Array.from(root.querySelectorAll<HTMLElement>(".tree-node"));
    expect(wrappers.length).toBeGreaterThan(0);
    for (const w of wrappers) {
      expect(w.getAttribute("role")).toBe("none");
    }
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
