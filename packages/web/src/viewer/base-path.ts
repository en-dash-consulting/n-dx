/**
 * Where this viewer is mounted, and how to address the server from there.
 *
 * Standalone the dashboard is served at `/`; behind the hub it is served at
 * `/p/<id>/` and proxied to the project server with that prefix stripped; a
 * worktree other than the anchor is addressed under `/w/<key>/`, which the
 * project server strips itself. The base is derived once from
 * `location.pathname` at boot — both servers serve the SPA for every path
 * under their prefix, so the leading `/p/<id>` and `/w/<key>` segments are
 * always where they were on the first load.
 *
 * Three ways the prefix reaches the wire:
 *
 * - {@link installBasePathFetch} wraps `fetch` so the ~150 root-relative
 *   `fetch("/api/...")` / `fetch("/data/...")` calls across the viewer need
 *   no change — the same adapter pattern deployed-mode.ts already uses.
 * - {@link getWebSocketUrl} is what every socket consumer connects to.
 * - {@link appUrl} for the few places that build a URL by hand: history
 *   entries, the shareable-link button, the logo image.
 *
 * {@link hubUrl} is the one address that is deliberately *not* prefixed — the
 * hub's chooser sits above every project rather than inside one.
 *
 * The pure helpers live in src/shared/base-path.ts (via external.ts); this
 * module adds the browser-bound state.
 */

import { HUB_PATH, detectViewerBasePath, frameIsForWorkspace, webSocketUrl, withBasePath, workspaceKeyFromBasePath } from "./external.js";

let cachedBasePath: string | null = null;

/**
 * `/p/<id>` when served through the hub, `/w/<key>` when addressing a worktree
 * other than the anchor, both when both — `""` at the root. Memoised.
 */
export function getBasePath(): string {
  if (cachedBasePath === null) {
    cachedBasePath = typeof location !== "undefined" ? detectViewerBasePath(location.pathname) : "";
  }
  return cachedBasePath;
}

/** The workspace this viewer addresses, or null for the anchor. */
export function getWorkspaceKey(): string | null {
  return workspaceKeyFromBasePath(getBasePath());
}

/**
 * Whether a WebSocket frame concerns this viewer's workspace. Raw socket
 * consumers call this right after parsing; pipeline consumers pass
 * `workspace: getWorkspaceKey()` instead and the pipeline filters.
 */
export function acceptsFrame(frame: Readonly<Record<string, unknown>>): boolean {
  return frameIsForWorkspace(frame, getWorkspaceKey());
}

/** @internal Test seam — clears or fixes the memoised base path. */
export function setBasePathForTests(basePath: string | null): void {
  cachedBasePath = basePath;
}

/** A root-relative app path (`/api/x`, `/prd/123`) as it must be requested from here. */
export function appUrl(path: string): string {
  return withBasePath(getBasePath(), path);
}

/**
 * The hub's project chooser, for a link out of this dashboard.
 *
 * Deliberately not `appUrl(HUB_PATH)`, which the shape of every neighbouring
 * call invites: `appUrl` is for paths this viewer's own server answers, and
 * would produce `/p/<id>/w/<key>/hub` — a project path, proxied to a project
 * server that has no such route. The chooser sits above every project, so its
 * address is the same from anywhere and carries no base path at all.
 *
 * Standalone (`web serve`, a static export) nothing answers it; the caller
 * decides whether to offer the link. The breadcrumb asks the hub
 * (`useHubProjects` in components/project-switcher.ts) rather than reading
 * `getBasePath()`, which is empty under the hub's single-project root alias.
 */
export function hubUrl(): string {
  return HUB_PATH;
}

/** The WebSocket endpoint for live updates from this viewer's server. */
export function getWebSocketUrl(): string {
  return webSocketUrl(location.protocol, location.host, getBasePath());
}

/**
 * Prefix root-relative `fetch` URLs with the base path. No-op at the root.
 *
 * String inputs are rewritten; `Request` objects whose URL points at this
 * origin are re-created with the rewritten path; absolute URLs to other
 * origins and `URL` objects (already absolute) pass through.
 */
export function installBasePathFetch(): void {
  const basePath = getBasePath();
  if (!basePath) return;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = function basePathFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (typeof input === "string") {
      return originalFetch(withBasePath(basePath, input), init);
    }
    if (typeof Request !== "undefined" && input instanceof Request) {
      try {
        const parsed = new URL(input.url);
        if (parsed.origin === location.origin) {
          const rewritten = withBasePath(basePath, parsed.pathname) + parsed.search + parsed.hash;
          if (rewritten !== parsed.pathname + parsed.search + parsed.hash) {
            return originalFetch(new Request(`${parsed.origin}${rewritten}`, input), init);
          }
        }
      } catch {
        // Unparseable — hand it to fetch untouched and let it fail there.
      }
    }
    return originalFetch(input, init);
  };
}
