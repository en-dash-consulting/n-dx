import { h, Fragment } from "preact";
import { useState, useEffect } from "preact/hooks";

interface GuideProps {
  view: string;
}

const GUIDE_CONTENT: Record<string, { title: string; description: string; lookFor: string; actions: string }> = {
  overview: {
    title: "Overview",
    description: "Dashboard showing high-level project statistics: file counts, languages, import density, zone structure, and module completion status.",
    lookFor: "High import counts on single files (hub files). Circular dependencies. Unbalanced language distribution.",
    actions: "Check module status table to see which analysis phases have completed. Run additional 'sourcevision analyze' passes for deeper AI-generated insights.",
  },
  graph: {
    title: "Import Graph",
    description: "Force-directed visualization of the import graph. Nodes are colored by zone. Cross-zone edges are highlighted in orange.",
    lookFor: "Dense clusters suggest tightly-coupled modules. Orange cross-zone edges indicate zone boundary violations. Isolated nodes may be dead code.",
    actions: "Click nodes to inspect. Look for hub files that could be split. Consider if cross-zone imports suggest zones should be merged or boundaries clarified.",
  },
  zones: {
    title: "Zones",
    description: "Architectural zones detected by Louvain community detection. Each zone groups files with strong internal import connections.",
    lookFor: "Cohesion < 0.4 means files in a zone aren't well-related — consider splitting. Coupling > 0.6 means heavy cross-zone dependencies. Large zones (>50 files) may need decomposition.",
    actions: "Click a zone to see its files and entry points. Review AI-generated insights. Check if zone boundaries match your intended architecture.",
  },
  files: {
    title: "Files",
    description: "Sortable, filterable table of all project files with language, role, size, and category information.",
    lookFor: "Very large files (>500 lines) that might benefit from splitting. Files classified as 'other' role that should be reclassified. Category groupings that reveal organizational patterns.",
    actions: "Sort by line count to find the largest files. Filter by role to focus on source, test, or config files. Use search to locate specific files.",
  },
  routes: {
    title: "Routes",
    description: "Route tree showing React Router v7 / Remix file-based routes with their convention exports (loader, action, meta, etc).",
    lookFor: "Route modules missing loaders (data fetching). Missing ErrorBoundary exports. Deep layout nesting. Routes without meta exports (SEO gaps).",
    actions: "Check convention coverage stats to identify missing exports. Review the route tree for proper nesting. Look at component usage for shared UI patterns.",
  },
  architecture: {
    title: "Architecture",
    description: "Architectural patterns and relationships identified by AI analysis. Requires enrichment pass 2.",
    lookFor: "Cross-cutting concerns, shared utilities, interface boundaries between zones, dependency direction patterns.",
    actions: "Compare observed patterns against your intended architecture. Look for findings tagged as relationships — these show how zones interact.",
  },
  problems: {
    title: "Problems",
    description: "Anti-patterns and issues identified by AI analysis. Grouped by severity (critical, warning, info). Requires enrichment pass 3.",
    lookFor: "Critical issues first. Circular dependencies between zones. God files. Leaky abstractions. Tight coupling patterns.",
    actions: "Address critical findings first. Group related warnings for batch fixes. Use related file references to understand the scope of each issue.",
  },
  suggestions: {
    title: "Suggestions",
    description: "Improvement suggestions from AI analysis. Requires enrichment pass 4.",
    lookFor: "Quick wins vs larger refactors. Suggestions that align with your current sprint goals. Patterns that could benefit from abstraction.",
    actions: "Prioritize suggestions by scope (global vs zone-specific). Start with suggestions that reduce coupling or improve cohesion.",
  },
};

export function Guide({ view }: GuideProps) {
  const [open, setOpen] = useState(false);
  const content = GUIDE_CONTENT[view] || GUIDE_CONTENT.overview;

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  return h(Fragment, null,
    h("button", {
      class: "guide-btn",
      onClick: () => setOpen(!open),
      title: "View guide",
      "aria-label": "View guide for this page",
      "aria-expanded": String(open),
    }, "?"),
    open
      ? h("div", { class: "guide-overlay", onClick: () => setOpen(false), role: "dialog", "aria-modal": "true", "aria-label": `Guide: ${content.title}` },
          h("div", { class: "guide-modal", onClick: (e: Event) => e.stopPropagation() },
            h("div", { class: "guide-header" },
              h("h2", null, content.title),
              h("button", { class: "guide-close", onClick: () => setOpen(false), "aria-label": "Close guide" }, "\u2715"),
            ),
            h("div", { class: "guide-body" },
              h("section", null,
                h("h3", null, "What you're looking at"),
                h("p", null, content.description),
              ),
              h("section", null,
                h("h3", null, "What to look for"),
                h("p", null, content.lookFor),
              ),
              h("section", null,
                h("h3", null, "What actions to take"),
                h("p", null, content.actions),
              ),
            ),
          ),
        )
      : null
  );
}
