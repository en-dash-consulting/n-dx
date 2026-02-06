/**
 * Local dev server for the sourcevision viewer.
 * Serves the built viewer HTML and the .sourcevision/ data directory.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync, statSync, watch, realpathSync } from "node:fs";
import { join, resolve, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

import { ALL_DATA_FILES, SUPPLEMENTARY_FILES } from "../schema/data-files.js";

interface ServerOptions {
  dev?: boolean;
}

const LIVE_RELOAD_SNIPPET = `<script>
(function(){var last="";setInterval(function(){fetch("/data/status").then(function(r){return r.json()}).then(function(d){var cur=JSON.stringify(d);if(last&&cur!==last)location.reload();last=cur}).catch(function(){})},1500)})();
</script>`;

export function startServer(targetDir: string, port: number = 3117, opts: ServerOptions = {}): void {
  const absDir = resolve(targetDir);
  const svDir = join(absDir, ".sourcevision");
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const dev = opts.dev ?? false;

  if (!existsSync(svDir)) {
    console.error(`No .sourcevision/ directory found in: ${absDir}`);
    console.error("Run 'sourcevision analyze' first.");
    process.exit(1);
  }

  // Find the viewer HTML — look in dist/ relative to this file
  const viewerCandidates = [
    resolve(thisDir, "../../dist/viewer/index.html"),
    resolve(thisDir, "../viewer/index.html"),
  ];

  let viewerPath: string | null = null;
  for (const p of viewerCandidates) {
    if (existsSync(p)) {
      viewerPath = p;
      break;
    }
  }

  if (!viewerPath) {
    console.error("Viewer HTML not found. Run 'npm run build:viewer' first.");
    process.exit(1);
  }

  const viewerDir = dirname(viewerPath);
  const packageRoot = resolve(thisDir, "../..");
  // Resolve symlinks so asset paths work when run via n-dx from another project (e.g. node_modules/n-dx/...)
  const resolvedViewerDir = resolveDirRealpath(viewerDir);
  const resolvedPackageRoot = resolveDirRealpath(packageRoot);

  function resolveDirRealpath(dir: string): string {
    try {
      return realpathSync(dir);
    } catch {
      return dir;
    }
  }

  function findAssetPath(filename: string): string | null {
    const inViewer = join(resolvedViewerDir, filename);
    const inRoot = join(resolvedPackageRoot, filename);
    return existsSync(inViewer) ? inViewer : existsSync(inRoot) ? inRoot : null;
  }

  // In production mode, cache the HTML once. In dev mode, re-read on each request.
  let cachedViewerHtml: string | null = dev ? null : readFileSync(viewerPath, "utf-8");

  function getViewerHtml(): string {
    if (dev) {
      let html = readFileSync(viewerPath!, "utf-8");
      // Inject live-reload snippet before </body>
      html = html.replace("</body>", `${LIVE_RELOAD_SNIPPET}</body>`);
      return html;
    }
    return cachedViewerHtml!;
  }

  // Track file mtimes for live reload
  const fileMtimes: Record<string, number> = {};
  let viewerMtime = 0;

  function refreshMtimes(): void {
    for (const file of ALL_DATA_FILES) {
      const filePath = join(svDir, file);
      try {
        if (existsSync(filePath)) {
          fileMtimes[file] = statSync(filePath).mtimeMs;
        }
      } catch {
        // File may be mid-write
      }
    }
    // Track viewer HTML mtime in dev mode
    if (dev && viewerPath) {
      try {
        viewerMtime = statSync(viewerPath).mtimeMs;
      } catch {
        // ignore
      }
    }
  }

  refreshMtimes();

  // Watch .sourcevision/ for changes
  try {
    watch(svDir, (eventType, filename) => {
      if (filename && (ALL_DATA_FILES as readonly string[]).includes(filename)) {
        refreshMtimes();
      }
    });
  } catch {
    // fs.watch may not be supported everywhere
  }

  // In dev mode, also watch the viewer HTML for rebuilds
  if (dev && viewerPath) {
    try {
      watch(dirname(viewerPath), (eventType, filename) => {
        if (filename === "index.html") {
          refreshMtimes();
        }
      });
    } catch {
      // ignore
    }
  }

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url || "/";

    // CORS headers for local dev
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET");

    if (url === "/" || url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-cache" });
      res.end(getViewerHtml());
      return;
    }

    // Serve viewer static assets (e.g. logo) from viewer dir or package root (resolved for symlinked installs)
    if (url === "/SourceVision.png" || url === "/SourceVision-F.png") {
      const filename = url.slice(1);
      const pngPath = findAssetPath(filename);
      if (pngPath) {
        const content = readFileSync(pngPath);
        res.writeHead(200, { "Content-Type": "image/png" });
        res.end(content);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
      return;
    }

    // Status endpoint for live reload polling
    if (url === "/data/status") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
      const status: Record<string, unknown> = { mtimes: fileMtimes };
      if (dev) status.viewerMtime = viewerMtime;
      res.end(JSON.stringify(status));
      return;
    }

    // Serve .sourcevision/ data files
    if (url.startsWith("/data/")) {
      const dataFile = url.replace("/data/", "");
      const filePath = join(svDir, dataFile);

      // Prevent directory traversal
      if (!filePath.startsWith(svDir)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }

      if (existsSync(filePath)) {
        const ext = extname(filePath);
        const mime = MIME_TYPES[ext] || "application/octet-stream";
        const content = readFileSync(filePath, "utf-8");
        res.writeHead(200, { "Content-Type": mime });
        res.end(content);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
      return;
    }

    // List available data files
    if (url === "/data") {
      const files = [...ALL_DATA_FILES, ...SUPPLEMENTARY_FILES];
      const available = files.filter((f) => existsSync(join(svDir, f)));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ files: available }));
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  server.listen(port, () => {
    console.log(`Sourcevision viewer running at http://localhost:${port}`);
    console.log(`Serving data from: ${svDir}`);
    if (dev) console.log("Dev mode: live reload enabled");
    console.log("Press Ctrl+C to stop.");
  });
}
