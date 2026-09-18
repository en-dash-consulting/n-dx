/**
 * Preview server — serves a standalone HTML layout document with live reload.
 *
 * `ndx start --preview` runs this instead of the real dashboard. It is a design
 * surface, not a second dashboard: a single static HTML document is read from
 * disk on every request and served with a small polling snippet appended, so
 * editing the file and hitting save is immediately visible in the browser.
 *
 * The document is also an editor: it renders its structure from a sibling
 * layout file (`<doc>.layout.json`) and saves the file back over
 * `POST /__preview/layout`, so a shuffle survives a reload and can be reviewed
 * as a diff. That is the *only* thing this process ever writes besides its own
 * port file — see {@link layoutPathFor}, and note it is confined to the
 * document's own directory.
 *
 * Deliberately minimal otherwise — no PRD watchers, no MCP endpoints, no hench
 * process supervision, no writes to `.rex/` or `.sourcevision/`. That is what
 * makes it safe to run alongside `ndx start` on a second port.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { writeFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Default port for the preview server — one above the dashboard's 3117. */
export const DEFAULT_PREVIEW_PORT = 3118;

/** Port file written by the preview process, kept distinct from `.n-dx-web.port`. */
export const PREVIEW_PORT_FILE = ".n-dx-preview.port";

const LOOPBACK_HOST = "127.0.0.1";

/** How often the browser asks whether the document changed on disk. */
const DEFAULT_RELOAD_INTERVAL_MS = 600;

/** The endpoint the reload poller reads — also the marker for "this document polls for itself". */
const STATE_ROUTE = "/__preview/state";

/**
 * Cap on a layout save.
 *
 * The layout is a few hundred nav nodes of text; a megabyte is already two
 * orders of magnitude more than a real one. The cap exists so a runaway page
 * script cannot fill the disk through an endpoint that exists for convenience.
 */
const MAX_LAYOUT_BYTES = 1_000_000;

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

/**
 * Where the served document keeps its structure.
 *
 * `index.html` → `index.layout.json`, next to it. Derived from the document
 * rather than fixed so `--file=proposal-b.html` gets its own layout instead of
 * silently sharing one with every other mock-up in the directory.
 */
export function layoutPathFor(docPath: string): string {
  const dir = dirname(docPath);
  const stem = basename(docPath, extname(docPath));
  return join(dir, `${stem}.layout.json`);
}

/** mtime+size of one file, or "missing". */
function stamp(path: string): string {
  try {
    const stat = statSync(path);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return "missing";
  }
}

/**
 * Fingerprint used by the reload poller.
 *
 * Covers the layout file as well as the document, so hand-editing the JSON
 * reloads the page too. The page's own saves would otherwise reload it on top
 * of the editing session, so `POST /__preview/layout` returns the fingerprint
 * it just produced and the page adopts it as the new baseline.
 */
function docFingerprint(docPath: string): string {
  return `${stamp(docPath)}${siblingPagesStamp(docPath)}|${stamp(layoutPathFor(docPath))}`;
}

/**
 * Stamps of the other HTML pages beside the document, so editing a sibling
 * demo page reloads a browser that has it open. Folded into the "document"
 * half of the fingerprint: to the main page a sibling change looks like a code
 * change, and a reload there is harmless — it only happens while someone is
 * actively editing that sibling.
 */
function siblingPagesStamp(docPath: string): string {
  try {
    const dir = dirname(docPath);
    const self = basename(docPath);
    return readdirSync(dir)
      .filter((name) => name !== self && name.toLowerCase().endsWith(".html"))
      .sort()
      .map((name) => `+${stamp(join(dir, name))}`)
      .join("");
  } catch {
    return "";
  }
}

/** The polling reload snippet injected into the served document. */
function reloadSnippet(intervalMs: number): string {
  return `<script>
(function () {
  var current = null;
  function poll() {
    fetch("${STATE_ROUTE}", { cache: "no-store" })
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

/**
 * Append the reload snippet, preferring just before `</body>`.
 *
 * A document that already polls `/__preview/state` is left alone: the shipped
 * layout document watches that endpoint itself so it can tell a layout change
 * (swap the model in place, keeping scroll and selection) from a change to its
 * own code (a real reload). Injecting a second, dumber poller alongside it
 * reloaded the page for every layout save and undid exactly that.
 */
function withReloadSnippet(html: string, intervalMs: number): string {
  if (html.includes(STATE_ROUTE)) return html;
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

/**
 * Read a request body, refusing anything over `limit`.
 *
 * Destroys the socket on overflow rather than draining it: the only client is
 * this project's own preview page, and a body that large is a bug on its side.
 */
function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        req.destroy();
        rejectBody(new Error(`Layout exceeds ${limit} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", rejectBody);
  });
}

/** Write via a temp file in the same directory, then rename — never a torn layout on disk. */
async function writeAtomic(path: string, contents: string): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, contents, "utf-8");
  await rename(tmp, path);
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

  const layoutPath = layoutPathFor(docPath);

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const urlPath = (req.url ?? "/").split("?")[0];

    if (urlPath === STATE_ROUTE) {
      send(res, 200, JSON.stringify({ fingerprint: docFingerprint(docPath) }), MIME_TYPES[".json"]);
      return;
    }

    if (urlPath === "/__preview/layout") {
      if (req.method === "GET") {
        if (!existsSync(layoutPath)) {
          // Not an error: a fresh document has no saved shuffle yet, and the
          // page falls back to the inventory it ships with.
          send(res, 404, JSON.stringify({ error: "no layout saved yet" }), MIME_TYPES[".json"]);
          return;
        }
        try {
          send(res, 200, readFileSync(layoutPath, "utf-8"), MIME_TYPES[".json"]);
        } catch (err) {
          send(res, 500, JSON.stringify({ error: (err as Error).message }), MIME_TYPES[".json"]);
        }
        return;
      }

      if (req.method === "POST" || req.method === "PUT") {
        void readBody(req, MAX_LAYOUT_BYTES)
          .then(async (body) => {
            // Parse before writing: a layout file that is not JSON would break
            // the page on its next load, with no way back except the shell.
            const parsed: unknown = JSON.parse(body);
            await writeAtomic(layoutPath, JSON.stringify(parsed, null, 2) + "\n");
            send(
              res,
              200,
              JSON.stringify({ ok: true, path: layoutPath, fingerprint: docFingerprint(docPath) }),
              MIME_TYPES[".json"],
            );
          })
          .catch((err: Error) => {
            send(res, 400, JSON.stringify({ error: err.message }), MIME_TYPES[".json"]);
          });
        return;
      }

      send(res, 405, JSON.stringify({ error: `${req.method} not allowed` }), MIME_TYPES[".json"]);
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
        // A sibling HTML page (a second mock-up, a filled-in demo of the same
        // layout) gets the same live reload as the main document, so iterating
        // on it works the same way. Non-HTML assets are served as-is.
        if (extname(sibling).toLowerCase() === ".html") {
          send(res, 200, withReloadSnippet(readFileSync(sibling, "utf-8"), reloadIntervalMs), MIME_TYPES[".html"]);
          return;
        }
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
  console.log(`  Layout:   ${layoutPath}`);
  console.log(`  Shuffle in the browser (saves to the layout file), or edit either file directly.`);

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
