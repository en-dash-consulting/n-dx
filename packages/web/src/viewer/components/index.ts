/**
 * Dashboard panel components — public barrel.
 *
 * All cross-zone consumers should import from this barrel rather than
 * individual component files. This provides a single stable import surface
 * and makes it possible to split the zone later without auditing individual
 * import paths across consumer layers.
 */

// ── Panel components ─────────────────────────────────────────────────

export { ActiveTasksPanel } from "./active-tasks-panel.js";
export type { ActiveRun } from "./active-tasks-panel.js";
export { ConcurrencyPanel } from "./concurrency-panel.js";
export { MemoryPanel } from "./memory-panel.js";
export { WsHealthPanel } from "./ws-health-panel.js";
export { ThrottleControlsPanel } from "./throttle-controls.js";
export { DetailPanel } from "./detail-panel.js";

// ── Banners ──────────────────────────────────────────────────────────

export { CrashRecoveryBanner } from "./crash-recovery-banner.js";
export {
  DegradationBanner,
  type DegradationBannerProps,
} from "./degradation-banner.js";
export { MemoryWarningBanner } from "./memory-warning.js";

// ── UI primitives ────────────────────────────────────────────────────

export {
  Breadcrumb,
  type BreadcrumbProps,
} from "./breadcrumb.js";
export {
  CopyLinkButton,
  buildShareableUrl,
  type CopyLinkButtonProps,
} from "./copy-link-button.js";
export { ConfigFooter } from "./config-footer.js";
export { ElapsedTime } from "./elapsed-time.js";
export { updateFavicon, resetFavicon, FAVICON_PNGS, VIEW_TO_PRODUCT } from "./favicon.js";
export { SidebarThemeToggle, initTheme } from "./theme-toggle.js";
export { NdxLogoPng, ProductLogoPng, BrandedHeader } from "./logos.js";
export { PollingSuspensionIndicator } from "./polling-suspension-indicator.js";
export { RefreshQueueStatus } from "./refresh-queue-status.js";

// ── Status indicators ───────────────────────────────────────────────

export {
  useProjectStatus,
  SvFreshnessIndicator,
  RexCompletionIndicator,
  HenchActivityIndicator,
  type ProjectStatus,
  type SourceVisionStatus,
  type RexStatus,
  type HenchStatus,
} from "./status-indicators.js";

// ── Search ──────────────────────────────────────────────────────────

export { SearchFilter } from "./search-filter.js";
export { SearchOverlay, useSearchOverlay } from "./search-overlay.js";

// ── Easter eggs ──────────────────────────────────────────────────────

export {
  NeolithicOverlay,
  useNeolithicOverlay,
  NEOLITHIC_EVENT,
  type NeolithicOverlayProps,
} from "./neolithic-overlay.js";
export {
  createTripleClickDetector,
  TRIPLE_CLICK_PROBABILITY,
  type TripleClickDetectorOptions,
} from "./triple-click-detector.js";

// ── Task link ───────────────────────────────────────────────────────

export {
  RexTaskLink,
  type RexTaskLinkProps,
  type TaskRef,
} from "./rex-task-link.js";

// ── Navigation ──────────────────────────────────────────────────────

export { Sidebar } from "./sidebar.js";

// ── Content ─────────────────────────────────────────────────────────

export { Guide } from "./guide.js";
export { GlobalFAQ } from "./faq.js";
export { NotionSchemaWizard } from "./notion-schema-wizard.js";
export { ZoneSlideout } from "./zone-slideout.js";

// ── Constants ───────────────────────────────────────────────────────

export * from "./constants.js";
