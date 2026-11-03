/**
 * The n-dx CLIs this server spawns, resolved from this server's own install.
 *
 * Every rung names something the operator installed: the launching CLI's own
 * path (`NDX_CLI_PATH` / `N_DX_CLI_PATH`, which `ndx start` sets for its
 * children), this server's module graph, the sibling packages beside this
 * server's own package root, and finally the bare name on `PATH`. Nothing is
 * looked up under the analyzed project — not its `node_modules/.bin`, not a
 * `packages/<pkg>` directory inside it — because the dashboard serves
 * repositories that are not this install, and what a repository ships is not
 * the operator's choice of binary.
 *
 * The CLI subpath is resolved directly (e.g. `@n-dx/rex/dist/cli/index.js`):
 * these packages' `exports["."]` only define an `import` condition, so a bare
 * CJS `require.resolve("@n-dx/rex")` throws ERR_PACKAGE_PATH_NOT_EXPORTED.
 * The subpath matches the `"./dist/*"` export and resolves under CJS.
 *
 * @module web/server/own-cli
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** How to spawn a CLI: the executable and the arguments that precede the command's own. */
export interface CliInvocation {
  bin: string;
  args: string[];
}

let packageRoot: string | null | undefined;

/**
 * The directory holding this server's own `package.json` (`@n-dx/web`), found
 * by walking up from this module — `src/server/` under tests, `dist/server/`
 * when built. Null when no such directory exists (a bundled copy).
 */
export function serverPackageRoot(): string | null {
  if (packageRoot !== undefined) return packageRoot;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      try {
        if ((JSON.parse(readFileSync(manifest, "utf-8")) as { name?: unknown }).name === "@n-dx/web") {
          return (packageRoot = dir);
        }
      } catch {
        /* not ours; keep walking */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return (packageRoot = null);
    dir = parent;
  }
}

/**
 * A file in a package installed beside this server — `packages/<dir>/` in the
 * monorepo, `node_modules/@n-dx/<dir>/` in an npm or pnpm install — or null.
 */
function siblingPackageFile(dir: string, ...rel: string[]): string | null {
  const root = serverPackageRoot();
  if (!root) return null;
  const file = resolve(root, "..", dir, ...rel);
  return existsSync(file) ? file : null;
}

function resolveFromModuleGraph(specifier: string): string | null {
  try {
    const file = createRequire(import.meta.url).resolve(specifier);
    return existsSync(file) ? file : null;
  } catch {
    return null;
  }
}

/**
 * A domain CLI (`@n-dx/rex`, `@n-dx/sourcevision`, `@n-dx/hench`): this
 * server's module graph, then the sibling package, then `binName` on `PATH`.
 */
export function resolveOwnPackageCli(pkg: string, dir: string, binName: string): CliInvocation {
  const cli =
    resolveFromModuleGraph(`${pkg}/dist/cli/index.js`) ??
    siblingPackageFile(dir, "dist", "cli", "index.js");
  return cli ? { bin: "node", args: [cli] } : { bin: binName, args: [] };
}

/**
 * The `ndx` orchestrator. Ladder:
 *
 *  1. `NDX_CLI_PATH` — the launching CLI's own path.
 *  2. `N_DX_CLI_PATH` — the same path under its older name.
 *  3. `@n-dx/core/cli.js` from this server's module graph. Often absent by
 *     design: web cannot depend on core (core depends on web), so strict
 *     pnpm layouts do not resolve it.
 *  4. `core/cli.js` beside this server's package root.
 *  5. `ndx` on `PATH`.
 *
 * `cli.js` assigns both env names to its own path on startup, so a server
 * started by `ndx start` knows the running install's cli.js whatever the
 * layout. Both are guarded on `existsSync`: the value is exported to every
 * child of an `ndx` process and outlives the install that wrote it.
 */
export function resolveOwnNdxCli(): CliInvocation {
  for (const name of ["NDX_CLI_PATH", "N_DX_CLI_PATH"]) {
    const path = process.env[name];
    if (path && existsSync(path)) return { bin: "node", args: [path] };
  }
  const cli = resolveFromModuleGraph("@n-dx/core/cli.js") ?? siblingPackageFile("core", "cli.js");
  return cli ? { bin: "node", args: [cli] } : { bin: "ndx", args: [] };
}
