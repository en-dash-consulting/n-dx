import { h, render, Fragment } from "preact";
import type { VNode, ComponentChild } from "preact";
import { useState, useEffect, useMemo } from "preact/hooks";
import type { ViewId, NavigateTo, DetailItem } from "./types.js";
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
import { PRMarkdownView } from "./views/pr-markdown.js";
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
import { TaskAuditView } from "./views/task-audit.js";
import { NotionConfigView } from "./views/notion-config.js";
import { IntegrationConfigView } from "./views/integration-config.js";
import { FeatureTogglesView } from "./views/feature-toggles.js";
import { SOURCEVISION_TAB_IDS } from "./sourcevision-tabs.js";
import { useRouteState } from "./hooks/use-route-state.js";
import { useAppData } from "./hooks/use-app-data.js";
import { useMemoryMonitor } from "./hooks/use-memory-monitor.js";
import { useCrashRecovery } from "./hooks/use-crash-recovery.js";
import { MemoryWarningBanner } from "./components/memory-warning.js";
import { CrashRecoveryBanner } from "./components/crash-recovery-banner.js";

initTheme();

/** All known views grouped by product scope. */
const VIEWS_BY_SCOPE: Record<string, ViewId[]> = {
  sourcevision: SOURCEVISION_TAB_IDS,
  rex: ["rex-dashboard", "prd", "rex-analysis", "validation", "notion-config", "integrations"],
  hench: ["hench-runs", "hench-audit", "hench-config", "hench-templates", "hench-optimization"],
};

/** Cross-cutting views available in all scopes. */
const CROSS_CUTTING_VIEWS: ViewId[] = ["token-usage", "feature-toggles"];

const ALL_VIEWS = new Set<ViewId>([...Object.values(VIEWS_BY_SCOPE).flat(), ...CROSS_CUTTING_VIEWS] as ViewId[]);

/** Build the valid view set based on an optional scope. */
function buildValidViews(scope: string | null): Set<ViewId> {
  if (!scope) return ALL_VIEWS;
  return new Set<ViewId>([...(VIEWS_BY_SCOPE[scope] ?? []), ...CROSS_CUTTING_VIEWS] as ViewId[]);
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

const SIDEBAR_COLLAPSED_KEY = "sidebar-collapsed";

function getInitialSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

/** Render the active view panel based on current state. */
function renderActiveView(opts: {
  view: ViewId;
  loading: boolean;
  data: ReturnType<typeof useAppData>["data"];
  setDetail: (item: DetailItem | null) => void;
  setPrdDetailContent: (content: VNode<unknown> | null) => void;
  selectedFile: string | null;
  setSelectedFile: (f: string | null) => void;
  selectedZone: string | null;
  selectedRunId: string | null;
  selectedTaskId: string | null;
  navigateTo: NavigateTo;
}): ComponentChild {
  const { view, loading, data, setDetail, setPrdDetailContent, selectedFile, setSelectedFile, selectedZone, selectedRunId, selectedTaskId, navigateTo } = opts;

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
    case "pr-markdown":
      return h(PRMarkdownView, null);
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
    case "integrations":
      return h(IntegrationConfigView, null);
    case "hench-runs":
      return h(HenchRunsView, { navigateTo, initialRunId: selectedRunId });
    case "hench-audit":
      return h(TaskAuditView, { navigateTo });
    case "hench-config":
      return h(HenchConfigView, null);
    case "hench-templates":
      return h(HenchTemplatesView, null);
    case "hench-optimization":
      return h(WorkflowOptimizationView, null);
    case "feature-toggles":
      return h(FeatureTogglesView, null);
    default:
      return null;
  }
}

function App({ scope }: { scope: string | null }) {
  const validViews = useMemo(() => buildValidViews(scope), [scope]);

  const {
    view,
    selectedFile,
    setSelectedFile,
    selectedZone,
    selectedRunId,
    selectedTaskId,
    navigateTo,
    handleSidebarNav,
  } = useRouteState(validViews);

  const { data, loading, refreshToast, showDrop } = useAppData();
  const { snapshot: memorySnapshot, level: memoryLevel, showWarning: showMemoryWarning, dismiss: dismissMemoryWarning } = useMemoryMonitor();
  const {
    showRecovery,
    crashLoop,
    recentCrashCount,
    recoveredState,
    dismiss: dismissRecovery,
    restore: restoreCrashState,
  } = useCrashRecovery({ view, selectedFile, selectedZone, selectedRunId, selectedTaskId });

  const [detail, setDetail] = useState<DetailItem | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getInitialSidebarCollapsed);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [prdDetailContent, setPrdDetailContent] = useState<VNode<any> | null>(null);

  const handleRestore = () => {
    const state = restoreCrashState();
    if (state) {
      navigateTo(state.view, {
        file: state.selectedFile ?? undefined,
        zone: state.selectedZone ?? undefined,
        runId: state.selectedRunId ?? undefined,
        taskId: state.selectedTaskId ?? undefined,
      });
    }
  };

  const handleToggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next)); } catch { /* noop */ }
      return next;
    });
  };

  // Scroll to top on view change
  useEffect(() => {
    document.getElementById("main-content")?.scrollTo(0, 0);
  }, [view]);

  // Update browser favicon to match the active product section
  useEffect(() => {
    updateFavicon(view);
  }, [view]);

  const hasData = data.manifest || data.inventory || data.imports || data.zones;

  return h(Fragment, null,
    h(CrashRecoveryBanner, { visible: showRecovery, crashLoop, recentCrashCount, recoveredState, onDismiss: dismissRecovery, onRestore: handleRestore }),
    h(MemoryWarningBanner, { snapshot: memorySnapshot, level: memoryLevel, visible: showMemoryWarning, onDismiss: dismissMemoryWarning }),
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
      renderActiveView({ view, loading, data, setDetail, setPrdDetailContent, selectedFile, setSelectedFile, selectedZone, selectedRunId, selectedTaskId, navigateTo }),
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
      : null,
  );
}

const root = document.getElementById("app");
if (root) {
  // Fetch scope before first render to avoid flash of unscoped content
  fetchScope().then((scope) => {
    render(h(App, { scope }), root);
  });
}
