/**
 * Top navigation: the brand (which is also the way home), the three stage
 * tabs — Analysis, Plan, Work — and search. Nothing else lives up here;
 * settings and commands are on the bottom bar.
 *
 * A tab is active on its own stage page and on any view that stage lists,
 * so `/zones` keeps Analysis lit and `/hench-runs/<id>` keeps Plan lit.
 */

import { h } from "preact";
import type { ViewId } from "../api.js";
import { STAGES, stageForView, visibleStages, useProjectMetadata } from "../api.js";
import { NdxLogoPng, ProductLogoPng } from "./logos.js";

export interface TopNavProps {
  view: ViewId;
  validViews: ReadonlySet<ViewId>;
  onNavigate: (view: ViewId) => void;
  onOpenSearch: () => void;
  /** Standalone package viewer: brand shows the product mark. */
  scope?: string | null;
}

export function TopNav({ view, validViews, onNavigate, onOpenSearch, scope = null }: TopNavProps) {
  const project = useProjectMetadata();
  const active = stageForView(view, validViews);
  const stages = visibleStages(validViews);
  const scoped = !!scope && scope !== "all";

  return h("header", { class: "topnav" },
    h("button", {
      type: "button",
      class: `topnav-brand${view === "home" ? " topnav-brand--active" : ""}`,
      onClick: () => onNavigate("home"),
      title: "Home",
      "aria-label": "Home",
      "aria-current": view === "home" ? "page" : undefined,
    },
      scoped
        ? h(ProductLogoPng, { product: scope as string, size: 28, class: "topnav-logo" })
        : h(NdxLogoPng, { size: 26, class: "topnav-logo" }),
      h("span", { class: "topnav-brand-text" },
        h("span", { class: "topnav-project", title: project?.name ?? undefined }, project?.name ?? (scoped ? scope : "n-dx")),
        h("span", { class: "topnav-subtitle" }, scoped ? "standalone viewer" : "n-dx"),
      ),
    ),

    h("nav", { class: "topnav-tabs", "aria-label": "View navigation" },
      stages.map((id) => {
        const stage = STAGES[id];
        const isActive = active === id;
        return h("button", {
          key: id,
          type: "button",
          class: `topnav-tab topnav-tab-${stage.product}${isActive ? " active" : ""}`,
          "data-stage": id,
          onClick: () => onNavigate(id),
          "aria-current": isActive ? (view === id ? "page" : "true") : undefined,
        },
          h("span", { class: "topnav-tab-glyph", "aria-hidden": "true" }, stage.glyph),
          h("span", { class: "topnav-tab-label" }, stage.label),
          h("span", { class: "topnav-tab-hint" }, stage.product),
        );
      }),
    ),

    h("button", {
      type: "button",
      class: "topnav-search",
      onClick: onOpenSearch,
      "aria-label": "Search files, zones and tasks",
    },
      h("span", { class: "topnav-search-label" }, "Search files, zones, tasks…"),
      h("kbd", { class: "topnav-kbd" }, "⌘K"),
    ),
  );
}
