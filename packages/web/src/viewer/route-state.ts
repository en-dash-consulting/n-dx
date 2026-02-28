import type { ViewId } from "./types.js";

export interface ParsedRoute {
  view: ViewId;
  subId: string | null;
}

const DEEP_LINK_VIEWS = new Set<ViewId>(["prd", "hench-runs"]);

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

export function parsePathnameRoute(pathname: string, validViews: Set<ViewId>): ParsedRoute | null {
  const raw = pathname.slice(1).replace(/^\/+/, "").replace(/\/+$/, "");
  if (!raw) return null;

  const slashIdx = raw.indexOf("/");
  const base = slashIdx > 0 ? raw.slice(0, slashIdx) : raw;
  const sub = slashIdx > 0 ? raw.slice(slashIdx + 1) : "";

  const legacyAlias = resolveLegacyViewAlias(base, sub || null);
  if (legacyAlias && validViews.has(legacyAlias)) return { view: legacyAlias, subId: null };

  if (validViews.has(raw as ViewId)) return { view: raw as ViewId, subId: null };

  if (slashIdx > 0) {
    const view = base as ViewId;
    if (validViews.has(view) && sub && DEEP_LINK_VIEWS.has(view)) return { view, subId: sub };
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
  const parsed = parsePathnameRoute(normalizedPath, validViews);
  if (!parsed) return null;
  return parsed;
}

export function resolveLocationRoute(
  pathname: string,
  hash: string,
  validViews: Set<ViewId>,
): ParsedRoute | null {
  return parseLegacyHashRoute(hash, validViews) ?? parsePathnameRoute(pathname, validViews);
}
