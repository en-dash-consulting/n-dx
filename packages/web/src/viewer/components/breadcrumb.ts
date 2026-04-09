/**
 * Breadcrumb navigation component.
 *
 * Displays a "project > tool > view" hierarchy in the page header area.
 * Fetches project metadata from the `/api/project` endpoint and combines
 * it with the current view to build a contextual breadcrumb trail.
 *
 * Also manages `document.title` to reflect the current project and view,
 * formatted as "ProjectName | n-dx" (or "ViewLabel — ProductLabel | ProjectName | n-dx").
 */

import { h } from "preact";
import { useEffect, useMemo } from "preact/hooks";
import type { ViewId, NavigateTo } from "../types.js";
import { useProjectMetadata } from "../hooks/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BreadcrumbProps {
  view: ViewId;
  navigateTo: NavigateTo;
  /** When set, restricts navigation to a single product scope. */
  scope?: string | null;
}

// ---------------------------------------------------------------------------
// View metadata lookup
// ---------------------------------------------------------------------------

interface ViewMeta {
  product: "sourcevision" | "rex" | "hench" | "global";
  label: string;
  /** Product display name */
  productLabel: string;
}

/** Default view for each product section */
const PRODUCT_DEFAULT_VIEW: Record<string, ViewId> = {
  sourcevision: "overview",
  rex: "rex-dashboard",
  hench: "hench-runs",
};

const VIEW_META: Record<ViewId, ViewMeta> = {
  overview:              { product: "sourcevision", label: "Overview",        productLabel: "SourceVision" },
  graph:                 { product: "sourcevision", label: "Import Graph",    productLabel: "SourceVision" },
  zones:                 { product: "sourcevision", label: "Zones",           productLabel: "SourceVision" },
  files:                 { product: "sourcevision", label: "Files",           productLabel: "SourceVision" },
  routes:                { product: "sourcevision", label: "Routes",          productLabel: "SourceVision" },
  architecture:          { product: "sourcevision", label: "Architecture",    productLabel: "SourceVision" },
  problems:              { product: "sourcevision", label: "Problems",        productLabel: "SourceVision" },
  suggestions:           { product: "sourcevision", label: "Suggestions",     productLabel: "SourceVision" },
  "pr-markdown":         { product: "sourcevision", label: "PR Markdown",     productLabel: "SourceVision" },
  "rex-dashboard":       { product: "rex",          label: "Dashboard",       productLabel: "Rex" },
  prd:                   { product: "rex",          label: "Tasks",           productLabel: "Rex" },
  "token-usage":         { product: "global",       label: "Token Usage",     productLabel: "Global" },
  validation:            { product: "rex",          label: "Validation",      productLabel: "Rex" },
  "notion-config":       { product: "rex",          label: "Notion",          productLabel: "Rex" },
  integrations:          { product: "rex",          label: "Integrations",    productLabel: "Rex" },
  "hench-runs":          { product: "hench",        label: "Runs",            productLabel: "Hench" },
  "hench-audit":         { product: "hench",        label: "Audit",           productLabel: "Hench" },
  "hench-config":        { product: "hench",        label: "Config",          productLabel: "Hench" },
  "hench-templates":     { product: "hench",        label: "Templates",       productLabel: "Hench" },
  "hench-optimization":  { product: "hench",        label: "Optimization",    productLabel: "Hench" },
  "feature-toggles":     { product: "rex",          label: "Feature Flags",   productLabel: "Settings" },
  "cli-timeouts":        { product: "global",       label: "CLI Timeouts",    productLabel: "Settings" },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Chevron separator between breadcrumb segments. */
function Separator() {
  return h("svg", {
    class: "breadcrumb-sep",
    width: 12,
    height: 12,
    viewBox: "0 0 12 12",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.5",
    "stroke-linecap": "round",
    "aria-hidden": "true",
  }, h("path", { d: "M4.5 2.5l3 3.5-3 3.5" }));
}

export function Breadcrumb({ view, navigateTo, scope }: BreadcrumbProps) {
  const project = useProjectMetadata();

  // Keep document.title in sync with project + current view
  useEffect(() => {
    const meta = VIEW_META[view];
    const parts: string[] = [];
    if (meta) parts.push(`${meta.label} — ${meta.productLabel}`);
    if (project) parts.push(project.name);
    parts.push("n-dx");
    document.title = parts.join(" | ");
  }, [project, view]);

  const meta = VIEW_META[view];

  /** Truncated project name — max 28 chars. */
  const projectName = useMemo(() => {
    if (!project) return null;
    const name = project.name;
    return name.length > 28 ? name.slice(0, 26) + "\u2026" : name;
  }, [project]);

  const gitBranch = project?.git?.branch ?? null;

  return h("nav", {
    class: "breadcrumb",
    "aria-label": "Breadcrumb",
  },
    h("ol", { class: "breadcrumb-list" },
      // ── Segment 1: Project name ──
      project && projectName
        ? h("li", { class: "breadcrumb-item" },
            h("span", {
              class: "breadcrumb-project",
              title: project.name.length > 28 ? project.name : undefined,
            },
              projectName,
            ),
            gitBranch
              ? h("span", { class: "breadcrumb-branch", title: `Branch: ${gitBranch}` },
                  h("svg", {
                    class: "breadcrumb-branch-icon",
                    width: 11,
                    height: 11,
                    viewBox: "0 0 16 16",
                    fill: "currentColor",
                    "aria-hidden": "true",
                  },
                    // Git branch icon (simplified)
                    h("path", { d: "M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5z" }),
                  ),
                  gitBranch.length > 20 ? gitBranch.slice(0, 18) + "\u2026" : gitBranch,
                )
              : null,
            Separator(),
          )
        : null,

      // ── Segment 2: Product / tool ──
      meta && meta.product !== "global"
        ? h("li", { class: "breadcrumb-item" },
            h("button", {
              class: `breadcrumb-link breadcrumb-product breadcrumb-product-${meta.product}`,
              onClick: () => navigateTo(PRODUCT_DEFAULT_VIEW[meta.product]),
              type: "button",
            }, meta.productLabel),
            Separator(),
          )
        : null,

      // ── Segment 3: Current view (active, not a link) ──
      meta
        ? h("li", { class: "breadcrumb-item breadcrumb-current", "aria-current": "page" },
            meta.label,
          )
        : null,
    ),
  );
}
