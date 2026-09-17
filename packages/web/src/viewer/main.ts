import { h, render, Fragment } from "preact";
import type { VNode } from "preact";
import { useState, useEffect, useMemo, useCallback } from "preact/hooks";
import type {DetailItem} from "./types.js";import { ALL_DATA_FILES } from "./external.js";
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
  ActiveOperationsTray,
  GitStatusBanner,
  SessionsPanel,
  type ServerIdentity,
  SearchOverlay,
  useSearchOverlay,
  NeolithicOverlay,
  useNeolithicOverlay,
  createTripleClickDetector,
  initTheme,
  initDensity,
} from "./components/index.js";
import {
  useRouteState,
  useAppData,
  useMemoryMonitor,
  useCrashRecovery,
  useGracefulDegradation,
  useRefreshThrottle,
  useActiveOperations,
  useGitStatus,
  useWorktrees,
  useClaims,
  useFeatureToggle,
} from "./hooks/index.js";
import { startPollingRestart, usePollingSuspension } from "./polling/index.js";
import { isFeatureDisabled, onDegradationChange } from "./performance/index.js";
import { bootstrap } from "./bootstrap.js";
import { isDeployedMode, installFetchAdapter } from "./deployed-mode.js";
import { installBasePathFetch } from "./base-path.js";
import { renderActiveView, buildValidViews } from "./views/view-registry.js";
import { initScrollReveal } from "./scroll-reveal.js";

if (isDeployedMode()) {
  installFetchAdapter();
  document.body.classList.add("ndx-deployed");
} else {
  // Served through the hub at /p/<id>/: prefix every root-relative fetch.
  // At the root this is a no-op.
  installBasePathFetch();
}

initTheme();
initDensity();
bootstrap();
startPollingRestart({ onDegradationChange, isFeatureDisabled });
initScrollReveal();

/** What the one boot-time `/api/config` call yields. */
interface BootConfig {
  scope: string | null;
  /** Server identity for the sidebar footer; null on a server too old to send it. */
  server: ServerIdentity | null;
}

/**
 * Read the server config endpoint once, before the first render.
 *
 * Both values it carries are needed before anything paints — the scope
 * decides which views exist, and the identity line says which n-dx this
 * window is — so the footer takes `server` as a prop from here rather than
 * fetching the same endpoint again.
 */
async function fetchBootConfig(): Promise<BootConfig> {
  try {
    const res = await fetch("/api/config");
    if (!res.ok) return { scope: null, server: null };
    const config: { scope?: string | null; server?: ServerIdentity | null } = await res.json();
    return { scope: config.scope ?? null, server: config.server ?? null };
  } catch {
    return { scope: null, server: null };
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

function App({ scope, server = null }: { scope: string | null; server?: ServerIdentity | null }) {
  const validViews = useMemo(() => buildValidViews(scope), [scope]);

  const {
    view,
    selectedFile,
    setSelectedFile,
    selectedZone,
    selectedRunId,
    selectedTaskId,
    askSeed,
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
  const activeOperations = useActiveOperations();
  const { status: gitStatus, refetch: refetchGitStatus } = useGitStatus();
  const { worktrees } = useWorktrees();
  const { claims } = useClaims();
  const [searchOpen, , closeSearch] = useSearchOverlay();
  const [neolithicOpen, openNeolithic, closeNeolithic] = useNeolithicOverlay();
  const handleTripleClick = useMemo(
    () => createTripleClickDetector({ onTrigger: openNeolithic, requiredClicks: 7 }),
    [openNeolithic],
  );
  const { data, loading, refreshToast, showDrop } = useAppData({ pausePolling: isFeatureDisabled("autoRefresh") });
  // Read here rather than in the views that need it: the view renderers in
  // view-registry.ts are plain functions dispatched by `view`, so a hook called
  // inside one would be a conditional hook in this component. Problems and
  // Suggestions cannot read it themselves either — both return early from an
  // enrichment gate before their hooks run.
  const askEnabled = useFeatureToggle("sourcevision.ask", false);
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

  // document.title is owned by <Breadcrumb>, which has the project name and
  // product context. A second writer here raced it: whichever effect ran last
  // won, so the title silently lost its product segment.

  // Update browser favicon to match the active product section
  useEffect(() => {
    updateFavicon(view);
  }, [view]);

  const hasData = data.manifest || data.inventory || data.imports || data.zones;

  // Show degradation banner when degraded and not already showing the memory warning (avoid stacking)
  const showDegradationBanner = isDegraded && !degradationDismissed && !showMemoryWarning;

  return h(Fragment, null,
    // Skip link must be the first focusable element so keyboard users can bypass navigation.
    h("a", { href: "#main-content", class: "skip-link" }, "Skip to main content"),
    h(CrashRecoveryBanner, { visible: showRecovery, crashLoop, recentCrashCount, recoveredState, onDismiss: dismissRecovery, onRestore: handleRestore }),
    h(MemoryWarningBanner, { snapshot: memorySnapshot, level: memoryLevel, visible: showMemoryWarning, onDismiss: dismissMemoryWarning }),
    h(DegradationBanner, { tier: degradationTier, isDegraded, summary: degradationSummary, disabledFeatures, visible: showDegradationBanner, onDismiss: () => setDegradationDismissed(true) }),
    h(Sidebar, { view, onNavigate: handleSidebarNav, manifest: data.manifest, zones: data.zones, sidebarCollapsed, onToggleSidebar: handleToggleSidebar, scope, server }),
    h("main", {
      id: "main-content",
      // The Tasks (prd) view manages its own internal scroll region, so the
      // main column becomes a non-scrolling flex container for it.
      class: `main${view === "prd" ? " main--fill" : ""}`,
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
        : renderActiveView(view, { data, setDetail, setPrdDetailContent, selectedFile, setSelectedFile, selectedZone, selectedRunId, selectedTaskId, askSeed, navigateTo, isFeatureDisabled, askEnabled }),
    ),
    !isFeatureDisabled("detailPanel")
      ? h(DetailPanel, { detail, data, navigateTo, onClose: () => { setDetail(null); setPrdDetailContent(null); }, prdDetailContent })
      : null,
    (refreshToast && !isFeatureDisabled("autoRefresh"))
      ? h("div", { class: "refresh-toast", role: "status", "aria-live": "polite" }, "Data updated")
      : null,
    h(RefreshQueueStatus, { state: refreshQueueState, visible: !isFeatureDisabled("autoRefresh") }),
    h(PollingSuspensionIndicator, { isSuspended: pollingSuspended, suspendedCount: pollingSuspendedCount, onRefresh: handleManualRefresh }),
    h(ActiveOperationsTray, { operations: activeOperations, navigateTo }),
    h(GitStatusBanner, { status: gitStatus, onCommitted: refetchGitStatus }),
    h(SessionsPanel, { worktrees, claims, navigateTo }),
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
  // Fetch config before first render to avoid a flash of unscoped content
  fetchBootConfig().then(({ scope, server }) => {
    render(h(App, { scope, server }), root);
  });
}
