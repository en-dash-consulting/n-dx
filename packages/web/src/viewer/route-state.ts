import type { ViewId } from "./types.js";
import { stripBasePath, resolveViewAliasRoute } from "./external.js";

export interface ParsedRoute {
  view: ViewId;
  subId: string | null;
}

/**
 * The page a bare URL opens on, and the one shown under the settings overlay
 * when a settings route is opened directly: the landing page whenever it
 * exists (it is a cross-cutting view, so it does in every scope), else the
 * first valid view.
 */
export function defaultView(validViews: Set<ViewId>): ViewId {
  if (validViews.has("home")) return "home";
  return validViews.values().next().value as ViewId;
}

const DEEP_LINK_VIEWS = new Set<ViewId>(["prd", "hench-runs", "commands"]);

/**
 * Views whose `subId` is a task id (the rest of `/<view>/<subId>` is a run id or unused).
 * On `work` and `tune` it is the task the Prepare task modal is open for.
 */
export function isTaskRouteView(view: ViewId): boolean {
  return view === "prd" || view === "live-task" || view === "work" || view === "tune";
}

/** Tabs Settings › Commands names in its sub-path; the Run tab is the bare `/commands`. */
const COMMANDS_PATH_TABS: ReadonlySet<string> = new Set(["reference"]);

/**
 * The tab a route opens on a view that keeps its tab in the path (`/commands/reference`).
 * Null for every other view, and for an unrecognised sub-path, so the address
 * bar settles on the page the viewer actually shows.
 */
export function routeTab(view: ViewId, subId: string | null): string | null {
  if (view === "product" && subId && isProductSubPath(subId)) return subId;
  return view === "commands" && subId && COMMANDS_PATH_TABS.has(subId) ? subId : null;
}

/**
 * An area's page, `/product/area/<slug>`, or with a capability selected,
 * `/product/area/<slug>/capability/<id>`; its sub-path rides in the route's tab.
 */
const AREA_PATH = /^area\/([^/]+)(?:\/capability\/([^/]+))?$/;

/** Placement mode for one Inbox change, `/product/place/<changeId>`. */
const PLACE_PATH = /^place\/([^/]+)$/;

/** A Product sub-path the route keeps: an area's, or placement mode's. */
function isProductSubPath(sub: string): boolean {
  return AREA_PATH.test(sub) || PLACE_PATH.test(sub);
}

/**
 * Capture `group` of `re` in a tab, URI-decoded (the tab carries it as it sits
 * in the address). Null when the tab does not match, and when the capture is
 * malformed: a hand-edited address like `/product/area/%E0` names nothing.
 */
function decodedTabCapture(tab: string | null, re: RegExp, group: number): string | null {
  const raw = tab && re.exec(tab)?.[group];
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/** The Product tab that opens placement mode for `changeId`. */
export function placementTab(changeId: string): string {
  return `place/${encodeURIComponent(changeId)}`;
}

/** The change a `place/<id>` tab places, or null when the tab is not placement mode's. */
export function placeChangeOfTab(tab: string | null): string | null {
  return decodedTabCapture(tab, PLACE_PATH, 1);
}

/**
 * The slug an `area/<slug>` tab names, decoded, or null when the tab is not
 * an area's or the slug is malformed.
 */
export function areaSlugOfTab(tab: string | null): string | null {
  return decodedTabCapture(tab, AREA_PATH, 1);
}

/**
 * The capability `area/<slug>/capability/<id>` selects in the area, or null.
 * A malformed id is no selection: the area shows.
 */
export function areaCapabilityOfTab(tab: string | null): string | null {
  return decodedTabCapture(tab, AREA_PATH, 2);
}

/**
 * The Work page, with the Prepare task modal open at `/work/prep/<taskId>`,
 * and Work's Tune mode the same way at `/tune/prep/<taskId>` (Ready to run
 * lives there). Any other sub-path is the bare page: the modal is the only
 * thing such a sub-path names, so nothing else may be read as a task id.
 */
function parseWorkPath(base: string, sub: string): ParsedRoute | null {
  if (base !== "work" && base !== "tune") return null;
  const prep = /^prep\/([^/]+)$/.exec(sub);
  return { view: base, subId: prep ? prep[1] : null };
}

/**
 * Live's pages live under one `/live` prefix — `/live`, `/live/analyze`,
 * `/live/task/<taskId>` — while their ids are separate views, so the generic
 * `/<view>/<subId>` form does not apply to them.
 */
function parseLivePath(base: string, sub: string): ParsedRoute | null {
  if (base !== "live") return null;
  if (!sub) return { view: "live", subId: null };
  if (sub === "analyze") return { view: "live-analyze", subId: null };
  const task = /^task\/(.+)$/.exec(sub);
  return task ? { view: "live-task", subId: task[1] } : null;
}

/**
 * `live-task` is a page about one task, so without a task id there is nothing
 * to show; it means the Live overview. Every route entry passes through here.
 */
export function normalizeLiveView(view: ViewId, subId: string | null): ViewId {
  return view === "live-task" && !subId ? "live" : view;
}

/** The path a view and its sub-id are addressed at — the inverse of {@link parsePathnameRoute}. */
export function viewPathname(view: ViewId, subId: string | null): string {
  if (view === "live-task") return subId ? `/live/task/${subId}` : "/live";
  if (view === "live-analyze") return "/live/analyze";
  if (view === "work" || view === "tune") return subId ? `/${view}/prep/${subId}` : `/${view}`;
  return subId ? `/${view}/${subId}` : `/${view}`;
}

function resolveLegacyViewAlias(base: string, sub: string | null): ViewId | null {
  const normalizedBase = base.trim().toLowerCase();
  const normalizedSub = (sub ?? "").trim().toLowerCase();
  if (
    (normalizedBase === "rex-dashboard" || normalizedBase === "rex")
    && (normalizedSub === "token-usage" || normalizedSub === "token_usage" || normalizedSub === "llm-utilization")
  ) {
    return "token-usage";
  }
  return null;
}

function normalizeHashRoute(hash: string): string {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  let decoded = raw.trim();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep raw hash text when decoding fails.
  }
  decoded = decoded.replace(/^\/+/, "");
  if (decoded.startsWith("sourcevision/")) decoded = decoded.slice("sourcevision/".length);
  if (decoded.startsWith("sourcevision:")) decoded = decoded.slice("sourcevision:".length);
  const queryIdx = decoded.search(/[?&]/);
  if (queryIdx >= 0) decoded = decoded.slice(0, queryIdx);
  return decoded.replace(/^\/+/, "").replace(/\/+$/, "");
}

function normalizeHashView(base: string): string {
  const normalized = base.trim().toLowerCase();
  if (normalized === "prmarkdown" || normalized === "pr_markdown") return "pr-markdown";
  return normalized;
}

/**
 * @param basePath `/p/<id>` when the viewer is served through the hub and/or
 *   `/w/<key>` when it addresses a worktree; the prefix is removed before the
 *   view segment is read, so `/p/x/w/y/prd/123` and `/prd/123` parse identically.
 */
export function parsePathnameRoute(pathname: string, validViews: Set<ViewId>, basePath = ""): ParsedRoute | null {
  const raw = stripBasePath(basePath, pathname).slice(1).replace(/^\/+/, "").replace(/\/+$/, "");
  if (!raw) return null;

  const slashIdx = raw.indexOf("/");
  const base = slashIdx > 0 ? raw.slice(0, slashIdx) : raw;
  const sub = slashIdx > 0 ? raw.slice(slashIdx + 1) : "";

  const legacyAlias = resolveLegacyViewAlias(base, sub || null);
  if (legacyAlias && validViews.has(legacyAlias)) return { view: legacyAlias, subId: null };

  // A path merged into a stage in 0.8.0 (e.g. `overview` -> `analyze`) takes
  // priority over the literal check below, which would otherwise still match
  // it — `overview`/`rex-dashboard` remain registered ViewIds for the scoped
  // viewers that keep them as their own page. Any trailing sub-path rides
  // along unexamined, same as an unrecognised sub-path does today, so it is
  // preserved in the address bar rather than dropped.
  const moved = resolveViewAliasRoute(base, validViews);
  if (moved?.view === "work") return parseWorkPath("work", sub);
  if (moved) return { view: moved.view, subId: sub || moved.sub };

  const work = parseWorkPath(base, sub);
  if (work && validViews.has(work.view)) return work;

  const live = parseLivePath(base, sub);
  if (live && validViews.has(live.view)) return live;

  if (validViews.has(raw as ViewId)) {
    const view = normalizeLiveView(raw as ViewId, null);
    return { view: validViews.has(view) ? view : (raw as ViewId), subId: null };
  }

  if (slashIdx > 0) {
    const view = base as ViewId;
    if (validViews.has(view) && sub && DEEP_LINK_VIEWS.has(view)) return { view, subId: sub };
    // An area's page, or placement mode. Until they have their own views they are the Product page.
    if (view === "product" && validViews.has(view) && isProductSubPath(sub)) return { view, subId: sub };
  }
  return null;
}

export function parseLegacyHashRoute(hash: string, validViews: Set<ViewId>): ParsedRoute | null {
  if (!hash) return null;
  const normalized = normalizeHashRoute(hash);
  if (!normalized) return null;

  const slashIdx = normalized.indexOf("/");
  const base = slashIdx > 0 ? normalized.slice(0, slashIdx) : normalized;
  const sub = slashIdx > 0 ? normalized.slice(slashIdx + 1) : "";
  const legacyAlias = resolveLegacyViewAlias(base, sub || null);
  if (legacyAlias && validViews.has(legacyAlias)) return { view: legacyAlias, subId: null };
  const normalizedBase = normalizeHashView(base);
  const normalizedPath = sub ? `/${normalizedBase}/${sub}` : `/${normalizedBase}`;
  return parsePathnameRoute(normalizedPath, validViews);
}

export function resolveLocationRoute(
  pathname: string,
  hash: string,
  validViews: Set<ViewId>,
  basePath = "",
): ParsedRoute | null {
  return parseLegacyHashRoute(hash, validViews) ?? parsePathnameRoute(pathname, validViews, basePath);
}
