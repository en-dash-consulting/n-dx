/**
 * Preview server — serves a standalone HTML layout document with live reload.
 *
 * `ndx start --preview` runs this instead of the real dashboard. It is a design
 * surface, not a second dashboard: a single static HTML document is read from
 * disk on every request and served with a small polling snippet appended, so
 * editing the file and hitting save is immediately visible in the browser.
 *
 * Deliberately minimal — no PRD watchers, no MCP endpoints, no hench process
 * supervision, no writes to `.rex/` or `.sourcevision/`. That is what makes it
 * safe to run alongside `ndx start` on a second port: the preview process
 * touches nothing the real server owns except its own port file.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { writeFile, unlink } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Default port for the preview server — one above the dashboard's 3117. */
export const DEFAULT_PREVIEW_PORT = 3118;

/** Port file written by the preview process, kept distinct from `.n-dx-web.port`. */
export const PREVIEW_PORT_FILE = ".n-dx-preview.port";

const LOOPBACK_HOST = "127.0.0.1";

/** How often the browser asks whether the document changed on disk. */
const DEFAULT_RELOAD_INTERVAL_MS = 600;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".md": "text/plain; charset=utf-8",
};

export interface PreviewOptions {
  /** Path to the HTML document to serve. Defaults to the bundled layout mock-up. */
  file?: string;
  /** Poll interval for the injected reload script, in ms. */
  reloadIntervalMs?: number;
}

export interface PreviewServerHandle {
  /** The port actually bound — resolved from the OS when 0 was requested. */
  port: number;
  docPath: string;
  close(): Promise<void>;
}

/**
 * Locate the HTML document to serve.
 *
 * The source copy wins over the built copy on purpose: in a monorepo checkout
 * the whole point is to edit `src/preview/index.html` and watch the browser
 * update, which would not happen if a stale `dist/preview/index.html` shadowed
 * it. Published installs have no `src/`, so they fall through to `dist/`.
 *
 * @param file  Explicit path (relative to cwd or absolute) overriding the default.
 * @param cwd   Base directory an explicit relative `file` resolves against.
 * @returns Absolute path, or null when nothing was found.
 */
export function resolvePreviewDoc(file?: string, cwd: string = process.cwd()): string | null {
  if (file) {
    const explicit = resolve(cwd, file);
    return existsSync(explicit) ? explicit : null;
  }

  const thisDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(thisDir, "../../src/preview/index.html"),
    resolve(thisDir, "../preview/index.html"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Fingerprint used by the reload poller — changes whenever the file is saved. */
function docFingerprint(docPath: string): string {
  try {
    const stat = statSync(docPath);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return "missing";
  }
}

/** The polling reload snippet injected into the served document. */
function reloadSnippet(intervalMs: number): string {
  return `<script>
(function () {
  var current = null;
  function poll() {
    fetch("/__preview/state", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (s) {
        if (current === null) { current = s.fingerprint; return; }
        if (s.fingerprint !== current) location.reload();
      })
      .catch(function () { /* server restarting — keep polling */ });
  }
  setInterval(poll, ${intervalMs});
  poll();
})();
</script>`;
}

/** Append the reload snippet, preferring just before `</body>`. */
function withReloadSnippet(html: string, intervalMs: number): string {
  const snippet = reloadSnippet(intervalMs);
  if (html.includes("</body>")) return html.replace("</body>", `${snippet}\n</body>`);
  return html + snippet;
}

/**
 * Resolve a request path to a file next to the document.
 *
 * Returns null for anything that escapes the document's directory, so a
 * `../../../etc/passwd` style request cannot read outside the preview folder.
 */
function resolveSibling(docDir: string, urlPath: string): string | null {
  const relative = decodeURIComponent(urlPath.replace(/^\/+/, ""));
  if (!relative) return null;
  const target = resolve(docDir, relative);
  let realDir: string;
  let realTarget: string;
  try {
    realDir = realpathSync(docDir);
    realTarget = realpathSync(target);
  } catch {
    return null;
  }
  if (realTarget !== realDir && !realTarget.startsWith(realDir + sep)) return null;
  try {
    return statSync(realTarget).isFile() ? realTarget : null;
  } catch {
    return null;
  }
}

function send(res: ServerResponse, status: number, body: string | Buffer, type: string): void {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store, no-cache, must-revalidate",
  });
  res.end(body);
}

/**
 * Start the preview server.
 *
 * @param dir   Project directory — only used to place the port file.
 * @param port  Requested port; the caller is responsible for choosing a free one.
 * @param opts  Document override and reload cadence.
 */
export async function startPreviewServer(
  dir: string,
  port: number = DEFAULT_PREVIEW_PORT,
  opts: PreviewOptions = {},
): Promise<PreviewServerHandle> {
  const absDir = resolve(dir);
  const docPath = resolvePreviewDoc(opts.file, absDir);

  if (!docPath) {
    const what = opts.file ? `Preview document not found: ${opts.file}` : "Preview document not found.";
    throw new Error(
      `${what}\nExpected packages/web/src/preview/index.html (or dist/preview/index.html), ` +
      `or pass --file=<path.html>.`,
    );
  }

  const docDir = dirname(docPath);
  const reloadIntervalMs = opts.reloadIntervalMs ?? DEFAULT_RELOAD_INTERVAL_MS;
  const portFilePath = join(absDir, PREVIEW_PORT_FILE);

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const urlPath = (req.url ?? "/").split("?")[0];

    if (urlPath === "/__preview/state") {
      send(res, 200, JSON.stringify({ fingerprint: docFingerprint(docPath) }), MIME_TYPES[".json"]);
      return;
    }

    if (urlPath === "/" || urlPath === "/index.html") {
      try {
        const html = readFileSync(docPath, "utf-8");
        send(res, 200, withReloadSnippet(html, reloadIntervalMs), MIME_TYPES[".html"]);
      } catch (err) {
        send(res, 500, `Failed to read ${docPath}: ${(err as Error).message}`, "text/plain; charset=utf-8");
      }
      return;
    }

    const sibling = resolveSibling(docDir, urlPath);
    if (sibling) {
      try {
        send(res, 200, readFileSync(sibling), MIME_TYPES[extname(sibling).toLowerCase()] ?? "application/octet-stream");
      } catch (err) {
        send(res, 500, `Failed to read ${sibling}: ${(err as Error).message}`, "text/plain; charset=utf-8");
      }
      return;
    }

    send(res, 404, "Not found", "text/plain; charset=utf-8");
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, LOOPBACK_HOST, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  // Port 0 means "any free port" — the number to report, write to the port file
  // and print is the one the OS actually handed out, never the requested 0.
  const address = server.address();
  const boundPort = typeof address === "object" && address !== null ? address.port : port;

  await writeFile(portFilePath, String(boundPort) + "\n", "utf-8").catch(() => {});

  console.log(`n-dx UI preview running at http://localhost:${boundPort}`);
  console.log(`  Document: ${docPath}`);
  console.log(`  Edit that file and save — the browser reloads on its own.`);

  const close = async (): Promise<void> => {
    await new Promise<void>((done) => server.close(() => done()));
    await unlink(portFilePath).catch(() => {});
  };

  const onSignal = (signal: string): void => {
    console.log(`\n[preview] ${signal} received — shutting down`);
    void close().then(() => process.exit(0));
  };
  process.once("SIGINT", () => onSignal("SIGINT"));
  process.once("SIGTERM", () => onSignal("SIGTERM"));

  return { port: boundPort, docPath, close };
}
