import { h, render, Fragment } from "preact";
import type { VNode } from "preact";
import { useState, useEffect, useCallback, useMemo } from "preact/hooks";
import type { LoadedData, ViewId, NavigateTo, DetailItem } from "./types.js";
import { loadFromServer, loadFromFiles, detectMode, onDataChange, startPolling, stopPolling } from "./loader.js";
import { ALL_DATA_FILES } from "../schema/data-files.js";
import { Sidebar } from "./components/sidebar.js";
import { DetailPanel } from "./components/detail-panel.js";
import { Guide } from "./components/guide.js";
import { HeaderFAQ } from "./components/faq.js";
import { initTheme, ThemeToggle } from "./components/theme-toggle.js";
import { updateFavicon } from "./components/favicon.js";
import { ProductLogoPng } from "./components/logos.js";
import { Overview } from "./views/overview.js";
import { Graph } from "./views/graph.js";
import { ZonesView } from "./views/zones.js";
import { FilesView } from "./views/files.js";
import { ArchitectureView } from "./views/architecture.js";
import { ProblemsView } from "./views/problems.js";
import { SuggestionsView } from "./views/suggestions.js";
import { RoutesView } from "./views/routes.js";
import { PRDView } from "./views/prd.js";
import { RexDashboard } from "./views/rex-dashboard.js";
import { TokenUsageView } from "./views/token-usage.js";
import { ValidationView } from "./views/validation.js";
import { AnalysisView } from "./views/analysis.js";
import { HenchRunsView } from "./views/hench-runs.js";
import { HenchConfigView } from "./views/hench-config.js";
import { HenchTemplatesView } from "./views/hench-templates.js";
import { WorkflowOptimizationView } from "./views/workflow-optimization.js";

initTheme();

/** All known views grouped by product scope. */
const VIEWS_BY_SCOPE: Record<string, ViewId[]> = {
  sourcevision: ["overview", "graph", "zones", "files", "routes", "architecture", "problems", "suggestions"],
  rex: ["rex-dashboard", "prd", "rex-analysis", "token-usage", "validation"],
  hench: ["hench-runs", "hench-config", "hench-templates", "hench-optimization"],
};

const ALL_VIEWS = new Set<ViewId>(Object.values(VIEWS_BY_SCOPE).flat() as ViewId[]);

/** Determine which product scope owns a given view */
function productForView(view: ViewId): "sourcevision" | "rex" | "hench" | null {
  for (const [product, views] of Object.entries(VIEWS_BY_SCOPE)) {
    if ((views as ViewId[]).includes(view)) return product as "sourcevision" | "rex" | "hench";
  }
  return null;
}

/** Product display names */
const PRODUCT_LABELS: Record<string, string> = {
  sourcevision: "SourceVision",
  rex: "Rex",
  hench: "Hench",
};

/** Build the valid view set based on an optional scope. */
function buildValidViews(scope: string | null): Set<ViewId> {
  if (!scope) return ALL_VIEWS;
  return new Set<ViewId>((VIEWS_BY_SCOPE[scope] ?? []) as ViewId[]);
}

/** Fetch viewer scope from the server config endpoint. */
async function fetchScope(): Promise<string | null> {
  try {
    const res = await fetch("/api/config");
    if (!res.ok) return null;
    const config: { scope?: string | null } = await res.json();
    return config.scope ?? null;
  } catch {
    return null;
  }
}

function getInitialView(validViews: Set<ViewId>): ViewId {
  const hash = location.hash.replace("#", "") as ViewId;
  return validViews.has(hash) ? hash : validViews.values().next().value as ViewId;
}

const SIDEBAR_COLLAPSED_KEY = "sidebar-collapsed";

function getInitialSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function App({ scope }: { scope: string | null }) {
  const validViews = useMemo(() => buildValidViews(scope), [scope]);
  const [view, setView] = useState<ViewId>(() => getInitialView(validViews));
  const [data, setData] = useState<LoadedData>({
    manifest: null,
    inventory: null,
    imports: null,
    zones: null,
    components: null,
  });
  const [detail, setDetail] = useState<DetailItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDrop, setShowDrop] = useState(false);
  const [mode, setMode] = useState<"server" | "static">("static");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [refreshToast, setRefreshToast] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getInitialSidebarCollapsed);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [prdDetailContent, setPrdDetailContent] = useState<VNode<any> | null>(null);

  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next)); } catch { /* noop */ }
      return next;
    });
  }, []);

  const navigateTo: NavigateTo = useCallback((targetView, opts) => {
    const file = opts?.file ?? null;
    const zone = opts?.zone ?? null;
    setSelectedFile(file);
    setSelectedZone(zone);
    setView(targetView);
    history.pushState({ view: targetView, file, zone }, "", `#${targetView}`);
  }, []);

  const handleSidebarNav = useCallback((id: ViewId) => {
    setSelectedFile(null);
    setSelectedZone(null);
    setView(id);
    history.pushState({ view: id, file: null, zone: null }, "", `#${id}`);
  }, []);

  // Scroll to top on view change
  useEffect(() => {
    document.getElementById("main-content")?.scrollTo(0, 0);
  }, [view]);

  // Update browser favicon to match the active product section
  useEffect(() => {
    updateFavicon(view);
  }, [view]);

  useEffect(() => {
    // Seed the initial history entry
    history.replaceState({ view, file: selectedFile, zone: selectedZone }, "", `#${view}`);

    const handlePopState = (e: PopStateEvent) => {
      if (e.state) {
        const s = e.state as { view?: string; file?: string | null; zone?: string | null };
        if (s.view && validViews.has(s.view as ViewId)) {
          setView(s.view as ViewId);
          setSelectedFile(s.file ?? null);
          setSelectedZone(s.zone ?? null);
        }
      } else {
        // Handle history entries created by direct hash assignment (e.g. window.location.hash = "#prd")
        // These entries have no state object, so parse the hash from the URL
        const hash = location.hash.replace("#", "") as ViewId;
        if (validViews.has(hash)) {
          setView(hash);
          setSelectedFile(null);
          setSelectedZone(null);
          // Backfill the state so future back/forward through this entry works fully
          history.replaceState({ view: hash, file: null, zone: null }, "", `#${hash}`);
        }
      }
    };
    window.addEventListener("popstate", handlePopState);

    // Handle direct hash changes (e.g. window.location.hash = "#prd" from validation view).
    // hashchange fires when the hash is set directly but popstate does not.
    const handleHashChange = () => {
      const hash = location.hash.replace("#", "") as ViewId;
      if (validViews.has(hash)) {
        setView(hash);
        setSelectedFile(null);
        setSelectedZone(null);
        // Backfill state so future back/forward through this entry works
        history.replaceState({ view: hash, file: null, zone: null }, "", `#${hash}`);
      }
    };
    window.addEventListener("hashchange", handleHashChange);

    let initialLoad = true;
    onDataChange((newData) => {
      setData(newData);
      if (!initialLoad) {
        setRefreshToast(true);
        setTimeout(() => setRefreshToast(false), 3000);
      }
    });

    detectMode().then(async (m) => {
      setMode(m);
      if (m === "server") {
        await loadFromServer();
        setLoading(false);
        initialLoad = false;
        startPolling(5000);
      } else {
        setLoading(false);
        setShowDrop(true);
      }
    });

    return () => {
      stopPolling();
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  // Drag and drop
  useEffect(() => {
    if (mode === "server") return;

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      setShowDrop(true);
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      setShowDrop(false);
      if (e.dataTransfer?.files) {
        setLoading(true);
        await loadFromFiles(e.dataTransfer.files);
        setLoading(false);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setShowDrop(false);
    };

    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("drop", handleDrop);
    document.addEventListener("dragleave", handleDragLeave);

    return () => {
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("drop", handleDrop);
      document.removeEventListener("dragleave", handleDragLeave);
    };
  }, [mode]);

  const hasData = data.manifest || data.inventory || data.imports || data.zones;

  const renderView = () => {
    if (loading) {
      return h("div", { class: "loading", role: "status", "aria-live": "polite" }, "Loading...");
    }

    switch (view) {
      case "overview":
        return h(Overview, { data });
      case "graph":
        return h(Graph, { data, onSelect: setDetail, selectedFile, selectedZone });
      case "zones":
        return h(ZonesView, { data, onSelect: setDetail, setSelectedZone, navigateTo });
      case "files":
        return h(FilesView, { data, onSelect: setDetail, selectedFile, setSelectedFile, selectedZone, navigateTo });
      case "routes":
        return h(RoutesView, { data });
      case "architecture":
        return h(ArchitectureView, { data, onSelect: setDetail, navigateTo });
      case "problems":
        return h(ProblemsView, { data });
      case "suggestions":
        return h(SuggestionsView, { data });
      case "rex-dashboard":
        return h(RexDashboard, { navigateTo });
      case "prd":
        return h(PRDView, { onSelectItem: setDetail, onDetailContent: setPrdDetailContent });
      case "rex-analysis":
        return h(AnalysisView, null);
      case "token-usage":
        return h(TokenUsageView, null);
      case "validation":
        return h(ValidationView, null);
      case "hench-runs":
        return h(HenchRunsView, { navigateTo });
      case "hench-config":
        return h(HenchConfigView, null);
      case "hench-templates":
        return h(HenchTemplatesView, null);
      case "hench-optimization":
        return h(WorkflowOptimizationView, null);
      default:
        return null;
    }
  };

  const activeProduct = productForView(view);

  return h(Fragment, null,
    h("a", { href: "#main-content", class: "skip-link" }, "Skip to main content"),
    h(Sidebar, { view, onNavigate: handleSidebarNav, manifest: data.manifest, zones: data.zones, sidebarCollapsed, onToggleSidebar: handleToggleSidebar, scope }),
    h("main", {
      id: "main-content",
      class: "main",
      role: "main",
      "aria-label": "Main content",
    },
      h("div", { class: "header-controls-wrapper" },
        h("div", { class: "header-controls" },
          // Left group: sidebar toggle + theme toggle
          h("div", { class: "header-controls-left", role: "group", "aria-label": "Global controls" },
            h("button", {
              class: "header-control-btn header-sidebar-toggle",
              onClick: handleToggleSidebar,
              title: sidebarCollapsed ? "Expand sidebar (\u2318B)" : "Collapse sidebar (\u2318B)",
              "aria-label": sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar",
            },
              h("svg", { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round" },
                h("path", { d: "M2 3h12M2 8h12M2 13h12" }),
              ),
            ),
            h(ThemeToggle, null),
          ),
          // Right group: branding + FAQ + Guide
          h("div", { class: "header-controls-right", role: "group", "aria-label": "Page context" },
            activeProduct
              ? h("div", { class: "header-branding" },
                  h(ProductLogoPng, { product: activeProduct, size: 18, class: "header-branding-logo" }),
                  h("span", { class: "header-branding-name" }, PRODUCT_LABELS[activeProduct] ?? activeProduct),
                )
              : null,
            h(HeaderFAQ, { view }),
            h(Guide, { view }),
          ),
        ),
      ),
      renderView()
    ),
    h(DetailPanel, { detail, data, navigateTo, onClose: () => { setDetail(null); setPrdDetailContent(null); }, prdDetailContent }),
    refreshToast
      ? h("div", { class: "refresh-toast", role: "status", "aria-live": "polite" }, "Data updated")
      : null,
    (showDrop && !hasData)
      ? h("div", { class: "drop-overlay", role: "dialog", "aria-label": "File drop zone" },
          h("div", { class: "drop-box" },
            h("h2", null, "Drop .sourcevision files"),
            h("p", null, `Drag and drop ${ALL_DATA_FILES.join(", ")}`)
          )
        )
      : null
  );
}

const root = document.getElementById("app");
if (root) {
  // Fetch scope before first render to avoid flash of unscoped content
  fetchScope().then((scope) => {
    render(h(App, { scope }), root);
  });
}
