import { h } from "preact";
import { useState, useEffect, useCallback, useRef, useMemo } from "preact/hooks";
import type { Manifest, Zones } from "../../schema/v1.js";
import type { ViewId } from "../types.js";
import { ENRICHMENT_THRESHOLDS } from "./constants.js";
import { NdxLogoPng, ProductLogoPng } from "./logos.js";
import { SidebarThemeToggle } from "./theme-toggle.js";
import { FAQ } from "./faq.js";

const STORAGE_KEY = "sidebar-expanded-section";

interface SidebarProps {
  view: ViewId;
  onNavigate: (view: ViewId) => void;
  manifest: Manifest | null;
  zones: Zones | null;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

type NavItem = { type: "item"; id: ViewId; icon: string; label: string; minPass: number };
type NavSection = { type: "section"; label: string; product?: "sourcevision" | "rex" | "hench" };
type NavEntry = NavItem | NavSection;

interface SectionGroup {
  label: string;
  product?: "sourcevision" | "rex" | "hench";
  items: NavItem[];
}

const NAV_ENTRIES: NavEntry[] = [
  { type: "section", label: "SOURCEVISION", product: "sourcevision" },
  { type: "item", id: "overview", icon: "\u25A3", label: "Overview", minPass: 0 },
  { type: "item", id: "graph", icon: "\u2B95", label: "Import Graph", minPass: 0 },
  { type: "item", id: "zones", icon: "\u2B22", label: "Zones", minPass: 0 },
  { type: "item", id: "files", icon: "\u2630", label: "Files", minPass: 0 },
  { type: "item", id: "routes", icon: "\u25C7", label: "Routes", minPass: 0 },
  { type: "item", id: "architecture", icon: "\u25E8", label: "Architecture", minPass: ENRICHMENT_THRESHOLDS.architecture },
  { type: "item", id: "problems", icon: "\u26A0", label: "Problems", minPass: ENRICHMENT_THRESHOLDS.problems },
  { type: "item", id: "suggestions", icon: "\u2728", label: "Suggestions", minPass: ENRICHMENT_THRESHOLDS.suggestions },
  { type: "section", label: "REX", product: "rex" },
  { type: "item", id: "rex-dashboard", icon: "\u25A8", label: "Dashboard", minPass: 0 },
  { type: "item", id: "prd", icon: "\u2611", label: "Tasks", minPass: 0 },
  { type: "item", id: "rex-analysis", icon: "\u2699", label: "Analysis", minPass: 0 },
  { type: "item", id: "validation", icon: "\u2714", label: "Validation", minPass: 0 },
  { type: "item", id: "token-usage", icon: "\u229A", label: "Token Usage", minPass: 0 },
  { type: "section", label: "HENCH", product: "hench" },
  { type: "item", id: "hench-runs", icon: "\u25B6", label: "Runs", minPass: 0 },
];

/** Group flat NAV_ENTRIES into sections with their items */
function buildSections(): SectionGroup[] {
  const sections: SectionGroup[] = [];
  let current: SectionGroup | null = null;
  for (const entry of NAV_ENTRIES) {
    if (entry.type === "section") {
      current = { label: entry.label, product: entry.product, items: [] };
      sections.push(current);
    } else if (current) {
      current.items.push(entry);
    }
  }
  return sections;
}

const SECTIONS = buildSections();

/** Find which section label owns the given view */
function sectionForView(view: ViewId): string {
  for (const section of SECTIONS) {
    if (section.items.some((item) => item.id === view)) {
      return section.label;
    }
  }
  return SECTIONS[0].label;
}

/** Read persisted expanded section, falling back to the section owning the active view */
function getInitialExpanded(view: ViewId): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SECTIONS.some((s) => s.label === stored)) return stored;
  } catch {
    // localStorage may be unavailable
  }
  return sectionForView(view);
}

/** Map section product to its first nav item for collapsed-rail click */
const SECTION_DEFAULT_VIEW: Record<string, ViewId> = {};
for (const section of SECTIONS) {
  if (section.product && section.items.length > 0) {
    SECTION_DEFAULT_VIEW[section.product] = section.items[0].id;
  }
}


export function Sidebar({ view, onNavigate, manifest, zones, sidebarCollapsed, onToggleSidebar }: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string>(() => getInitialExpanded(view));

  const enrichmentPass = zones?.enrichmentPass ?? 0;

  const modules = manifest?.modules ?? {};
  const moduleNames = ["inventory", "imports", "zones", "components"];
  const completedCount = moduleNames.filter(
    (m) => modules[m]?.status === "complete"
  ).length;

  /** The product that owns the current view */
  const activeProduct = useMemo(() => {
    const owning = sectionForView(view);
    const section = SECTIONS.find((s) => s.label === owning);
    return section?.product ?? null;
  }, [view]);

  /** The label of the currently active nav item */
  const activeLabel = useMemo(() => {
    for (const section of SECTIONS) {
      const found = section.items.find((item) => item.id === view);
      if (found) return found.label;
    }
    return null;
  }, [view]);

  const handleNav = useCallback((id: ViewId) => {
    onNavigate(id);
    setMobileOpen(false);
  }, [onNavigate]);

  const toggleSection = useCallback((label: string) => {
    setExpandedSection((prev) => {
      const next = prev === label ? "" : label;
      try { localStorage.setItem(STORAGE_KEY, next); } catch { /* noop */ }
      return next;
    });
  }, []);

  // When the active view changes to a different section, auto-expand that section
  const prevViewRef = useRef(view);
  useEffect(() => {
    if (prevViewRef.current === view) return;
    prevViewRef.current = view;
    const owning = sectionForView(view);
    setExpandedSection((prev) => {
      if (prev === owning) return prev;
      try { localStorage.setItem(STORAGE_KEY, owning); } catch { /* noop */ }
      return owning;
    });
  }, [view]);

  // Global keyboard shortcut: Cmd/Ctrl + B to toggle sidebar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        onToggleSidebar();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onToggleSidebar]);

  // Close mobile sidebar on backdrop click / Escape
  useEffect(() => {
    if (!mobileOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [mobileOpen]);

  return h("div", {
    class: `sidebar${mobileOpen ? " mobile-open" : ""}${sidebarCollapsed ? " sidebar-collapsed" : ""}`,
    role: "navigation",
    "aria-label": "Main navigation",
  },
    // ── Collapsed rail: visible only when sidebar is collapsed (desktop) ──
    sidebarCollapsed
      ? h("div", { class: "sidebar-rail", "aria-label": "Collapsed navigation" },
          // n-dx logo
          h("div", {
            class: "sidebar-rail-logo",
            onClick: () => handleNav("overview"),
            role: "button",
            tabIndex: 0,
            title: "n-dx \u2014 Overview",
            "aria-label": "Go to Overview",
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleNav("overview"); }
            },
          }, h(NdxLogoPng, { size: 48 })),

          h("div", { class: "sidebar-rail-divider", "aria-hidden": "true" }),

          // Section icons
          h("nav", { class: "sidebar-rail-nav", "aria-label": "Section navigation" },
            SECTIONS.filter((s) => s.product).map((section) => {
              const product = section.product!;
              const isActive = activeProduct === product;
              const defaultView = SECTION_DEFAULT_VIEW[product];
              return h("button", {
                key: product,
                class: `sidebar-rail-section${isActive ? " sidebar-rail-section-active" : ""} sidebar-rail-section-${product}`,
                onClick: () => handleNav(defaultView),
                title: `${section.label}${isActive && activeLabel ? ` \u2014 ${activeLabel}` : ""}`,
                "aria-label": `${section.label}${isActive ? " (current section)" : ""}`,
                "aria-current": isActive ? "true" : undefined,
              },
                isActive
                  ? h("span", { class: "sidebar-rail-accent", "aria-hidden": "true" })
                  : null,
                h(ProductLogoPng, { product, size: 48, class: "sidebar-rail-icon" }),
              );
            })
          ),

          // Expand button at bottom
          h("button", {
            class: "sidebar-rail-expand",
            onClick: onToggleSidebar,
            "aria-label": "Expand sidebar",
            title: "Expand sidebar (\u2318B)",
          },
            h("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round" },
              h("path", { d: "M5 2l6 6-6 6" }),
            ),
          ),
        )
      : null,

    // ── Expanded sidebar collapse button ──
    !sidebarCollapsed
      ? h("button", {
          class: "sidebar-toggle-btn",
          onClick: onToggleSidebar,
          "aria-label": "Collapse sidebar",
          title: "Collapse sidebar (\u2318B)",
        },
          h("svg", { width: 14, height: 14, viewBox: "0 0 14 14", fill: "none", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round" },
            h("path", { d: "M9 2L4 7l5 5" }),
          ),
        )
      : null,

    h("div", { class: "sidebar-header" },
      h("div", { class: "sidebar-brand" },
        h(NdxLogoPng, { size: 36, class: "sidebar-logo" }),
        h("div", { class: "sidebar-brand-text" },
          h("h1", null, "n-dx"),
          h("div", { class: "sidebar-subtitle" }, "Developer Experience,", h("br", null), "by En Dash"),
        ),
      ),
      h("button", {
        class: "mobile-menu-btn",
        onClick: () => setMobileOpen(!mobileOpen),
        "aria-label": mobileOpen ? "Close menu" : "Open menu",
        "aria-expanded": String(mobileOpen),
      }, mobileOpen ? "\u2715" : "\u2630")
    ),
    h("nav", { class: "sidebar-nav", "aria-label": "View navigation" },
      SECTIONS.map((section) => {
        const isExpanded = expandedSection === section.label;
        return h("div", { key: section.label, class: "nav-section" },
          // Section header (clickable)
          h("div", {
            class: `nav-section-header${section.product ? ` nav-section-${section.product}` : ""}`,
            role: "button",
            tabIndex: 0,
            "aria-expanded": String(isExpanded),
            "aria-controls": `nav-section-${section.label}`,
            onClick: () => toggleSection(section.label),
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggleSection(section.label);
              }
            },
          },
            section.product
              ? h(ProductLogoPng, { product: section.product, size: 40, class: "nav-section-logo" })
              : null,
            h("span", { class: "nav-section-label" }, section.label),
            h("svg", {
              class: `nav-section-chevron${isExpanded ? " nav-section-chevron-open" : ""}`,
              width: 12,
              height: 12,
              viewBox: "0 0 12 12",
              fill: "none",
              stroke: "currentColor",
              "stroke-width": "1.5",
              "stroke-linecap": "round",
              "aria-hidden": "true",
            }, h("path", { d: "M3 4.5l3 3 3-3" })),
          ),
          // Section items (collapsible)
          h("div", {
            id: `nav-section-${section.label}`,
            class: `nav-section-items${isExpanded ? "" : " nav-section-items-collapsed"}`,
            role: "group",
            "aria-label": `${section.label} views`,
          },
            section.items.map((entry) => {
              const locked = entry.minPass > 0 && enrichmentPass < entry.minPass;
              return h("div", {
                key: entry.id,
                class: `nav-item ${view === entry.id ? "active" : ""} ${locked ? "locked" : ""}`,
                onClick: locked ? undefined : () => handleNav(entry.id),
                role: "button",
                tabIndex: locked || !isExpanded ? -1 : 0,
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
            }),
            // Analysis progress indicator (inside SourceVision section)
            section.product === "sourcevision" && manifest
              ? h("div", {
                  class: "sidebar-progress",
                  role: "button",
                  tabIndex: isExpanded ? 0 : -1,
                  "aria-label": `Analysis progress: ${completedCount} of ${moduleNames.length} complete — click to view`,
                  onClick: () => handleNav("overview"),
                  onKeyDown: (e: KeyboardEvent) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleNav("overview");
                    }
                  },
                },
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
              : null,
          )
        );
      })
    ),
    h("div", { class: "sidebar-controls", role: "group", "aria-label": "Global controls" },
      h(SidebarThemeToggle, null),
      h(FAQ, null),
    ),
    // Mobile backdrop
    mobileOpen
      ? h("div", {
          class: "sidebar-backdrop",
          onClick: () => setMobileOpen(false),
          "aria-hidden": "true",
        })
      : null
  );
}
