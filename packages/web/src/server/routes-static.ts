/**
 * Static asset routes — serves the viewer HTML and image assets.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerContext } from "./types.js";

const LIVE_RELOAD_SNIPPET = `<script>
(function(){
  var proto = location.protocol === "https:" ? "wss:" : "ws:";
  var url = proto + "//" + location.host;
  var reconnectDelay = 1000;
  function connect() {
    var ws = new WebSocket(url);
    ws.onmessage = function(e) {
      try {
        var msg = JSON.parse(e.data);
        if (msg.type === "viewer:reload") location.reload();
      } catch(err) {}
    };
    ws.onclose = function() {
      setTimeout(connect, reconnectDelay);
    };
  }
  connect();
})();
</script>`;

export interface StaticAssets {
  viewerPath: string;
  viewerDir: string;
  resolvedViewerDir: string;
  resolvedPackageRoot: string;
  getViewerHtml: () => string;
  getLandingHtml: () => string | null;
  findAssetPath: (filename: string) => string | null;
}

function resolveDirRealpath(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
}

/** Locate and prepare static assets. Returns null if viewer HTML is not found. */
export function resolveStaticAssets(dev: boolean): StaticAssets | null {
  const thisDir = dirname(fileURLToPath(import.meta.url));

  const viewerCandidates = [
    resolve(thisDir, "../viewer/index.html"),
    resolve(thisDir, "../../src/viewer/index.html"),
  ];

  let viewerPath: string | null = null;
  for (const p of viewerCandidates) {
    if (existsSync(p)) {
      viewerPath = p;
      break;
    }
  }

  if (!viewerPath) return null;

  const viewerDir = dirname(viewerPath);
  const packageRoot = resolve(thisDir, "../..");
  const resolvedViewerDir = resolveDirRealpath(viewerDir);
  const resolvedPackageRoot = resolveDirRealpath(packageRoot);

  let cachedViewerHtml: string | null = dev ? null : readFileSync(viewerPath, "utf-8");

  const vp = viewerPath;
  function getViewerHtml(): string {
    if (dev) {
      let html = readFileSync(vp, "utf-8");
      html = html.replace("</body>", `${LIVE_RELOAD_SNIPPET}</body>`);
      return html;
    }
    return cachedViewerHtml!;
  }

  // Resolve landing page HTML (parallel to viewer)
  const landingCandidates = [
    resolve(thisDir, "../landing/index.html"),
    resolve(thisDir, "../../src/landing/index.html"),
  ];
  let landingPath: string | null = null;
  for (const p of landingCandidates) {
    if (existsSync(p)) {
      landingPath = p;
      break;
    }
  }

  let cachedLandingHtml: string | null = landingPath && !dev ? readFileSync(landingPath, "utf-8") : null;

  const lp = landingPath;
  function getLandingHtml(): string | null {
    if (!lp) return null;
    if (dev) {
      let html = readFileSync(lp, "utf-8");
      html = html.replace("</body>", `${LIVE_RELOAD_SNIPPET}</body>`);
      return html;
    }
    return cachedLandingHtml;
  }

  function findAssetPath(filename: string): string | null {
    const inViewer = resolve(resolvedViewerDir, filename);
    const inRoot = resolve(resolvedPackageRoot, filename);
    return existsSync(inViewer) ? inViewer : existsSync(inRoot) ? inRoot : null;
  }

  return {
    viewerPath,
    viewerDir,
    resolvedViewerDir,
    resolvedPackageRoot,
    getViewerHtml,
    getLandingHtml,
    findAssetPath,
  };
}

// Known SPA view paths — keep in sync with ViewId in types.ts
const SPA_VIEWS = new Set([
  "overview", "graph", "zones", "files", "routes", "architecture",
  "problems", "suggestions", "rex-dashboard", "prd",
  "token-usage", "validation", "hench-runs", "hench-audit",
  "hench-config", "hench-templates", "hench-optimization",
]);

/** Check if the project has been initialized (any tool directory exists). */
export function isProjectInitialized(ctx: ServerContext): boolean {
  return existsSync(join(ctx.svDir, "manifest.json")) || existsSync(join(ctx.rexDir, "prd.json"));
}

/** Handle static asset requests. Returns true if the request was handled. */
export function handleStaticRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  assets: StaticAssets,
): boolean {
  const url = req.url || "/";

  // Root: dashboard if initialized, landing page otherwise
  if (url === "/" || url === "/index.html") {
    if (isProjectInitialized(ctx)) {
      res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-cache" });
      res.end(assets.getViewerHtml());
      return true;
    }
    const landingHtml = assets.getLandingHtml();
    if (landingHtml) {
      res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-cache" });
      res.end(landingHtml);
      return true;
    }
    // No landing page available — serve viewer anyway
    res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-cache" });
    res.end(assets.getViewerHtml());
    return true;
  }

  // Backward compat: /landing → redirect to /
  if (url === "/landing" || url === "/landing/") {
    res.writeHead(301, { Location: "/" });
    res.end();
    return true;
  }

  // PNG assets (must come before SPA catch-all)
  if (url.endsWith(".png") && /^\/[\w-]+\.png$/.test(url)) {
    const filename = url.slice(1);
    const pngPath = assets.findAssetPath(filename);
    if (pngPath) {
      const content = readFileSync(pngPath);
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" });
      res.end(content);
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
    return true;
  }

  // SPA catch-all: known view paths serve the viewer HTML
  // Also match deep-link paths like "hench-runs/RUNID"
  const segment = url.slice(1).split("?")[0];
  const baseSegment = segment.split("/")[0];
  if (SPA_VIEWS.has(segment) || SPA_VIEWS.has(baseSegment)) {
    res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-cache" });
    res.end(assets.getViewerHtml());
    return true;
  }

  return false;
}
