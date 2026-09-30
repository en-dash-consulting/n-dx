/**
 * Breadcrumb navigation component.
 *
 * Displays a "project > stage > view" hierarchy in the page header area —
 * the stage being the Analysis / Plan / Work page that lists the view.
 * Fetches project metadata from the `/api/project` endpoint and combines
 * it with the current view to build a contextual breadcrumb trail.
 *
 * Also manages `document.title`, formatted as
 * "ViewLabel — ProductLabel | ProjectName | n-dx", or "ViewLabel | ProjectName | n-dx"
 * for a view no single package owns.
 *
 * Every name here comes from the navigation model (`views/view-meta.ts`,
 * reached through `api.ts`). The breadcrumb used to keep its own table of the
 * lot, which is how it came to call the import map "Map" while the page the
 * reader had just left called it "Repository map".
 */

import { h } from "preact";
import { useEffect, useMemo } from "preact/hooks";
import type { ViewId, NavigateTo } from "../types.js";
import { useProjectMetadata, useCliName, resolveCliLabel } from "../hooks/index.js";
import { stageForView, isStageId, stageProduct, viewLabel, VIEW_META, PRODUCT_LABELS } from "../api.js";
import type { ViewMeta } from "../api.js";
import { buildValidViews } from "../external.js";
import { WorkspaceSwitcher } from "./workspace-switcher.js";

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
  const cliName = useCliName();

  // The current view's name, from the one navigation model — the same string
  // the top nav, the stage page and the settings overlay show for it.
  //
  // Looked up rather than asserted: `view` is not always a live view id. The
  // crash-recovery banner restores a navigation state read out of
  // localStorage with an unchecked cast (`getJSON<SavedNavigationState>`) and
  // hands it straight to `navigateTo`, which does not check it against
  // `validViews` — so a key saved by an older build, naming a view since
  // removed, lands here. Indexing it blind would throw during render and take
  // the whole dashboard down at exactly the moment the user is recovering
  // from a crash. An unknown view keeps the project segment and drops its
  // own, which is what this rendered before the model existed.
  const meta = VIEW_META[view] as ViewMeta | undefined;
  const label = meta ? resolveCliLabel(meta.label, cliName) : null;

  // Keep document.title in sync with project + current view
  useEffect(() => {
    const parts: string[] = [];
    // A view no single package owns names only itself: "Home | proj | n-dx".
    if (label && meta) parts.push(meta.product === "global" ? label : `${label} — ${PRODUCT_LABELS[meta.product]}`);
    if (project) parts.push(project.name);
    parts.push("n-dx");
    document.title = parts.join(" | ");
  }, [project, view, label]);

  /** Truncated project name — max 28 chars. */
  const projectName = useMemo(() => {
    if (!project) return null;
    const name = project.name;
    return name.length > 28 ? name.slice(0, 26) + "\u2026" : name;
  }, [project]);

  const gitBranch = project?.git?.branch ?? null;

  // The stage page that lists this view — the middle segment, and where it
  // leads. Absent on the stage pages themselves (they are the last segment),
  // on home and settings, and when this viewer's scope has no such stage.
  const validViews = useMemo(() => buildValidViews(scope ?? null), [scope]);
  const stage = isStageId(view) ? null : stageForView(view, validViews);

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
            // The branch chip is the workspace switcher: "<worktree> · <branch>",
            // a menu of every worktree when there is more than one.
            h(WorkspaceSwitcher, { view, branch: gitBranch }),
            Separator(),
          )
        : null,

      // ── Segment 2: Stage ──
      stage
        ? h("li", { class: "breadcrumb-item" },
            h("button", {
              class: `breadcrumb-link breadcrumb-product breadcrumb-product-${stageProduct(stage)}`,
              onClick: () => navigateTo(stage),
              type: "button",
            }, viewLabel(stage)),
            Separator(),
          )
        : null,

      // ── Segment 3: Current view (active, not a link) ──
      label
        ? h("li", { class: "breadcrumb-item breadcrumb-current", "aria-current": "page" }, label)
        : null,
    ),
  );
}
