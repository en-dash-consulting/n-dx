import { h, Fragment } from "preact";
import { useState, useMemo } from "preact/hooks";
import type { LoadedData } from "../types.js";
import type { RouteTreeNode, RouteExportKind, ComponentUsageEdge } from "../external.js";
import { TreeView, type TreeNode, CollapsibleSection, BarChart } from "../visualization/index.js";
import { SearchFilter } from "../components/index.js";
import { BrandedHeader } from "../components/index.js";

interface RoutesViewProps {
  data: LoadedData;
}

function routeToTreeNode(node: RouteTreeNode): TreeNode {
  return {
    id: node.file,
    routePattern: node.routePattern,
    file: node.file,
    children: node.children.map(routeToTreeNode),
  };
}

/** Build a tree of component usage from usageEdges. Root nodes are components that are not used by others. */
function buildComponentTree(
  edges: ComponentUsageEdge[],
  componentFiles: Set<string>,
): TreeNode[] {
  // Build adjacency: from -> children
  const childrenMap = new Map<string, Array<{ name: string; file: string; count: number }>>();
  const usedBy = new Set<string>();

  for (const edge of edges) {
    const key = edge.from;
    let list = childrenMap.get(key);
    if (!list) {
      list = [];
      childrenMap.set(key, list);
    }
    list.push({ name: edge.componentName, file: edge.to, count: edge.usageCount });
    usedBy.add(`${edge.to}:${edge.componentName}`);
  }

  // Roots: files that use components but aren't used themselves, or top-level component files
  const rootFiles = new Set<string>();
  for (const edge of edges) {
    if (!usedBy.has(`${edge.from}:${edge.from.split("/").pop()?.replace(/\.\w+$/, "") || ""}`)) {
      rootFiles.add(edge.from);
    }
  }
  // If no clear roots found, use all files that have children
  if (rootFiles.size === 0) {
    for (const key of childrenMap.keys()) rootFiles.add(key);
  }

  const visited = new Set<string>();
  function buildNode(file: string, depth: number): TreeNode {
    const children: TreeNode[] = [];
    if (depth < 4 && !visited.has(file)) {
      visited.add(file);
      const kids = childrenMap.get(file) ?? [];
      for (const kid of kids) {
        children.push({
          id: `${file}->${kid.file}:${kid.name}`,
          componentName: kid.name,
          file: kid.file,
          usageCount: kid.count,
          children: buildNode(kid.file, depth + 1).children,
        });
      }
      visited.delete(file);
    }
    return { id: file, file, children };
  }

  return [...rootFiles].map((f) => {
    const node = buildNode(f, 0);
    node.file = f;
    return node;
  }).filter((n) => n.children.length > 0);
}

export function RoutesView({ data }: RoutesViewProps) {
  const components = data.components;
  const [search, setSearch] = useState("");

  if (!components) {
    return h("div", { class: "locked-view" },
      h("div", { class: "locked-icon" }, "\u25C7"),
      h("h2", null, "No Component Data"),
      h("p", null, "Run the component analyzer to see routes and component usage."),
      h("div", { class: "locked-hint" },
        h("code", null, "sourcevision analyze")
      )
    );
  }

  const { routeModules, routeTree, usageEdges, summary } = components;
  const componentDefs = components.components;

  const treeNodes = useMemo(
    () => routeTree.map(routeToTreeNode),
    [routeTree]
  );

  const moduleByFile = useMemo(() => {
    const map = new Map<string, typeof routeModules[0]>();
    for (const mod of routeModules) {
      map.set(mod.file, mod);
    }
    return map;
  }, [routeModules]);

  // Component usage tree
  const componentTreeNodes = useMemo(() => {
    if (!usageEdges || usageEdges.length === 0) return [];
    const compFiles = new Set(componentDefs.map((c) => c.file));
    return buildComponentTree(usageEdges, compFiles);
  }, [usageEdges, componentDefs]);

  const filterMatch = useMemo(() => {
    if (!search) return null;
    const q = search.toLowerCase();
    const matched = new Set<string>();
    function walk(nodes: TreeNode[]) {
      for (const n of nodes) {
        const pattern = String(n.routePattern || "").toLowerCase();
        const file = String(n.file || "").toLowerCase();
        if (pattern.includes(q) || file.includes(q)) {
          matched.add(n.id);
        }
        walk(n.children);
      }
    }
    walk(treeNodes);
    return matched;
  }, [search, treeNodes]);

  const conventionData = useMemo(() => {
    const colorMap: Record<string, string> = {
      loader: "#6cb4ee",
      action: "#6cb4ee",
      default: "var(--green)",
      ErrorBoundary: "var(--orange)",
      HydrateFallback: "var(--orange)",
      meta: "var(--purple)",
      links: "var(--purple)",
      headers: "var(--purple)",
      handle: "var(--purple)",
    };
    return Object.entries(summary.routeConventions).map(([kind, count]) => ({
      label: kind,
      value: count as number,
      color: colorMap[kind] || "var(--accent)",
    }));
  }, [summary.routeConventions]);

  const renderRouteNode = (node: TreeNode, depth: number) => {
    const mod = moduleByFile.get(String(node.file));
    return h(Fragment, null,
      h("span", { class: "route-pattern" }, String(node.routePattern || "/")),
      h("span", { class: "route-file" }, String(node.file)),
      ...(mod?.exports ?? []).map((exp) =>
        h("span", {
          key: exp,
          class: `route-badge route-badge-${badgeClass(exp)}`,
        }, exp)
      ),
      mod?.isLayout
        ? h("span", { class: "tag tag-source route-badge" }, "layout")
        : null,
      mod?.isIndex
        ? h("span", { class: "tag tag-test route-badge" }, "index")
        : null,
    );
  };

  const renderComponentNode = (node: TreeNode, depth: number) => {
    const name = node.componentName as string;
    const file = node.file as string;
    const count = node.usageCount as number | undefined;
    return h(Fragment, null,
      name
        ? h("span", { class: "component-name" }, name)
        : h("span", { class: "component-file" }, shortPath(file)),
      name
        ? h("span", { class: "component-file" }, shortPath(file))
        : null,
      count != null && count > 0
        ? h("span", { class: "component-usage-badge" }, `${count}x`)
        : null,
    );
  };

  return h("div", null,
    h("div", { class: "view-header" },
      h(BrandedHeader, { product: "sourcevision", title: "SourceVision", class: "branded-header-sv" }),
      h("h2", { class: "section-header" }, "Routes & Components"),
    ),

    h("div", { class: "stat-grid" },
      h("div", { class: "stat-card" },
        h("div", { class: "value" }, String(summary.totalComponents)),
        h("div", { class: "label" }, "Components")
      ),
      h("div", { class: "stat-card" },
        h("div", { class: "value" }, String(summary.totalRouteModules)),
        h("div", { class: "label" }, "Route Modules")
      ),
      h("div", { class: "stat-card" },
        h("div", { class: "value" }, String(summary.totalUsageEdges)),
        h("div", { class: "label" }, "Usage Edges")
      ),
      h("div", { class: "stat-card" },
        h("div", { class: "value" }, String(summary.layoutDepth)),
        h("div", { class: "label" }, "Layout Depth")
      ),
    ),

    routeTree.length > 0 || componentTreeNodes.length > 0
      ? h(SearchFilter, {
          placeholder: "Search routes, files, or components...",
          value: search,
          onInput: setSearch,
        })
      : null,

    // Route Tree
    treeNodes.length > 0
      ? h(Fragment, null,
          h("h3", { class: "section-header-sm" }, "Route Tree"),
          h(TreeView, {
            nodes: treeNodes,
            renderNode: renderRouteNode,
            defaultExpandDepth: 3,
            filterMatch,
          }),
        )
      : null,

    // Component Usage Tree
    componentTreeNodes.length > 0
      ? h(Fragment, null,
          h("h3", { class: "section-header-sm mt-24" }, "Component Usage Tree"),
          h("p", { class: "section-sub" }, "How components are used across files. Arrows show which files import and render each component."),
          h(TreeView, {
            nodes: componentTreeNodes,
            renderNode: renderComponentNode,
            defaultExpandDepth: 2,
          }),
        )
      : null,

    // Convention Coverage
    conventionData.length > 0
      ? h(Fragment, null,
          h("h3", { class: "section-header-sm mt-24" }, "Convention Coverage"),
          h(BarChart, { data: conventionData }),
        )
      : null,

    // Route Modules Table
    routeModules.length > 0
      ? h(CollapsibleSection, {
          title: "Route Modules",
          count: routeModules.length,
          defaultOpen: true,
          threshold: 20,
        },
          h("div", { class: "data-table-wrapper" },
            h("table", { class: "data-table" },
              h("thead", null,
                h("tr", null,
                  h("th", null, "File"),
                  h("th", null, "Pattern"),
                  h("th", null, "Exports"),
                  h("th", null, "Layout"),
                )
              ),
              h("tbody", null,
                routeModules.map((mod) =>
                  h("tr", { key: mod.file },
                    h("td", null, mod.file),
                    h("td", null, mod.routePattern || h("span", { class: "route-file" }, "(pathless)")),
                    h("td", null,
                      mod.exports.map((exp) =>
                        h("span", {
                          key: exp,
                          class: `route-badge route-badge-${badgeClass(exp)}`,
                        }, exp)
                      )
                    ),
                    h("td", null,
                      mod.isLayout ? h("span", { class: "tag tag-source" }, "layout") : null,
                      mod.isIndex ? h("span", { class: "tag tag-test" }, "index") : null,
                    ),
                  )
                )
              )
            )
          )
        )
      : null,

    // Most Used Components
    summary.mostUsedComponents.length > 0
      ? h(CollapsibleSection, {
          title: "Most Used Components",
          count: summary.mostUsedComponents.length,
          defaultOpen: true,
          threshold: 15,
        },
          h("div", { class: "data-table-wrapper" },
            h("table", { class: "data-table component-usage-table" },
              h("thead", null,
                h("tr", null,
                  h("th", null, "Component"),
                  h("th", null, "File"),
                  h("th", null, "Usage Count"),
                )
              ),
              h("tbody", null,
                summary.mostUsedComponents.map((comp) =>
                  h("tr", { key: `${comp.file}:${comp.name}` },
                    h("td", null, comp.name),
                    h("td", null, comp.file),
                    h("td", null, String(comp.usageCount)),
                  )
                )
              )
            )
          )
        )
      : null,
  );
}

function shortPath(file: string): string {
  const parts = file.split("/");
  return parts.length > 2 ? `.../${parts.slice(-2).join("/")}` : file;
}

function badgeClass(exp: RouteExportKind): string {
  switch (exp) {
    case "loader":
    case "action":
      return "data";
    case "default":
      return "component";
    case "ErrorBoundary":
    case "HydrateFallback":
      return "boundary";
    default:
      return "meta";
  }
}
