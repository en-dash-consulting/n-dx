/**
 * Top navigation: the brand (which is also the way home), the three stage
 * tabs — Analysis, Plan, Work — then, after a divider, the Live tab, and
 * search. Nothing else lives up here; settings and commands are on the bottom bar.
 *
 * A tab is active on its own stage page and on any view that stage lists,
 * so `/zones` keeps Analysis lit and `/hench-runs/<id>` keeps Plan lit.
 * Live is lit on every Live route and is not part of the stage loop.
 */

import { h } from "preact";
import type { ViewId, NavigateTo } from "../api.js";
import { stageForView, visibleStages, stageProduct, viewLabel, viewGlyph, isLiveView, useProjectMetadata } from "../api.js";
import { isDeployedMode } from "../deployed-mode.js";
import { NdxLogoPng, ProductLogoPng } from "./logos.js";
import { LiveTab } from "./live-tab.js";

export interface TopNavProps {
  view: ViewId;
  validViews: ReadonlySet<ViewId>;
  onNavigate: (view: ViewId) => void;
  /** Lets the Live peek open a page with its id (`/live/task/<id>`) without reloading. */
  navigateTo?: NavigateTo;
  onOpenSearch: () => void;
  /** Standalone package viewer: brand shows the product mark. */
  scope?: string | null;
}

export function TopNav({ view, validViews, onNavigate, navigateTo, onOpenSearch, scope = null }: TopNavProps) {
  const project = useProjectMetadata();
  const active = stageForView(view, validViews);
  const stages = visibleStages(validViews);
  const scoped = !!scope && scope !== "all";
  // A static export has no server to ask what is running.
  const liveEnabled = validViews.has("live") && !isDeployedMode();

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
        const product = stageProduct(id);
        const label = viewLabel(id);
        const isActive = active === id;
        return h("button", {
          key: id,
          type: "button",
          class: `topnav-tab topnav-tab-${product}${isActive ? " active" : ""}`,
          "data-stage": id,
          onClick: () => onNavigate(id),
          "aria-current": isActive ? (view === id ? "page" : "true") : undefined,
          // Stated rather than left to the text nodes: the product hint is
          // already hidden below 960px and the label is a candidate for the
          // same treatment, at which point a tab named only by its glyph
          // would read as "▣" to a screen reader.
          "aria-label": label,
        },
          h("span", { class: "topnav-tab-glyph", "aria-hidden": "true" }, viewGlyph(id)),
          h("span", { class: "topnav-tab-label" }, label),
          h("span", { class: "topnav-tab-hint" }, product),
        );
      }),
      // Live is not a stage: it sits after a divider, outside the loop, and
      // lights on every Live route.
      liveEnabled ? h("span", { class: "topnav-divider", role: "separator", "aria-orientation": "vertical" }) : null,
      h(LiveTab, { view, active: isLiveView(view), onNavigate, navigateTo, enabled: liveEnabled }),
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
