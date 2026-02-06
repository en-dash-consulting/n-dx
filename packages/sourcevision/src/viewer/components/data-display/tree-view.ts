import { h, VNode } from "preact";
import { useState } from "preact/hooks";

export interface TreeNode {
  id: string;
  children: TreeNode[];
  [key: string]: unknown;
}

interface TreeViewProps {
  nodes: TreeNode[];
  renderNode: (node: TreeNode, depth: number) => VNode<any>;
  defaultExpandDepth?: number;
  filterMatch?: Set<string> | null;
}

export function TreeView({
  nodes,
  renderNode,
  defaultExpandDepth = 2,
  filterMatch,
}: TreeViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const set = new Set<string>();
    function autoExpand(ns: TreeNode[], depth: number) {
      for (const n of ns) {
        if (depth < defaultExpandDepth) {
          set.add(n.id);
          autoExpand(n.children, depth + 1);
        }
      }
    }
    autoExpand(nodes, 0);
    return set;
  });

  const effectiveExpanded = filterMatch
    ? expandForFilter(nodes, filterMatch)
    : expanded;

  const toggle = (id: string) => {
    if (filterMatch) return;
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  function renderNodes(ns: TreeNode[], depth: number, parentIsLast = false): VNode<any>[] {
    return ns.map((node, idx) => {
      const hasChildren = node.children.length > 0;
      const isOpen = effectiveExpanded.has(node.id);
      const isLast = idx === ns.length - 1;

      if (filterMatch && !nodeMatchesFilter(node, filterMatch)) return null!;

      const indent = depth * 24;

      return h("div", {
        key: node.id,
        class: "tree-node",
      },
        h("div", {
          class: `tree-node-row${hasChildren ? " tree-node-expandable" : ""}`,
          style: `padding-left: ${indent + 8}px`,
          onClick: hasChildren ? () => toggle(node.id) : undefined,
          role: hasChildren ? "treeitem" : undefined,
          "aria-expanded": hasChildren ? String(isOpen) : undefined,
          tabIndex: hasChildren ? 0 : undefined,
          onKeyDown: hasChildren ? (e: KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(node.id); }
          } : undefined,
        },
          // Connector lines: vertical line from parent, horizontal branch to this node
          depth > 0
            ? h("span", {
                class: `tree-line${isLast ? " tree-line-last" : ""}`,
                style: `left: ${indent - 12}px`,
                "aria-hidden": "true",
              })
            : null,
          // Expand/collapse icon
          h("span", {
            class: `tree-chevron${hasChildren && isOpen ? " tree-chevron-open" : ""}`,
            "aria-hidden": "true",
          },
            hasChildren ? "\u25B6" : "\u2500"
          ),
          // Node content rendered by parent
          h("span", { class: "tree-node-content" },
            renderNode(node, depth)
          ),
        ),
        // Children (indented)
        hasChildren && isOpen
          ? h("div", {
              class: "tree-children",
              role: "group",
            },
              renderNodes(node.children, depth + 1, isLast)
            )
          : null,
      );
    }).filter(Boolean);
  }

  return h("div", {
    class: "route-tree",
    role: "tree",
    "aria-label": "Tree view",
  }, renderNodes(nodes, 0));
}

function expandForFilter(nodes: TreeNode[], matchSet: Set<string>): Set<string> {
  const result = new Set<string>();
  function walk(ns: TreeNode[]): boolean {
    let anyMatch = false;
    for (const n of ns) {
      const childMatch = walk(n.children);
      const selfMatch = matchSet.has(n.id);
      if (selfMatch || childMatch) {
        result.add(n.id);
        anyMatch = true;
      }
    }
    return anyMatch;
  }
  walk(nodes);
  return result;
}

function nodeMatchesFilter(node: TreeNode, matchSet: Set<string>): boolean {
  if (matchSet.has(node.id)) return true;
  return node.children.some((c) => nodeMatchesFilter(c, matchSet));
}
