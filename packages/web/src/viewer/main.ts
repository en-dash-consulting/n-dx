import { h, render, Fragment } from "preact";
import type { VNode } from "preact";
import { useState, useEffect, useMemo, useCallback } from "preact/hooks";
import type { ViewId, DetailItem } from "./types.js";
import { ALL_DATA_FILES } from "./external.js";
import {
  Sidebar,
  DetailPanel,
  Guide,
  Breadcrumb,
  updateFavicon,
  MemoryWarningBanner,
  CrashRecoveryBanner,
  DegradationBanner,
  RefreshQueueStatus,
  PollingSuspensionIndicator,
  SearchOverlay,
  useSearchOverlay,
  NeolithicOverlay,
  useNeolithicOverlay,
  createTripleClickDetector,
  initTheme,
} from "./components/index.js";
import {
  useRouteState,
  useAppData,
  useMemoryMonitor,
  useCrashRecovery,
  useGracefulDegradation,
  useRefreshThrottle,
} from "./hooks/index.js";
import { startPollingRestart, usePollingSuspension } from "./polling/index.js";
import { isFeatureDisabled, onDegradationChange } from "./performance/index.js";
import { bootstrap } from "./bootstrap.js";
import { isDeployedMode, installFetchAdapter } from "./deployed-mode.js";
import { renderActiveView, buildValidViews } from "./views/view-registry.js";

if (isDeployedMode()) {
  installFetchAdapter();
  document.body.classList.add("ndx-deployed");
}

initTheme();
bootstrap();
startPollingRestart({ onDegradationChange, isFeatureDisabled });

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
  const [neolithicOpen, openNeolithic, closeNeolithic] = useNeolithicOverlay();
  const handleTripleClick = useMemo(
    () => createTripleClickDetector({ onTrigger: openNeolithic }),
    [openNeolithic],
  );
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
      onClick: handleTripleClick,
    },
      // Page-context bar: breadcrumb navigation + help buttons
      h("div", { class: "page-context-bar", role: "group", "aria-label": "Page navigation and help" },
        h(Breadcrumb, { view, navigateTo, scope }),
        h("div", { class: "page-context-actions" },
          h(Guide, { view }),
        ),
      ),
      loading
        ? h("div", { class: "loading", role: "status", "aria-live": "polite" }, "Loading...")
        : renderActiveView(view, { data, setDetail, setPrdDetailContent, selectedFile, setSelectedFile, selectedZone, selectedRunId, selectedTaskId, navigateTo, isFeatureDisabled }),
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
    h(NeolithicOverlay, { visible: neolithicOpen, onClose: closeNeolithic }),
  );
}

const root = document.getElementById("app");
if (root) {
  // Fetch scope before first render to avoid flash of unscoped content
  fetchScope().then((scope) => {
    render(h(App, { scope }), root);
  });
}
