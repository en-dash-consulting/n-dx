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
});
