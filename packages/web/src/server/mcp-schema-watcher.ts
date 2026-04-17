/**
 * MCP schema hot-reload watcher.
 *
 * Watches the `dist/` directories of the `@n-dx/rex` and `@n-dx/sourcevision`
 * packages. When a `.js` file changes (i.e. after a `pnpm build` in either
 * package), the corresponding MCP server factory is replaced with a
 * subprocess-backed proxy via {@link createSubprocessMcpProxy}.
 *
 * Existing MCP sessions are unaffected — they continue serving requests with
 * the McpServer instance they were initialised with. Only new sessions (POST
 * without an `Mcp-Session-Id` header) will use the updated factory, and
 * therefore serve the freshly compiled tool schemas.
 *
 * @see mcp-subprocess-proxy.ts  — proxy implementation
 * @see routes-mcp.ts            — reloadMcpFactories injection point
 */

import { watch, existsSync, type FSWatcher } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { reloadMcpFactories, type McpRouteFactories } from "./routes-mcp.js";
import { createSubprocessMcpProxy } from "./mcp-subprocess-proxy.js";
import type { ServerContext } from "./types.js";

const DEBOUNCE_MS = 500;

function debounce<T extends (...args: unknown[]) => void>(fn: T, delayMs: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: unknown[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, delayMs);
  }) as T;
}

/**
 * Resolve the root directory of a package from its main entry point path.
 *
 * For `@n-dx/rex` the main entry is `.../dist/public.js`; the package root
 * is two levels up from there (`.../dist/` then package root).
 *
 * @returns Absolute path to the package root, or `null` if unresolvable.
 */
function resolvePackageRoot(pkg: string): string | null {
  try {
    const req = createRequire(import.meta.url);
    const mainEntry = req.resolve(pkg);
    // mainEntry = /…/dist/public.js → /…/dist → /… (pkg root)
    return dirname(dirname(mainEntry));
  } catch {
    return null;
  }
}

/**
 * Register a file-system watcher on the `dist/` directory of `pkg`.
 * When a `.js` file changes (with debounce), calls `onRebuild`.
 *
 * Tries `{ recursive: true }` first (works on macOS / Windows).
 * Falls back to a non-recursive watch on the dist root if recursive mode
 * is not supported by the OS.
 *
 * @returns The created `FSWatcher`, or `null` if the dist directory
 *          does not exist or `fs.watch` is unavailable.
 */
function watchDistDir(distDir: string, onRebuild: () => void): FSWatcher | null {
  const debounced = debounce(onRebuild, DEBOUNCE_MS);
  const handler = (_event: unknown, filename: unknown): void => {
    if (typeof filename === "string" && filename.endsWith(".js")) debounced();
  };
  try {
    return watch(distDir, { recursive: true }, handler);
  } catch {
    // recursive not supported (Linux) — watch the dist root only
    try {
      return watch(distDir, handler);
    } catch {
      return null;
    }
  }
}

/**
 * Start watching the `dist/` directories of `@n-dx/rex` and
 * `@n-dx/sourcevision` for changes.
 *
 * When a change is detected the corresponding entry in `configuredFactories`
 * (managed by {@link routes-mcp.ts}) is replaced with a subprocess-backed
 * factory that spawns a fresh process for each new session.  This ensures
 * new sessions load the latest compiled tool schemas without restarting the
 * web server.
 *
 * @returns An array of `FSWatcher` instances to be closed on server shutdown.
 */
export function startMcpSchemaWatcher(): FSWatcher[] {
  const watchers: FSWatcher[] = [];

  type WatchTarget = {
    pkg: string;
    key: keyof McpRouteFactories;
    cliRelPath: string[];
  };

  const targets: WatchTarget[] = [
    { pkg: "@n-dx/rex",          key: "rex", cliRelPath: ["dist", "cli", "index.js"] },
    { pkg: "@n-dx/sourcevision", key: "sv",  cliRelPath: ["dist", "cli", "index.js"] },
  ];

  for (const { pkg, key, cliRelPath } of targets) {
    const pkgRoot = resolvePackageRoot(pkg);
    if (!pkgRoot) continue;

    const distDir = join(pkgRoot, "dist");
    if (!existsSync(distDir)) continue;

    const cliPath = join(pkgRoot, ...cliRelPath);

    const onRebuild = (): void => {
      reloadMcpFactories({
        [key]: (ctx: ServerContext) => createSubprocessMcpProxy(cliPath, ctx.projectDir),
      });
      console.log(`[mcp-schema-watcher] ${pkg} rebuilt — new sessions will use updated schemas`);
    };

    const w = watchDistDir(distDir, onRebuild);
    if (w) watchers.push(w);
  }

  return watchers;
}
