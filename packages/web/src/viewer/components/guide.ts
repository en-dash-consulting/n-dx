import { h, Fragment } from "preact";
import { useState, useEffect } from "preact/hooks";

interface GuideProps {
  view: string;
}

const GUIDE_CONTENT: Record<string, { title: string; description: string; lookFor: string; actions: string }> = {
  // ── SourceVision views ──
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
  "pr-markdown": {
    title: "PR Markdown",
    description: "PR-ready markdown generated for copy/paste into pull request descriptions.",
    lookFor: "Clear summary, accurate file/change grouping, and any missing sections before sharing.",
    actions: "Copy sections into your PR description and refresh after major changes to keep the text current.",
  },
  // ── Rex views ──
  "rex-dashboard": {
    title: "Rex Dashboard",
    description: "PRD completion overview showing epic progress, priority distribution, and recent activity. Each epic displays a segmented progress bar with status breakdowns.",
    lookFor: "Epics with low completion rates or many blocked tasks. Imbalanced priority distribution (too many critical items may indicate scope creep). Stalled items that haven't progressed.",
    actions: "Click an epic to see its tasks. Review blocked items and resolve dependencies. Use the execution panel to run the next task autonomously.",
  },
  prd: {
    title: "Tasks",
    description: "Interactive PRD tree showing the full hierarchy: epics → features → tasks → subtasks. Each item shows its status, priority, and tags. Supports multi-select for bulk operations.",
    lookFor: "Tasks stuck in 'in_progress' for too long. Blocked items with unresolved dependencies. Orphaned subtasks without clear parent context. Items missing acceptance criteria.",
    actions: "Click items to view details in the side panel. Use bulk actions to update multiple items at once. Merge duplicate tasks. Add new items at any level of the hierarchy.",
  },
  "rex-analysis": {
    title: "Analysis",
    description: "Review AI-generated proposals for your PRD. Rex analyzes your codebase using SourceVision data and suggests epics, features, and tasks to add.",
    lookFor: "Proposals that overlap with existing PRD items. Suggestions that don't align with project priorities. Overly granular or overly broad proposals.",
    actions: "Accept relevant proposals to add them to the PRD. Edit proposals before accepting to refine scope. Reject proposals that don't fit. Run new analysis after codebase changes.",
  },
  "token-usage": {
    title: "Token Usage",
    description: "Analytics dashboard showing token consumption across autonomous agent runs. Tracks input/output tokens, costs, and usage trends over time.",
    lookFor: "Runs with unusually high token counts (may indicate stuck loops). Cost trends over time. Token distribution across epics to understand where effort is spent.",
    actions: "Review high-cost runs for optimization opportunities. Compare token usage across similar tasks. Use the grouping controls to view usage by day, week, or month.",
  },
  validation: {
    title: "Validation",
    description: "PRD integrity checks that verify the health of your task tree. Detects orphaned items, circular dependencies, invalid references, and structural issues.",
    lookFor: "Critical validation errors (must be fixed). Orphaned items disconnected from the tree. Circular blockedBy references that create deadlocks. Items with invalid status transitions.",
    actions: "Fix critical errors first — they can prevent task execution. Resolve orphaned items by reparenting or deleting them. Clear circular dependencies by editing blockedBy fields.",
  },
  // ── Hench views ──
  "hench-runs": {
    title: "Execution History",
    description: "Timeline of autonomous agent runs showing status, duration, token usage, and task associations. Each run records the full execution transcript.",
    lookFor: "Failed runs that need investigation. Runs with high turn counts (may indicate the agent struggled). Patterns in which tasks succeed vs fail autonomously.",
    actions: "Click a run to see its full details and token breakdown. Review failed runs to understand what went wrong. Use insights to improve task descriptions and acceptance criteria.",
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
