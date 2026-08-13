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
    title: "Map",
    description: "Explorable map of zones, files, imports, and cross-boundary relationships.",
    lookFor: "Hub files, unexpected cross-zone imports, and external zones that cluster around many files.",
    actions: "Select a zone, hover files to preview routes, and click files to open the dependency street view.",
  },
  zones: {
    title: "Zones",
    description: "Interactive diagram of architectural zones with expandable file lists, cross-zone connection bars, and flow edges between zones.",
    lookFor: "Zones with many outbound connections (high coupling). Files whose connection bars span several target zones. Unexpected flow edges between zones that should be independent.",
    actions: "Expand a zone to see its files ordered by cross-zone traffic. Hover or select a file row to highlight its connections. Click through to the file detail for import specifics.",
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
  analysis: {
    title: "Analyze & Import",
    description: "Rex analysis workspace: run project analysis, add items from natural language, batch-import ideas from files or text, and review pending proposals before accepting them into the PRD.",
    lookFor: "Pending proposals awaiting review. Analysis history events showing what recent runs produced. Duplicate proposals that should be rejected rather than accepted.",
    actions: "Use Smart Add to draft items from a description. Run a project scan to generate proposals, then accept or reject each one. Batch-import a spec file to seed the PRD.",
  },
  requirements: {
    title: "Requirements",
    description: "Requirement coverage and the traceability matrix: every requirement, the item it is defined on, the descendants it applies to, and how it is validated.",
    lookFor: "Low coverage percentages. Items without any applicable requirements. Requirements with manual validation that could be automated.",
    actions: "Expand a requirement to see its acceptance criteria and the status of every item it applies to. Add or edit requirements from the item detail panel in the Tasks view.",
  },
  "hench-adaptive": {
    title: "Adaptive Optimization",
    description: "Monitors run history and proposes workflow-parameter adjustments (turn limits, token budgets, retry settings) as the project evolves. Adjustments can be applied, dismissed, or auto-applied when adaptive mode is on.",
    lookFor: "High-priority adjustments with strong rationale. Trends moving the wrong way (falling success rate, rising token usage). Config keys you never want auto-tuned.",
    actions: "Apply or dismiss each recommendation. Lock keys you manage manually. Enable adaptive mode to auto-apply safe adjustments; review the history to audit past changes.",
  },
  "command-reference": {
    title: "All Commands",
    description: "Server-driven reference of every CLI command for this project, grouped by workflow stage, with the project's resolved CLI name and per-command availability.",
    lookFor: "Commands marked 'needs init' or 'needs LLM' — they indicate setup steps still required before that part of the workflow is usable.",
    actions: "Copy an invocation to run it in your terminal. Configure an LLM provider in Settings → General to unlock agent commands.",
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
