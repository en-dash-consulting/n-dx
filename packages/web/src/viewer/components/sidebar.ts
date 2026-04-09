import { h } from "preact";
import { useState, useEffect, useCallback, useRef, useMemo } from "preact/hooks";
import type { Manifest, Zones } from "../external.js";
import type { ViewId } from "../types.js";
import { NdxLogoPng, ProductLogoPng } from "./logos.js";
import { SidebarThemeToggle } from "./theme-toggle.js";
import { GlobalFAQ } from "./faq.js";
import {
  useProjectStatus,
  SvFreshnessIndicator,
  RexCompletionIndicator,
  HenchActivityIndicator,
} from "./status-indicators.js";
import { ConfigFooter } from "./config-footer.js";
import { useProjectMetadata, useFeatureToggle } from "../hooks/index.js";
import { SOURCEVISION_TABS } from "../views/sourcevision-tabs.js";

const STORAGE_KEY = "sidebar-expanded-section";

interface SidebarProps {
  view: ViewId;
  onNavigate: (view: ViewId) => void;
  manifest: Manifest | null;
  zones: Zones | null;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  /** When set, restricts sidebar to a single package section. */
  scope?: string | null;
}

type NavItem = { type: "item"; id: ViewId; icon: string; label: string; minPass: number; featureGate?: string };
type NavSection = { type: "section"; label: string; product?: "sourcevision" | "rex" | "hench" };
type NavEntry = NavItem | NavSection;

interface SectionGroup {
  label: string;
  product?: "sourcevision" | "rex" | "hench";
  items: NavItem[];
}

const NAV_ENTRIES: NavEntry[] = [
  { type: "section", label: "SOURCEVISION", product: "sourcevision" },
  ...SOURCEVISION_TABS.map((tab) => ({ type: "item" as const, ...tab })),
  { type: "section", label: "REX", product: "rex" },
  { type: "item", id: "rex-dashboard", icon: "\u25A8", label: "Dashboard", minPass: 0 },
  { type: "item", id: "prd", icon: "\u2611", label: "Tasks", minPass: 0 },
  { type: "item", id: "validation", icon: "\u2714", label: "Validation", minPass: 0 },
  { type: "item", id: "notion-config", icon: "\u{1F50C}", label: "Notion", minPass: 0, featureGate: "rex.notionSync" },
  { type: "item", id: "integrations", icon: "\u{1F517}", label: "Integrations", minPass: 0, featureGate: "rex.integrations" },
  { type: "section", label: "HENCH", product: "hench" },
  { type: "item", id: "hench-runs", icon: "\u25B6", label: "Runs", minPass: 0 },
  { type: "item", id: "hench-audit", icon: "\u2638", label: "Audit", minPass: 0 },
  { type: "item", id: "hench-config", icon: "\u2699", label: "Config", minPass: 0 },
  { type: "item", id: "hench-templates", icon: "\u25A6", label: "Templates", minPass: 0 },
  { type: "item", id: "hench-optimization", icon: "\u26A1", label: "Optimization", minPass: 0 },
  { type: "section", label: "TOKEN USAGE" },
  { type: "item", id: "token-usage", icon: "\u229A", label: "Token Usage", minPass: 0 },
  { type: "section", label: "SETTINGS" },
  { type: "item", id: "feature-toggles", icon: "\u2699", label: "Feature Flags", minPass: 0 },
  { type: "item", id: "cli-timeouts", icon: "\u23F1", label: "CLI Timeouts", minPass: 0 },
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

/** Expand the section that owns the active view so the highlighted item is always visible on load */
function getInitialExpanded(view: ViewId): string {
  return sectionForView(view);
}

/** Map section product to its first nav item for collapsed-rail click */
const SECTION_DEFAULT_VIEW: Record<string, ViewId> = {};
for (const section of SECTIONS) {
  if (section.product && section.items.length > 0) {
    SECTION_DEFAULT_VIEW[section.product] = section.items[0].id;
  }
}


export function Sidebar({ view, onNavigate, manifest, zones, sidebarCollapsed, onToggleSidebar, scope }: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const projectStatus = useProjectStatus();
  const projectMeta = useProjectMetadata();

  // Feature-gated nav items: subscribe to toggle state
  const callGraphEnabled = useFeatureToggle("sourcevision.callGraph", false);
  const notionSyncEnabled = useFeatureToggle("rex.notionSync", false);
  const integrationsEnabled = useFeatureToggle("rex.integrations", false);
  const enabledGates = useMemo(() => {
    const m = new Map<string, boolean>();
    m.set("sourcevision.callGraph", callGraphEnabled);
    m.set("rex.notionSync", notionSyncEnabled);
    m.set("rex.integrations", integrationsEnabled);
    return m;
  }, [callGraphEnabled, notionSyncEnabled, integrationsEnabled]);

  /** Sections filtered by scope and feature gates. */
  const visibleSections = useMemo(() => {
    const scopeFiltered = scope && scope !== "all"
      ? SECTIONS.filter((s) => s.product === scope || !s.product)
      : SECTIONS;
    // Filter out feature-gated items that are disabled
    return scopeFiltered.map((s) => ({
      ...s,
      items: s.items.filter((item) => {
        if (!item.featureGate) return true;
        return enabledGates.get(item.featureGate) ?? false;
      }),
    }));
  }, [scope, enabledGates]);

  const [expandedSection, setExpandedSection] = useState<string>(() =>
    scope ? (visibleSections[0]?.label ?? getInitialExpanded(view)) : getInitialExpanded(view)
  );

  const enrichmentPass = zones?.enrichmentPass ?? 0;

  const modules = manifest?.modules ?? {};
  const moduleNames = ["inventory", "imports", "classifications", "zones", "components", "callgraph"];
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
          // Logo — scoped: product logo, unscoped: n-dx logo
          h("div", {
            class: "sidebar-rail-logo",
            onClick: () => handleNav(visibleSections[0]?.items[0]?.id ?? "overview"),
            role: "button",
            tabIndex: 0,
            title: scope ? `${scope} \u2014 Home` : "n-dx \u2014 Overview",
            "aria-label": scope ? `Go to ${scope} home` : "Go to Overview",
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleNav(visibleSections[0]?.items[0]?.id ?? "overview"); }
            },
          }, scope
            ? h(ProductLogoPng, { product: scope as "sourcevision" | "rex" | "hench", size: 48 })
            : h(NdxLogoPng, { size: 48 }),
          ),

          h("div", { class: "sidebar-rail-divider", "aria-hidden": "true" }),

          // Section icons with sibling page items for active section
          h("nav", { class: "sidebar-rail-nav", "aria-label": "Section navigation" },
            visibleSections.filter((s) => s.product).flatMap((section) => {
              const product = section.product!;
              const isActive = activeProduct === product;
              const defaultView = SECTION_DEFAULT_VIEW[product];
              const sectionBtn = h("button", {
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
              if (!isActive) return [sectionBtn];
              // Show sibling page icons for the active section
              const pageItems = section.items.map((entry) =>
                h("button", {
                  key: entry.id,
                  class: `sidebar-rail-page${view === entry.id ? " sidebar-rail-page-active" : ""}`,
                  onClick: () => handleNav(entry.id),
                  title: entry.label,
                  "aria-label": entry.label,
                  "aria-current": view === entry.id ? "page" : undefined,
                }, h("span", { class: "sidebar-rail-page-icon" }, entry.icon)),
              );
              return [sectionBtn, ...pageItems];
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

    h("div", { class: "sidebar-header" },
      h("div", { class: "sidebar-brand" },
        scope
          ? h(ProductLogoPng, { product: scope as "sourcevision" | "rex" | "hench", size: 36, class: "sidebar-logo" })
          : h(NdxLogoPng, { size: 20, class: "sidebar-logo-sm" }),
        h("div", { class: "sidebar-brand-text" },
          // Project name is primary — large and prominent
          h("h1", {
            class: "sidebar-project-name",
            title: projectMeta?.name ?? undefined,
          }, projectMeta?.name ?? (scope ?? "n-dx")),
          // n-dx or product branding is secondary — small muted label
          scope
            ? h("div", { class: "sidebar-subtitle" }, "standalone viewer")
            : h("div", { class: "sidebar-subtitle" }, "n-dx"),
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
      visibleSections.map((section) => {
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
            // SourceVision freshness status indicator
            section.product === "sourcevision" && projectStatus?.sv
              ? h(SvFreshnessIndicator, {
                  status: projectStatus.sv,
                  onNavigate: handleNav,
                  tabIndex: isExpanded ? 0 : -1,
                })
              : null,
            // Rex PRD completion indicator
            section.product === "rex" && projectStatus?.rex
              ? h(RexCompletionIndicator, {
                  status: projectStatus.rex,
                  onNavigate: handleNav,
                  tabIndex: isExpanded ? 0 : -1,
                })
              : null,
            // Hench activity indicator
            section.product === "hench" && projectStatus?.hench
              ? h(HenchActivityIndicator, {
                  status: projectStatus.hench,
                  onNavigate: handleNav,
                  tabIndex: isExpanded ? 0 : -1,
                })
              : null,
          )
        );
      })
    ),
    // Sidebar footer with config display, collapse toggle, and theme toggle
    !sidebarCollapsed
      ? h("div", { class: "sidebar-footer", role: "group", "aria-label": "Sidebar controls" },
          h("div", { class: "sidebar-footer-divider", "aria-hidden": "true" }),
          h(ConfigFooter, null),
          h("div", { class: "sidebar-footer-divider", "aria-hidden": "true" }),
          h("div", { class: "sidebar-footer-controls" },
            h(SidebarThemeToggle, null),
            h(GlobalFAQ, null),
            h("button", {
              class: "sidebar-control-btn sidebar-collapse-btn",
              onClick: onToggleSidebar,
              title: "Collapse sidebar (\u2318B)",
              "aria-label": "Collapse sidebar",
            },
              h("svg", { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round" },
                h("path", { d: "M11 2L5 8l6 6" }),
              ),
            ),
          ),
        )
      : null,
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
