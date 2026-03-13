/**
 * Deployed mode support — static export fetch adapter.
 *
 * When the viewer is exported as a static site via `ndx export`, a global
 * flag (`window.__NDX_DEPLOYED__`) is injected into the HTML.  This module
 * detects that flag and installs a fetch adapter that transparently rewrites
 * API requests to pre-rendered static JSON files.
 *
 * The adapter means no per-component changes are needed — existing `fetch()`
 * calls to `/api/*` and `/data/*` just work against the static file tree.
 */

interface DeployedConfig {
  basePath: string;
  exportedAt: string;
}

declare global {
  interface Window {
    __NDX_DEPLOYED__?: DeployedConfig;
  }
}

/** Check whether the viewer is running in deployed (static export) mode. */
export function isDeployedMode(): boolean {
  return typeof window !== "undefined" && window.__NDX_DEPLOYED__ != null;
}

/** Return the deployed config, or null if not in deployed mode. */
export function getDeployedConfig(): DeployedConfig | null {
  if (typeof window === "undefined") return null;
  return window.__NDX_DEPLOYED__ ?? null;
}

/**
 * Install a global fetch adapter that rewrites requests for deployed mode.
 *
 * Rewrites:
 *   GET /api/*          → {basePath}api/*.json
 *   GET /data           → {basePath}data/index.json
 *   GET /data/status    → synthetic { mtimes: {} }
 *   GET /data/*         → {basePath}data/*
 *   Non-GET methods     → synthetic 405 response
 *   Everything else     → pass through
 */
export function installFetchAdapter(): void {
  const config = getDeployedConfig();
  if (!config) return;

  const basePath = config.basePath.endsWith("/")
    ? config.basePath
    : config.basePath + "/";

  const originalFetch = globalThis.fetch;

  globalThis.fetch = function deployedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.pathname
        : input.url;

    const method = init?.method?.toUpperCase() ?? "GET";

    // Parse pathname from the URL
    let pathname: string;
    try {
      // Handle both absolute and relative URLs
      if (url.startsWith("http://") || url.startsWith("https://")) {
        pathname = new URL(url).pathname;
      } else {
        pathname = url.split("?")[0];
      }
    } catch {
      // Not a URL we need to intercept
      return originalFetch.call(globalThis, input, init);
    }

    // Non-GET mutations → 405
    if (method !== "GET" && (pathname.startsWith("/api/") || pathname.startsWith("/data"))) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: "Not available in deployed mode" }), {
          status: 405,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }

    // GET /data/status → synthetic empty mtimes (prevents polling changes)
    if (pathname === "/data/status") {
      return Promise.resolve(
        new Response(JSON.stringify({ mtimes: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }

    // GET /data → data/index.json (mode detection)
    if (pathname === "/data") {
      return originalFetch.call(globalThis, `${basePath}data/index.json`, init);
    }

    // GET /data/* → basePath + data/*
    if (pathname.startsWith("/data/")) {
      return originalFetch.call(globalThis, `${basePath}${pathname.slice(1)}`, init);
    }

    // GET /api/* → basePath + api/*.json
    if (pathname.startsWith("/api/")) {
      const apiPath = pathname.slice(1); // remove leading /
      return originalFetch.call(globalThis, `${basePath}${apiPath}.json`, init);
    }

    // Everything else → pass through
    return originalFetch.call(globalThis, input, init);
  };
}
