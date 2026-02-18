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
import { Breadcrumb } from "./components/breadcrumb.js";
import { initTheme } from "./components/theme-toggle.js";
import { updateFavicon } from "./components/favicon.js";
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
import { NotionConfigView } from "./views/notion-config.js";

initTheme();

/** All known views grouped by product scope. */
const VIEWS_BY_SCOPE: Record<string, ViewId[]> = {
  sourcevision: ["overview", "graph", "zones", "files", "routes", "architecture", "problems", "suggestions"],
  rex: ["rex-dashboard", "prd", "rex-analysis", "token-usage", "validation", "notion-config"],
  hench: ["hench-runs", "hench-config", "hench-templates", "hench-optimization"],
};

const ALL_VIEWS = new Set<ViewId>(Object.values(VIEWS_BY_SCOPE).flat() as ViewId[]);

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

/** Parse pathname into { view, subId } — handles deep-link paths like /hench-runs/RUNID */
function parsePathname(pathname: string, validViews: Set<ViewId>): { view: ViewId | null; subId: string | null } {
  const raw = pathname.slice(1); // strip leading "/"
  // Exact match first
  if (validViews.has(raw as ViewId)) return { view: raw as ViewId, subId: null };
  // Try base/subId pattern (e.g. "hench-runs/abc-123")
  const slashIdx = raw.indexOf("/");
  if (slashIdx > 0) {
    const base = raw.slice(0, slashIdx) as ViewId;
    const sub = raw.slice(slashIdx + 1);
    if (validViews.has(base) && sub) return { view: base, subId: sub };
  }
  return { view: null, subId: null };
}

function getInitialView(validViews: Set<ViewId>): ViewId {
  const { view } = parsePathname(location.pathname, validViews);
  return view ?? validViews.values().next().value as ViewId;
}

function getInitialRunId(validViews: Set<ViewId>): string | null {
  const { view, subId } = parsePathname(location.pathname, validViews);
  return view === "hench-runs" ? subId : null;
}

function getInitialTaskId(validViews: Set<ViewId>): string | null {
  const { view, subId } = parsePathname(location.pathname, validViews);
  return view === "prd" ? subId : null;
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
  const [selectedRunId, setSelectedRunId] = useState<string | null>(() => getInitialRunId(validViews));
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(() => getInitialTaskId(validViews));
  const [data, setData] = useState<LoadedData>({
    manifest: null,
    inventory: null,
    imports: null,
    zones: null,
    components: null,
    callGraph: null,
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
    const runId = opts?.runId ?? null;
    const taskId = opts?.taskId ?? null;
    setSelectedFile(file);
    setSelectedZone(zone);
    setSelectedRunId(runId);
    setSelectedTaskId(taskId);
    setView(targetView);
    const subId = runId ?? taskId;
    const urlPath = subId ? `/${targetView}/${subId}` : `/${targetView}`;
    history.pushState({ view: targetView, file, zone, runId, taskId }, "", urlPath);
  }, []);

  const handleSidebarNav = useCallback((id: ViewId) => {
    setSelectedFile(null);
    setSelectedZone(null);
    setSelectedRunId(null);
    setSelectedTaskId(null);
    setView(id);
    history.pushState({ view: id, file: null, zone: null, runId: null, taskId: null }, "", `/${id}`);
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
    // Backward compat: migrate old hash URLs to path URLs
    if (location.hash) {
      const hashView = location.hash.replace("#", "") as ViewId;
      if (validViews.has(hashView)) {
        setView(hashView);
        history.replaceState({ view: hashView, file: null, zone: null, runId: null, taskId: null }, "", `/${hashView}`);
      }
    } else {
      // Seed the initial history entry — preserve deep-link path if present
      const subId = selectedRunId ?? selectedTaskId;
      const initialUrl = subId ? `/${view}/${subId}` : `/${view}`;
      history.replaceState({ view, file: selectedFile, zone: selectedZone, runId: selectedRunId, taskId: selectedTaskId }, "", initialUrl);
    }

    const handlePopState = (e: PopStateEvent) => {
      if (e.state) {
        const s = e.state as { view?: string; file?: string | null; zone?: string | null; runId?: string | null; taskId?: string | null };
        if (s.view && validViews.has(s.view as ViewId)) {
          setView(s.view as ViewId);
          setSelectedFile(s.file ?? null);
          setSelectedZone(s.zone ?? null);
          setSelectedRunId(s.runId ?? null);
          setSelectedTaskId(s.taskId ?? null);
        }
      } else {
        // Fallback: parse from pathname
        const parsed = parsePathname(location.pathname, validViews);
        if (parsed.view) {
          setView(parsed.view);
          setSelectedFile(null);
          setSelectedZone(null);
          const isRunView = parsed.view === "hench-runs";
          const isTaskView = parsed.view === "prd";
          setSelectedRunId(isRunView ? parsed.subId : null);
          setSelectedTaskId(isTaskView ? parsed.subId : null);
          const fallbackUrl = parsed.subId ? `/${parsed.view}/${parsed.subId}` : `/${parsed.view}`;
          history.replaceState({ view: parsed.view, file: null, zone: null, runId: isRunView ? parsed.subId : null, taskId: isTaskView ? parsed.subId : null }, "", fallbackUrl);
        }
      }
    };
    window.addEventListener("popstate", handlePopState);

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
        return h(Graph, { data, onSelect: setDetail, selectedFile, selectedZone, navigateTo });
      case "zones":
        return h(ZonesView, { data, onSelect: setDetail, navigateTo });
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
        return h(PRDView, { onSelectItem: setDetail, onDetailContent: setPrdDetailContent, initialTaskId: selectedTaskId, navigateTo });
      case "rex-analysis":
        return h(AnalysisView, null);
      case "token-usage":
        return h(TokenUsageView, null);
      case "validation":
        return h(ValidationView, { navigateTo });
      case "notion-config":
        return h(NotionConfigView, null);
      case "hench-runs":
        return h(HenchRunsView, { navigateTo, initialRunId: selectedRunId });
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

  return h(Fragment, null,
    h("a", { href: "#main-content", class: "skip-link" }, "Skip to main content"),
    h(Sidebar, { view, onNavigate: handleSidebarNav, manifest: data.manifest, zones: data.zones, sidebarCollapsed, onToggleSidebar: handleToggleSidebar, scope }),
    h("main", {
      id: "main-content",
      class: "main",
      role: "main",
      "aria-label": "Main content",
    },
      // Page-context bar: breadcrumb navigation + help buttons
      h("div", { class: "page-context-bar", role: "group", "aria-label": "Page navigation and help" },
        h(Breadcrumb, { view, navigateTo, scope }),
        h("div", { class: "page-context-actions" },
          h(HeaderFAQ, { view }),
          h(Guide, { view }),
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
