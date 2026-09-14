/**
 * Served-behind-the-hub support — base-path derivation and URL helpers.
 *
 * Behind the hub the dashboard lives under `/p/<id>/`; served directly by
 * `web serve` it lives at `/`. The base path is derived once from
 * `location.pathname` at boot — the hub strips the prefix before proxying,
 * so nothing needs to be injected into the HTML and the direct-serve case
 * derives `""` and stays byte-identical in behaviour.
 *
 * Three consumers, three shapes:
 *  - `installBasePathFetchAdapter()` — one global adapter covering the
 *    viewer's ~160 root-absolute `fetch("/api/…")`/`fetch("/data/…")` calls
 *    (including endpoint strings the server supplies in the commands
 *    manifest), mirroring deployed-mode.ts's adapter for static exports.
 *  - `wsUrl()` — the WebSocket origin, replacing the bare
 *    `${proto}//${location.host}` idiom so upgrades reach `/p/<id>/` and the
 *    hub can route them to the right child.
 *  - `withBase()` — for history.pushState/replaceState URLs, which a fetch
 *    adapter cannot reach.
 *
 * Deployed (static export) mode is mutually exclusive with hub mode: exports
 * carry `window.__NDX_DEPLOYED__` and their own base-path handling in
 * deployed-mode.ts; main.ts installs exactly one of the two adapters.
 */

import { deriveBasePath, joinBasePath } from "./external.js";

let cached: string | null = null;

/** The base path this document is served under: `"/p/<id>"` or `""`. */
export function viewerBasePath(): string {
  if (cached === null) {
    cached = typeof location !== "undefined" ? deriveBasePath(location.pathname) : "";
  }
  return cached;
}

/** Reset the boot-time cache — tests re-derive after changing location. */
export function resetViewerBasePathForTests(): void {
  cached = null;
}

/** Prefix a root-absolute path with the viewer's base path. */
export function withBase(path: string): string {
  return joinBasePath(viewerBasePath(), path);
}

/**
 * WebSocket connection URL for this document, base path included.
 * Replaces the `${proto}//${location.host}` idiom at the call sites.
 */
export function getWsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${viewerBasePath()}`;
}

/**
 * Install a global fetch adapter that prefixes root-absolute string URLs
 * with the base path. A no-op when served at the root, so direct `web serve`
 * keeps the untouched native fetch. Absolute URLs, `URL`/`Request` inputs,
 * and already-prefixed paths pass through unchanged — the viewer's own calls
 * are all root-absolute string literals (see the survey in this module's
 * header), and anything else is not ours to rewrite.
 */
export function installBasePathFetchAdapter(): void {
  const basePath = viewerBasePath();
  if (basePath === "") return;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = function basePathFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    if (typeof input === "string" && input.startsWith("/")) {
      return originalFetch.call(globalThis, joinBasePath(basePath, input), init);
    }
    return originalFetch.call(globalThis, input, init);
  };
}
