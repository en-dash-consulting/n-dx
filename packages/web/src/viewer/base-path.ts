/**
 * Where this viewer is mounted, and how to address the server from there.
 *
 * Standalone the dashboard is served at `/`; behind the hub it is served at
 * `/p/<id>/` and proxied to the project server with that prefix stripped.
 * The prefix is derived once from `location.pathname` at boot — the hub
 * serves the SPA for every path under the prefix, so the first segment pair
 * is always `/p/<id>` when there is one.
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
 * The pure helpers live in src/shared/base-path.ts (via external.ts); this
 * module adds the browser-bound state.
 */

import { detectBasePath, webSocketUrl, withBasePath } from "./external.js";

let cachedBasePath: string | null = null;

/** `/p/<id>` when served through the hub, `""` at the root. Memoised. */
export function getBasePath(): string {
  if (cachedBasePath === null) {
    cachedBasePath = typeof location !== "undefined" ? detectBasePath(location.pathname) : "";
  }
  return cachedBasePath;
}

/** @internal Test seam — clears or fixes the memoised base path. */
export function setBasePathForTests(basePath: string | null): void {
  cachedBasePath = basePath;
}

/** A root-relative app path (`/api/x`, `/prd/123`) as it must be requested from here. */
export function appUrl(path: string): string {
  return withBasePath(getBasePath(), path);
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
