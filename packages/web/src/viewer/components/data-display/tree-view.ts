import { h, VNode } from "preact";
import { useState, useRef, useEffect } from "preact/hooks";

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

/** Compute the flat list of visible treeitem IDs in DOM order. */
function getVisibleIds(treeEl: HTMLElement): string[] {
  const items = treeEl.querySelectorAll<HTMLElement>("[role='treeitem']");
  return Array.from(items).map((el) => el.dataset.treeId ?? "").filter(Boolean);
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

  // Roving tabIndex: the ID of the treeitem that owns tabIndex=0
  const [focusedId, setFocusedId] = useState<string | null>(() => nodes[0]?.id ?? null);
  const treeRef = useRef<HTMLDivElement>(null);
  // After an expand, we may need to move focus to the first child
  const pendingFocusId = useRef<string | null>(null);

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

  // Visible node IDs in render order, mirroring renderNodes' filter/expand
  // logic. Used to pick the roving-tabindex target: when the focused node is
  // hidden by a filter change, the tab target falls back to the first visible
  // node so the tree always stays keyboard-reachable.
  const visibleIds: string[] = [];
  (function collectVisible(ns: TreeNode[]) {
    for (const n of ns) {
      if (filterMatch && !nodeMatchesFilter(n, filterMatch)) continue;
      visibleIds.push(n.id);
      if (n.children.length > 0 && effectiveExpanded.has(n.id)) collectVisible(n.children);
    }
  })(nodes);
  const tabTargetId =
    focusedId !== null && visibleIds.includes(focusedId)
      ? focusedId
      : visibleIds[0] ?? null;

  // After each render, flush any pending focus request
  useEffect(() => {
    if (!pendingFocusId.current || !treeRef.current) return;
    const target = treeRef.current.querySelector<HTMLElement>(
      `[data-tree-id="${pendingFocusId.current}"]`,
    );
    if (target) {
      pendingFocusId.current = null;
      setFocusedId(target.dataset.treeId ?? null);
      target.focus();
    }
  });

  const moveFocus = (id: string) => {
    setFocusedId(id);
    requestAnimationFrame(() => {
      treeRef.current
        ?.querySelector<HTMLElement>(`[data-tree-id="${id}"]`)
        ?.focus();
    });
  };

  const handleKeyDown = (
    e: KeyboardEvent,
    nodeId: string,
    hasChildren: boolean,
    firstChildId: string | null,
    parentId: string | null,
  ) => {
    const tree = treeRef.current;
    if (!tree) return;

    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        const ids = getVisibleIds(tree);
        const i = ids.indexOf(nodeId);
        if (i < ids.length - 1) moveFocus(ids[i + 1]);
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        const ids = getVisibleIds(tree);
        const i = ids.indexOf(nodeId);
        if (i > 0) moveFocus(ids[i - 1]);
        break;
      }
      case "ArrowRight": {
        e.preventDefault();
        if (!hasChildren) break;
        if (!effectiveExpanded.has(nodeId)) {
          // Expand; pendingFocusId stays null — focus stays on this node per spec
          toggle(nodeId);
        } else if (firstChildId) {
          // Move to first child (already rendered)
          moveFocus(firstChildId);
        }
        break;
      }
      case "ArrowLeft": {
        e.preventDefault();
        if (hasChildren && effectiveExpanded.has(nodeId)) {
          toggle(nodeId); // collapse
        } else if (parentId) {
          moveFocus(parentId); // move to parent
        }
        break;
      }
      case "Home": {
        e.preventDefault();
        const ids = getVisibleIds(tree);
        if (ids.length > 0) moveFocus(ids[0]);
        break;
      }
      case "End": {
        e.preventDefault();
        const ids = getVisibleIds(tree);
        if (ids.length > 0) moveFocus(ids[ids.length - 1]);
        break;
      }
      case "Enter":
      case " ": {
        e.preventDefault();
        if (hasChildren) toggle(nodeId);
        break;
      }
    }
  };

  function renderNodes(
    ns: TreeNode[],
    depth: number,
    parentId: string | null = null,
  ): VNode<any>[] {
    const visibleNs = filterMatch
      ? ns.filter((n) => nodeMatchesFilter(n, filterMatch))
      : ns;
    return visibleNs.map((node, idx) => {
      const hasChildren = node.children.length > 0;
      const isOpen = effectiveExpanded.has(node.id);
      const isLast = idx === visibleNs.length - 1;
      const firstChildId = hasChildren ? node.children[0].id : null;

      const indent = depth * 24;

      return h("div", {
        key: node.id,
        class: "tree-node",
        // The wrapper sits between tree/group and treeitem in the DOM;
        // remove it from the accessibility tree so treeitems stay direct
        // children of their tree/group context.
        role: "none",
      },
        h("div", {
          class: `tree-node-row${hasChildren ? " tree-node-expandable" : ""}`,
          style: `padding-left: ${indent + 8}px`,
          role: "treeitem",
          "aria-expanded": hasChildren ? isOpen : undefined,
          "aria-level": depth + 1,
          "aria-setsize": visibleNs.length,
          "aria-posinset": idx + 1,
          "data-tree-id": node.id,
          tabIndex: node.id === tabTargetId ? 0 : -1,
          onClick: hasChildren ? () => toggle(node.id) : undefined,
          onKeyDown: (e: KeyboardEvent) =>
            handleKeyDown(e, node.id, hasChildren, firstChildId, parentId),
        },
          // Connector lines
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
            hasChildren ? "▶" : "─",
          ),
          // Node content rendered by parent
          h("span", { class: "tree-node-content" },
            renderNode(node, depth),
          ),
        ),
        // Children
        hasChildren && isOpen
          ? h("div", {
              class: "tree-children",
              role: "group",
            },
              renderNodes(node.children, depth + 1, node.id),
            )
          : null,
      );
    });
  }

  return h("div", {
    ref: treeRef,
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
