/**
 * Static asset routes — serves the viewer HTML and image assets.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerContext } from "./types.js";

const LIVE_RELOAD_SNIPPET = `<script>
(function(){var last="";setInterval(function(){fetch("/data/status").then(function(r){return r.json()}).then(function(d){var cur=JSON.stringify(d);if(last&&cur!==last)location.reload();last=cur}).catch(function(){})},1500)})();
</script>`;

export interface StaticAssets {
  viewerPath: string;
  viewerDir: string;
  resolvedViewerDir: string;
  resolvedPackageRoot: string;
  getViewerHtml: () => string;
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
    findAssetPath,
  };
}

/** Handle static asset requests. Returns true if the request was handled. */
export function handleStaticRoute(
  req: IncomingMessage,
  res: ServerResponse,
  _ctx: ServerContext,
  assets: StaticAssets,
): boolean {
  const url = req.url || "/";

  // Index page
  if (url === "/" || url === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-cache" });
    res.end(assets.getViewerHtml());
    return true;
  }

  // PNG assets
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

  return false;
}
