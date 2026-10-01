import { h, render, Fragment } from "preact";
import type { VNode } from "preact";
import { useState, useEffect, useMemo, useCallback } from "preact/hooks";
import type { DetailItem, ViewId } from "./types.js";
import { ALL_DATA_FILES } from "./external.js";
import {
  TopNav,
  StageLinks,
  BottomBar,
  SettingsOverlay,
  CommandsSheet,
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
  usePageEntry,
  useAppData,
  useMemoryMonitor,
  useCrashRecovery,
  useGracefulDegradation,
  useRefreshThrottle,
  useActiveOperations,
  useGitStatus,
  useWorktrees,
  useClaims,
  useLive,
  isAnalysisJob,
  useFeatureToggle,
} from "./hooks/index.js";
import { startPollingRestart, usePollingSuspension } from "./polling/index.js";
import { isFeatureDisabled, onDegradationChange } from "./performance/index.js";
import { bootstrap } from "./bootstrap.js";
import { isDeployedMode, installFetchAdapter } from "./deployed-mode.js";
import { installBasePathFetch } from "./base-path.js";
import { renderActiveView, buildValidViews } from "./views/view-registry.js";
import { isLiveView, isSettingsView, stageForView } from "./views/stages.js";
import { LiveBar } from "./views/domain-live.js";
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
  /** Server identity for the bottom bar; null on a server too old to send it. */
  server: ServerIdentity | null;
}

/**
 * Read the server config endpoint once, before the first render.
 *
 * Both values it carries are needed before anything paints — the scope
 * decides which views exist, and the identity line says which n-dx this
 * window is — so the bottom bar takes `server` as a prop from here rather
 * than fetching the same endpoint again.
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

/**
 * The page shown under the settings overlay when a settings route is opened
 * directly: the landing page, or the first view when there is none.
 */
function fallbackPage(validViews: Set<ViewId>): ViewId {
  return validViews.has("home") ? "home" : (validViews.values().next().value as ViewId);
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
  // One tracker for every async job. Passed down to the views that start
  // jobs (Commands, Overview, Suggestions) rather than each calling the hook
  // again — a second caller would mean a second poller and a second socket.
  const jobs = useActiveOperations();
  const { status: gitStatus, refetch: refetchGitStatus } = useGitStatus();
  const { worktrees } = useWorktrees();
  const { claims } = useClaims();
  const liveAvailable = validViews.has("live") && !isDeployedMode();
  const live = useLive(liveAvailable);
  const analyses = live?.jobs.filter(isAnalysisJob).length ?? 0;
  const [searchOpen, openSearch, closeSearch] = useSearchOverlay();
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [prdDetailContent, setPrdDetailContent] = useState<VNode<any> | null>(null);

  // Settings routes open as an overlay over the page you were on, which stays
  // mounted underneath. `pageView` is that page: the current view unless it is
  // a settings view, else the last non-settings view (or home, on a direct load).
  const settingsOpen = isSettingsView(view);
  const { page, lastEntry } = usePageEntry(
    { view, file: selectedFile, zone: selectedZone, runId: selectedRunId, taskId: selectedTaskId },
    settingsOpen,
    fallbackPage(validViews),
  );
  const pageView: ViewId = page.view;
  const stage = stageForView(pageView, validViews);

  // The commands sheet is UI state, not a route. Any navigation lowers it —
  // including one started from a link inside it.
  const [commandsOpen, setCommandsOpen] = useState(false);
  useEffect(() => { setCommandsOpen(false); }, [view]);
  const toggleCommands = useCallback(() => setCommandsOpen((open) => !open), []);
  const closeCommands = useCallback(() => setCommandsOpen(false), []);
  const openSettings = useCallback(() => handleSidebarNav("robot-wrangler"), [handleSidebarNav]);
  const closeSettings = useCallback(
    () => navigateTo(lastEntry.view, {
      file: lastEntry.file ?? undefined,
      zone: lastEntry.zone ?? undefined,
      runId: lastEntry.runId ?? undefined,
      taskId: lastEntry.taskId ?? undefined,
    }),
    [navigateTo, lastEntry],
  );

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

  // Scroll to top when the page changes — not when a settings overlay opens
  // or closes over it, which would lose your place.
  useEffect(() => {
    document.getElementById("main-content")?.scrollTo(0, 0);
  }, [pageView]);

  // document.title is owned by <Breadcrumb>, which has the project name and
  // product context. A second writer here raced it: whichever effect ran last
  // won, so the title silently lost its product segment.

  // Update browser favicon to match the active product section
  useEffect(() => {
    updateFavicon(pageView);
  }, [pageView]);

  const hasData = data.manifest || data.inventory || data.imports || data.zones;

  // Show degradation banner when degraded and not already showing the memory warning (avoid stacking)
  const showDegradationBanner = isDegraded && !degradationDismissed && !showMemoryWarning;

  const viewCtx = { data, setDetail, setPrdDetailContent, selectedFile: page.file, setSelectedFile, selectedZone: page.zone, selectedRunId: page.runId, selectedTaskId: page.taskId, askSeed, navigateTo, isFeatureDisabled, askEnabled, validViews, jobs };

  return h(Fragment, null,
    // Skip link must be the first focusable element so keyboard users can bypass navigation.
    h("a", { href: "#main-content", class: "skip-link" }, "Skip to main content"),
    h(CrashRecoveryBanner, { visible: showRecovery, crashLoop, recentCrashCount, recoveredState, onDismiss: dismissRecovery, onRestore: handleRestore }),
    h(MemoryWarningBanner, { snapshot: memorySnapshot, level: memoryLevel, visible: showMemoryWarning, onDismiss: dismissMemoryWarning }),
    h(DegradationBanner, { tier: degradationTier, isDegraded, summary: degradationSummary, disabledFeatures, visible: showDegradationBanner, onDismiss: () => setDegradationDismissed(true) }),
    h(TopNav, { view: pageView, validViews, onNavigate: handleSidebarNav, navigateTo, onOpenSearch: openSearch, scope }),
    isLiveView(pageView) && validViews.has("live") && !isDeployedMode()
      ? h(LiveBar, { view: pageView, taskId: page.taskId, navigateTo })
      : null,
    h("div", { class: "app-body" },
      h("main", {
        id: "main-content",
        // The Tasks (prd) view manages its own internal scroll region, so the
        // main column becomes a non-scrolling flex container for it.
        class: `main${pageView === "prd" ? " main--fill" : ""}${stage && pageView !== "home" ? " main--staged" : ""}`,
        role: "main",
        "aria-label": "Main content",
        onClick: handleTripleClick,
      },
        // Page-context bar: breadcrumb navigation + help buttons
        h("div", { class: "page-context-bar", role: "group", "aria-label": "Page navigation and help" },
          h(Breadcrumb, { view: pageView, navigateTo, scope }),
          h("div", { class: "page-context-actions" },
            h(Guide, { view: pageView }),
          ),
        ),
        loading
          ? h("div", { class: "loading", role: "status", "aria-live": "polite" }, "Loading...")
          : renderActiveView(pageView, viewCtx),
      ),
      h(StageLinks, { stage, validViews, onNavigate: handleSidebarNav }),
      !isFeatureDisabled("detailPanel")
        ? h(DetailPanel, { detail, data, navigateTo, onClose: () => { setDetail(null); setPrdDetailContent(null); }, prdDetailContent })
        : null,
    ),
    h(BottomBar, {
      server,
      validViews,
      onNavigate: handleSidebarNav,
      onOpenSettings: openSettings,
      settingsOpen,
      onToggleCommands: toggleCommands,
      commandsOpen,
    }),
    h(CommandsSheet, { open: commandsOpen, onClose: closeCommands },
      renderActiveView("command-reference", viewCtx),
    ),
    settingsOpen
      ? h(SettingsOverlay, { view, validViews, onNavigate: handleSidebarNav, onClose: closeSettings, server },
          loading ? null : renderActiveView(view, viewCtx),
        )
      : null,
    (refreshToast && !isFeatureDisabled("autoRefresh"))
      ? h("div", { class: "refresh-toast", role: "status", "aria-live": "polite" }, "Data updated")
      : null,
    h(RefreshQueueStatus, { state: refreshQueueState, visible: !isFeatureDisabled("autoRefresh") }),
    h(PollingSuspensionIndicator, { isSuspended: pollingSuspended, suspendedCount: pollingSuspendedCount, onRefresh: handleManualRefresh }),
    h(ActiveOperationsTray, { operations: jobs.operations, navigateTo, onStop: jobs.stop }),
    h(GitStatusBanner, { status: gitStatus, onCommitted: refetchGitStatus }),
    h(SessionsPanel, { worktrees, claims, navigateTo, analyses, liveAvailable }),
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
