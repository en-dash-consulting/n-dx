import { h } from "preact";
import { useState } from "preact/hooks";
import type { Manifest, Zones } from "../../schema/v1.js";
import type { ViewId } from "../types.js";
import { ENRICHMENT_THRESHOLDS } from "./constants.js";

const LOGO_SRC = "./SourceVision-F.png";

interface SidebarProps {
  view: ViewId;
  onNavigate: (view: ViewId) => void;
  manifest: Manifest | null;
  zones: Zones | null;
}

type NavEntry =
  | { type: "item"; id: ViewId; icon: string; label: string; minPass: number }
  | { type: "section"; label: string };

const NAV_ENTRIES: NavEntry[] = [
  { type: "section", label: "ANALYSIS" },
  { type: "item", id: "overview", icon: "\u25A3", label: "Overview", minPass: 0 },
  { type: "item", id: "prd", icon: "\u2611", label: "Tasks", minPass: 0 },
  { type: "item", id: "graph", icon: "\u2B95", label: "Import Graph", minPass: 0 },
  { type: "item", id: "zones", icon: "\u2B22", label: "Zones", minPass: 0 },
  { type: "item", id: "files", icon: "\u2630", label: "Files", minPass: 0 },
  { type: "item", id: "routes", icon: "\u25C7", label: "Routes", minPass: 0 },
  { type: "section", label: "ENRICHMENT" },
  { type: "item", id: "architecture", icon: "\u25E8", label: "Architecture", minPass: ENRICHMENT_THRESHOLDS.architecture },
  { type: "item", id: "problems", icon: "\u26A0", label: "Problems", minPass: ENRICHMENT_THRESHOLDS.problems },
  { type: "item", id: "suggestions", icon: "\u2728", label: "Suggestions", minPass: ENRICHMENT_THRESHOLDS.suggestions },
];

export function Sidebar({ view, onNavigate, manifest, zones }: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const gitInfo = manifest
    ? [manifest.gitBranch, manifest.gitSha?.slice(0, 7)].filter(Boolean).join(" @ ")
    : null;

  const enrichmentPass = zones?.enrichmentPass ?? 0;

  const modules = manifest?.modules ?? {};
  const moduleNames = ["inventory", "imports", "zones", "components"];
  const completedCount = moduleNames.filter(
    (m) => modules[m]?.status === "complete"
  ).length;

  const handleNav = (id: ViewId) => {
    onNavigate(id);
    setMobileOpen(false);
  };

  return h("div", {
    class: `sidebar${mobileOpen ? " mobile-open" : ""}`,
    role: "navigation",
    "aria-label": "Main navigation",
  },
    h("div", { class: "sidebar-header" },
      h("div", { class: "flex-row" },
        h("img", { src: LOGO_SRC, class: "sidebar-logo", alt: "n-dx" }),
        h("h1", null, "n-dx"),
      ),
      manifest
        ? h("div", { class: "meta" },
            gitInfo || manifest.targetPath.split("/").pop()
          )
        : null,
      h("button", {
        class: "mobile-menu-btn",
        onClick: () => setMobileOpen(!mobileOpen),
        "aria-label": mobileOpen ? "Close menu" : "Open menu",
        "aria-expanded": String(mobileOpen),
      }, mobileOpen ? "\u2715" : "\u2630")
    ),
    h("nav", { class: "sidebar-nav", "aria-label": "View navigation" },
      NAV_ENTRIES.map((entry, idx) => {
        if (entry.type === "section") {
          return h("div", {
            key: `section-${idx}`,
            class: "nav-section-label",
            "aria-hidden": "true",
          }, entry.label);
        }
        const locked = entry.minPass > 0 && enrichmentPass < entry.minPass;
        return h("div", {
          key: entry.id,
          class: `nav-item ${view === entry.id ? "active" : ""} ${locked ? "locked" : ""}`,
          onClick: locked ? undefined : () => handleNav(entry.id),
          role: "button",
          tabIndex: locked ? -1 : 0,
          "aria-current": view === entry.id ? "page" : undefined,
          "aria-disabled": locked ? "true" : undefined,
          onKeyDown: (e: KeyboardEvent) => {
            if (!locked && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              handleNav(entry.id);
            }
          },
        },
          h("span", { class: "nav-icon", "aria-hidden": "true" }, entry.icon),
          entry.label,
          locked
            ? h("span", { class: "nav-badge" }, `P${entry.minPass}`)
            : null
        );
      })
    ),
    manifest
      ? h("div", { class: "sidebar-progress", "aria-label": `Analysis progress: ${completedCount} of ${moduleNames.length} complete` },
          h("div", { class: "progress-label" }, `Analysis: ${completedCount}/${moduleNames.length}`),
          h("div", { class: "progress-bar", role: "progressbar", "aria-valuenow": String(completedCount), "aria-valuemin": "0", "aria-valuemax": String(moduleNames.length) },
            h("div", {
              class: "progress-fill",
              style: `width: ${(completedCount / moduleNames.length) * 100}%`,
            })
          ),
          h("div", { class: "progress-modules" },
            moduleNames.map((m) => {
              const status = modules[m]?.status;
              const icon = status === "complete" ? "\u2713" : status === "error" ? "\u2717" : "\u25CB";
              const cls = status === "complete" ? "done" : status === "error" ? "error" : "";
              return h("span", { key: m, class: `progress-module ${cls}`, title: m }, icon);
            })
          ),
        )
      : null
  );
}
