import { h, render, Fragment } from "preact";
import type { VNode, ComponentChild } from "preact";
import { useState, useEffect, useMemo, useCallback } from "preact/hooks";
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
import { useGracefulDegradation } from "./hooks/use-graceful-degradation.js";
import { MemoryWarningBanner } from "./components/memory-warning.js";
import { CrashRecoveryBanner } from "./components/crash-recovery-banner.js";
import { DegradationBanner } from "./components/degradation-banner.js";
import { RefreshQueueStatus } from "./components/refresh-queue-status.js";
import { PollingSuspensionIndicator } from "./components/polling-suspension-indicator.js";
import { SearchOverlay, useSearchOverlay } from "./components/search-overlay.js";
import { useRefreshThrottle } from "./hooks/use-refresh-throttle.js";
import { usePollingSuspension } from "./hooks/use-polling-suspension.js";
import type { DegradableFeature } from "./graceful-degradation.js";
import { startTabVisibilityMonitor, stopTabVisibilityMonitor } from "./tab-visibility.js";
import { startPollingManager, stopPollingManager } from "./polling-manager.js";
import { startPollingRestart } from "./polling-restart.js";
import { createTickVisibilityGate } from "./tick-visibility-gate.js";

initTheme();

// Start tab visibility and polling manager at module level so they're
// available before the first render.  The polling manager subscribes to
// visibility changes and automatically suspends / resumes all registered
// pollers when the tab is backgrounded / foregrounded.
startTabVisibilityMonitor();
startPollingManager();

// Start the tick visibility gate. This bridges tab visibility changes to
// the tick timer's suspend/resume lifecycle: when the tab goes hidden,
// the 1-second elapsed time interval is cleared to conserve CPU and
// battery; when the tab returns, an immediate catch-up tick fires so
// elapsed time displays jump to the correct current value.
createTickVisibilityGate();

// Start the polling restart coordinator. This bridges the graceful
// degradation system to the centralized polling state: when memory
// pressure disables autoRefresh, all non-essential polling sources are
// suspended; when pressure subsides, they restart at original intervals.
startPollingRestart();

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
  isFeatureDisabled: (feature: DegradableFeature) => boolean;
}): ComponentChild {
  const { view, loading, data, setDetail, setPrdDetailContent, selectedFile, setSelectedFile, selectedZone, selectedRunId, selectedTaskId, navigateTo, isFeatureDisabled } = opts;

  if (loading) {
    return h("div", { class: "loading", role: "status", "aria-live": "polite" }, "Loading...");
  }

  switch (view) {
    case "overview":
      return h(Overview, { data });
    case "graph":
      if (isFeatureDisabled("graphRendering")) {
        return h("div", { class: "degraded-view-placeholder", role: "status" },
          h("h2", null, "Graph view unavailable"),
          h("p", null, "The graph view has been temporarily disabled to conserve memory. It will be re-enabled automatically when memory usage decreases, or you can refresh the page."),
        );
      }
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

  const { snapshot: memorySnapshot, level: memoryLevel, showWarning: showMemoryWarning, dismiss: dismissMemoryWarning } = useMemoryMonitor();
  const {
    tier: degradationTier,
    isDegraded,
    summary: degradationSummary,
    disabledFeatures,
    isDisabled: isFeatureDisabled,
  } = useGracefulDegradation();
  const { state: refreshQueueState } = useRefreshThrottle();
  const { isSuspended: pollingSuspended, suspendedCount: pollingSuspendedCount } = usePollingSuspension();
  const [searchOpen, , closeSearch] = useSearchOverlay();
  const { data, loading, refreshToast, showDrop } = useAppData({ pausePolling: isFeatureDisabled("autoRefresh") });
  const {
    showRecovery,
    crashLoop,
    recentCrashCount,
    recoveredState,
    dismiss: dismissRecovery,
    restore: restoreCrashState,
  } = useCrashRecovery({ view, selectedFile, selectedZone, selectedRunId, selectedTaskId });

  const [detail, setDetail] = useState<DetailItem | null>(null);
  const [degradationDismissed, setDegradationDismissed] = useState(false);
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

  const handleManualRefresh = useCallback(() => {
    window.location.reload();
  }, []);

  const handleToggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next)); } catch { /* noop */ }
      return next;
    });
  };

  // Re-show degradation banner when tier escalates
  useEffect(() => {
    if (isDegraded) setDegradationDismissed(false);
  }, [degradationTier]);

  // Toggle CSS animation suppression class when animations are degraded
  useEffect(() => {
    const el = document.documentElement;
    if (isFeatureDisabled("animations")) {
      el.classList.add("degradation-no-animations");
    } else {
      el.classList.remove("degradation-no-animations");
    }
    return () => { el.classList.remove("degradation-no-animations"); };
  }, [isFeatureDisabled]);

  // Scroll to top on view change
  useEffect(() => {
    document.getElementById("main-content")?.scrollTo(0, 0);
  }, [view]);

  // Update browser favicon to match the active product section
  useEffect(() => {
    updateFavicon(view);
  }, [view]);

  const hasData = data.manifest || data.inventory || data.imports || data.zones;

  // Show degradation banner when degraded and not already showing the memory warning (avoid stacking)
  const showDegradationBanner = isDegraded && !degradationDismissed && !showMemoryWarning;

  return h(Fragment, null,
    h(CrashRecoveryBanner, { visible: showRecovery, crashLoop, recentCrashCount, recoveredState, onDismiss: dismissRecovery, onRestore: handleRestore }),
    h(MemoryWarningBanner, { snapshot: memorySnapshot, level: memoryLevel, visible: showMemoryWarning, onDismiss: dismissMemoryWarning }),
    h(DegradationBanner, { tier: degradationTier, isDegraded, summary: degradationSummary, disabledFeatures, visible: showDegradationBanner, onDismiss: () => setDegradationDismissed(true) }),
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
      renderActiveView({ view, loading, data, setDetail, setPrdDetailContent, selectedFile, setSelectedFile, selectedZone, selectedRunId, selectedTaskId, navigateTo, isFeatureDisabled }),
    ),
    !isFeatureDisabled("detailPanel")
      ? h(DetailPanel, { detail, data, navigateTo, onClose: () => { setDetail(null); setPrdDetailContent(null); }, prdDetailContent })
      : null,
    (refreshToast && !isFeatureDisabled("autoRefresh"))
      ? h("div", { class: "refresh-toast", role: "status", "aria-live": "polite" }, "Data updated")
      : null,
    h(RefreshQueueStatus, { state: refreshQueueState, visible: !isFeatureDisabled("autoRefresh") }),
    h(PollingSuspensionIndicator, { isSuspended: pollingSuspended, suspendedCount: pollingSuspendedCount, onRefresh: handleManualRefresh }),
    (showDrop && !hasData)
      ? h("div", { class: "drop-overlay", role: "dialog", "aria-label": "File drop zone" },
          h("div", { class: "drop-box" },
            h("h2", null, "Drop .sourcevision files"),
            h("p", null, `Drag and drop ${ALL_DATA_FILES.join(", ")}`)
          )
        )
      : null,
    h(SearchOverlay, { visible: searchOpen, onClose: closeSearch, navigateTo }),
  );
}

const root = document.getElementById("app");
if (root) {
  // Fetch scope before first render to avoid flash of unscoped content
  fetchScope().then((scope) => {
    render(h(App, { scope }), root);
  });
}
