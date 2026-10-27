/**
 * Extension discovery: find every installed `ndx.extension` package, decide
 * which copy of each wins, and cache the result in the n-dx home.
 *
 * Four sources, highest precedence first (docs/architecture/extensions.md):
 *
 * 1. `project` — the project's `node_modules`, for packages its `package.json` lists.
 * 2. `user`    — `<ndx home>/extensions/node_modules`, for packages
 *                `<ndx home>/extensions/package.json` lists.
 * 3. `global`  — the global `node_modules` n-dx itself was installed into.
 * 4. `dev`     — package directories listed in `extensions.paths` of
 *                `<ndx home>/config.json`; relative paths resolve against the home.
 *
 * ## Only `package.json` is read
 *
 * Discovery never imports, requires or spawns anything from a package: it reads
 * `package.json` files and stats directories. Everything an extension declares
 * is in its `ndx.extension` block, which `extension-manifest.js` validates.
 *
 * ## Precedence and conflicts
 *
 * The same package (by `package.json` name) in several sources: the highest
 * source wins and the others are listed in `shadowed`, for `ndx extensions
 * info`. Two different packages claiming one name — an extension name or a
 * command name — are both refused (`status: "conflict"`), each naming the other.
 *
 * ## The cache
 *
 * `<ndx home>/extensions.json` holds, under `discovery`, one entry per source
 * folder: the packages found there and the modification times of the paths that
 * change when that folder's contents do. A call stats those paths, and reads a
 * source again only when one has moved, so `ndx --help` does not walk
 * `node_modules` on every run. Other top-level keys of the file are preserved:
 * approvals are stored beside the cache. Validation is not cached — it depends
 * on the running n-dx's built-in commands and costs microseconds.
 *
 * Whether the running n-dx is inside a manifest's `ndxVersion` range is not
 * decided here; callers that list or run extensions apply it.
 *
 * @module n-dx/extension-discovery
 */

import * as nodeFs from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveNdxHome } from "./layout.js";
import { validateExtensionManifest } from "./extension-manifest.js";

/** Sources in precedence order, highest first. */
export const EXTENSION_SOURCES = Object.freeze(["project", "user", "global", "dev"]);

/** The cache file, under the n-dx home. */
export const EXTENSIONS_CACHE_FILE = "extensions.json";

/** Directory under the n-dx home that `ndx extensions add` installs into. */
export const USER_EXTENSIONS_DIRNAME = "extensions";

/** Bumped when the shape of a cached source entry changes; older entries are recomputed. */
const CACHE_VERSION = 1;

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"];

/**
 * @typedef {"project" | "user" | "global" | "dev"} ExtensionSource
 */

/**
 * A package seen by discovery, before validation.
 *
 * @typedef {object} FoundPackage
 * @property {string} packageName  `package.json` name, or the directory when it has none.
 * @property {string | undefined} version
 * @property {string} dir  The package directory.
 * @property {unknown} block  The raw `ndx.extension` block.
 */

/**
 * @typedef {object} ShadowedCopy
 * @property {ExtensionSource} source
 * @property {string} dir
 * @property {string | undefined} version
 */

/**
 * @typedef {object} ConflictingPackage
 * @property {string} packageName
 * @property {ExtensionSource} source
 * @property {string} dir
 * @property {string[]} names  The extension or command names both claim.
 */

/**
 * @typedef {object} DiscoveredExtension
 * @property {string | undefined} name  The manifest's `name` when it is a string.
 * @property {string} packageName
 * @property {string | undefined} version
 * @property {ExtensionSource} source
 * @property {string} dir
 * @property {"valid" | "invalid" | "incompatible" | "conflict"} status
 * @property {import("./extension-manifest.js").ExtensionManifest | undefined} manifest  Set when `status` is `valid`.
 * @property {import("./extension-manifest.js").ManifestProblem[]} problems
 * @property {ShadowedCopy[]} shadowed  Lower-precedence copies of the same package.
 * @property {ConflictingPackage[]} conflicts  Other packages claiming one of this one's names.
 */

/**
 * Something discovery could not read: an unreadable `package.json` in a dev
 * path, a config or cache file that is not JSON, a cache it could not write.
 *
 * @typedef {object} DiscoveryError
 * @property {string} path
 * @property {string} message
 */

/**
 * @typedef {object} DiscoveryResult
 * @property {DiscoveredExtension[]} extensions  One per package, winners only, in precedence order.
 * @property {DiscoveryError[]} errors
 * @property {string} home  The n-dx home used.
 */

/**
 * The file-system calls discovery makes; injectable so tests can count them.
 *
 * @typedef {Pick<typeof nodeFs, "statSync" | "readFileSync" | "readdirSync" | "writeFileSync" | "renameSync" | "mkdirSync">} DiscoveryFs
 */

/**
 * @typedef {object} DiscoverOptions
 * @property {Iterable<string>} builtinCommands  Every built-in `ndx` command and tool delegation.
 * @property {string} [projectDir]  Project whose `node_modules` is the `project` source; omit for none.
 * @property {string} [home]  The n-dx home; defaults to {@link resolveNdxHome}.
 * @property {Record<string, string | undefined>} [env]  Passed to {@link resolveNdxHome}.
 * @property {string} [userHome]  The OS home directory, passed to {@link resolveNdxHome}.
 * @property {string | null} [globalRoot]  The `global` source; defaults to {@link findGlobalRoot}; `null` for none.
 * @property {DiscoveryFs} [fs]
 */

/**
 * Discover installed extensions.
 *
 * @param {DiscoverOptions} options
 * @returns {DiscoveryResult}
 */
export function discoverExtensions(options) {
  if (!options || !options.builtinCommands) {
    throw new TypeError("discoverExtensions: options.builtinCommands is required");
  }
  const fs = options.fs ?? nodeFs;
  const home = options.home ?? resolveNdxHome({ env: options.env, home: options.userHome });
  const projectDir = options.projectDir ? resolve(options.projectDir) : undefined;
  const globalRoot = options.globalRoot === undefined ? findGlobalRoot() : options.globalRoot;

  /** @type {DiscoveryError[]} */
  const errors = [];
  const cachePath = join(home, EXTENSIONS_CACHE_FILE);
  const cacheFile = readJson(fs, cachePath, errors);
  const cache = isObject(cacheFile.value) ? cacheFile.value : {};
  const cached = isObject(cache.discovery) && cache.discovery.version === CACHE_VERSION && isObject(cache.discovery.sources)
    ? /** @type {Record<string, SourceEntry>} */ (cache.discovery.sources)
    : {};

  // When n-dx is installed in this project, the node_modules it sits in is the
  // project source, not a global one: scanning all of it would be wrong and slow.
  const globalIsProject = projectDir !== undefined && globalRoot !== null
    && samePath(globalRoot, join(projectDir, "node_modules"));

  /** @type {Array<{source: ExtensionSource, scan: SourceScan}>} */
  const scans = [];
  if (projectDir) scans.push({ source: "project", scan: listedScan(projectDir) });
  scans.push({ source: "user", scan: listedScan(join(home, USER_EXTENSIONS_DIRNAME)) });
  if (globalRoot && !globalIsProject) scans.push({ source: "global", scan: globalScan(globalRoot) });
  for (const path of devPaths(fs, home, errors)) scans.push({ source: "dev", scan: devScan(path) });

  /** @type {Record<string, SourceEntry>} */
  const nextSources = { ...cached };
  let changed = !isObject(cache.discovery) || cache.discovery.version !== CACHE_VERSION;
  /** @type {Array<{source: ExtensionSource, found: FoundPackage}>} */
  const found = [];
  for (const { source, scan } of scans) {
    const key = `${source}:${scan.dir}`;
    let entry = cached[key];
    if (!isFresh(fs, entry)) {
      entry = scan.read(fs);
      nextSources[key] = entry;
      changed = true;
    }
    for (const error of entry.errors) errors.push(error);
    for (const pkg of entry.packages) found.push({ source, found: pkg });
  }

  if (changed && cacheFile.ok) {
    writeCache(fs, cachePath, { ...cache, discovery: { version: CACHE_VERSION, sources: nextSources } }, errors);
  }

  return { extensions: resolveWinners(found, options.builtinCommands), errors, home };
}

/**
 * The global `node_modules` this n-dx was installed into, or `null` when it runs
 * from a checkout or from a project's own install. Covers npm
 * (`<prefix>/lib/node_modules/@n-dx/core`) and pnpm, whose real path runs
 * through `node_modules/.pnpm/…`.
 *
 * A `node_modules` with a `package.json` beside it is a project's, not a global
 * one: a repo that lists `@n-dx/core` as a dependency must not have every
 * package in its `node_modules` scanned as globally installed, where a user
 * approval could cover it. pnpm's global directory is the exception — it has a
 * `package.json` — and is recognised only under `$PNPM_HOME/global/`. A pnpm
 * global directory configured elsewhere yields no global source.
 *
 * @param {string} [coreDir]  `@n-dx/core`'s directory; defaults to this module's.
 * @param {{env?: Record<string, string | undefined>, fs?: Pick<typeof nodeFs, "statSync">}} [options]
 * @returns {string | null}
 */
export function findGlobalRoot(coreDir = dirname(fileURLToPath(import.meta.url)), { env = process.env, fs = nodeFs } = {}) {
  const parts = resolve(coreDir).split(sep);
  const pnpm = parts.lastIndexOf(".pnpm");
  const n = parts.length;
  let root = null;
  if (pnpm > 0 && parts[pnpm - 1] === "node_modules") root = parts.slice(0, pnpm).join(sep);
  else if (n >= 3 && parts[n - 2] === "@n-dx" && parts[n - 3] === "node_modules") root = parts.slice(0, n - 2).join(sep);
  if (root === null) return null;
  if (!fs.statSync(join(dirname(root), "package.json"), { throwIfNoEntry: false })) return root;
  const pnpmGlobal = env.PNPM_HOME ? resolve(env.PNPM_HOME, "global") : undefined;
  return pnpmGlobal && isInside(pnpmGlobal, root) ? root : null;
}

/**
 * Whether `path` is strictly below `dir`.
 *
 * @param {string} dir
 * @param {string} path
 */
function isInside(dir, path) {
  const rel = relative(dir, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

// ── sources ──────────────────────────────────────────────────────────────────

/**
 * A cached source: what was found, and the paths whose modification times
 * decide whether it is still current (`null` for a path that did not exist).
 * Each found package's own `package.json` is among them: a linked package
 * (`file:`, `link:`, a workspace, `ndx extensions add <folder>`) is a symlink,
 * and editing its target changes no folder a scan watches.
 *
 * @typedef {object} SourceEntry
 * @property {Array<[string, number | null]>} watch
 * @property {FoundPackage[]} packages
 * @property {DiscoveryError[]} errors
 */

/**
 * @typedef {object} SourceScan
 * @property {string} dir
 * @property {(fs: DiscoveryFs) => SourceEntry} read
 */

/**
 * A folder whose `package.json` lists the packages to look at in its
 * `node_modules` — the project, and the user extensions folder. Only listed
 * packages are read: a project's `node_modules` holds thousands of others, and
 * a transitive dependency must not become an extension by being hoisted.
 *
 * @param {string} dir
 * @returns {SourceScan}
 */
function listedScan(dir) {
  return {
    dir,
    read(fs) {
      const listing = join(dir, "package.json");
      const modules = join(dir, "node_modules");
      /** @type {DiscoveryError[]} */
      const errors = [];
      const manifest = readJson(fs, listing, errors).value;
      const names = new Set();
      if (isObject(manifest)) {
        for (const field of DEPENDENCY_FIELDS) {
          if (isObject(manifest[field])) for (const name of Object.keys(manifest[field])) names.add(name);
        }
      }
      const watched = new Set([listing, modules]);
      /** @type {FoundPackage[]} */
      const packages = [];
      for (const name of names) {
        if (name.startsWith("@")) watched.add(join(modules, name.split("/")[0]));
        const pkg = readPackage(fs, join(modules, ...name.split("/")), null);
        if (pkg) packages.push(pkg);
      }
      for (const pkg of packages) watched.add(join(pkg.dir, "package.json"));
      return { watch: stamp(fs, watched), packages, errors };
    },
  };
}

/**
 * The global `node_modules`: every top-level package, scoped or not.
 *
 * @param {string} dir
 * @returns {SourceScan}
 */
function globalScan(dir) {
  return {
    dir,
    read(fs) {
      const watched = new Set([dir]);
      /** @type {FoundPackage[]} */
      const packages = [];
      for (const entry of listDir(fs, dir)) {
        if (entry.startsWith(".")) continue;
        const path = join(dir, entry);
        const children = entry.startsWith("@") ? listDir(fs, path).map((child) => join(path, child)) : [path];
        if (entry.startsWith("@")) watched.add(path);
        for (const child of children) {
          const pkg = readPackage(fs, child, null);
          if (pkg) packages.push(pkg);
        }
      }
      for (const pkg of packages) watched.add(join(pkg.dir, "package.json"));
      return { watch: stamp(fs, watched), packages, errors: [] };
    },
  };
}

/**
 * One package checkout named in `extensions.paths`. Unlike the scanned sources,
 * a path someone listed by hand that cannot be read is reported.
 *
 * @param {string} dir
 * @returns {SourceScan}
 */
function devScan(dir) {
  return {
    dir,
    read(fs) {
      /** @type {DiscoveryError[]} */
      const errors = [];
      const pkg = readPackage(fs, dir, errors);
      if (!pkg && errors.length === 0) {
        errors.push({ path: join(dir, "package.json"), message: "listed in extensions.paths but declares no ndx.extension block" });
      }
      return { watch: stamp(fs, [join(dir, "package.json")]), packages: pkg ? [pkg] : [], errors };
    },
  };
}

/**
 * `extensions.paths` from `<home>/config.json`, absolute.
 *
 * @param {DiscoveryFs} fs
 * @param {string} home
 * @param {DiscoveryError[]} errors
 * @returns {string[]}
 */
function devPaths(fs, home, errors) {
  const configPath = join(home, "config.json");
  const config = readJson(fs, configPath, errors).value;
  const paths = isObject(config) && isObject(config.extensions) ? config.extensions.paths : undefined;
  if (paths === undefined) return [];
  if (!Array.isArray(paths) || !paths.every((p) => typeof p === "string" && p !== "")) {
    errors.push({ path: configPath, message: "extensions.paths must be an array of directory paths" });
    return [];
  }
  return [...new Set(paths.map((p) => (isAbsolute(p) ? p : resolve(home, p))))];
}

/**
 * The package at `dir` when its `package.json` has an `ndx.extension` key.
 * `errors` is `null` for scanned sources, where a missing or unreadable
 * `package.json` just means the directory is not an extension.
 *
 * @param {DiscoveryFs} fs
 * @param {string} dir
 * @param {DiscoveryError[] | null} errors
 * @returns {FoundPackage | null}
 */
function readPackage(fs, dir, errors) {
  const { value } = readJson(fs, join(dir, "package.json"), errors, errors !== null);
  if (!isObject(value) || !isObject(value.ndx) || !("extension" in value.ndx)) return null;
  return {
    packageName: typeof value.name === "string" && value.name ? value.name : dir,
    version: typeof value.version === "string" ? value.version : undefined,
    dir,
    block: value.ndx.extension,
  };
}

// ── precedence and conflicts ─────────────────────────────────────────────────

/**
 * @param {Array<{source: ExtensionSource, found: FoundPackage}>} found  In precedence order.
 * @param {Iterable<string>} builtinCommands
 * @returns {DiscoveredExtension[]}
 */
function resolveWinners(found, builtinCommands) {
  /** @type {Map<string, DiscoveredExtension>} */
  const winners = new Map();
  for (const { source, found: pkg } of found) {
    const winner = winners.get(pkg.packageName);
    if (winner) {
      if (!samePath(winner.dir, pkg.dir)) winner.shadowed.push({ source, dir: pkg.dir, version: pkg.version });
      continue;
    }
    const validation = validateExtensionManifest({ name: pkg.packageName, ndx: { extension: pkg.block } }, { builtinCommands });
    winners.set(pkg.packageName, {
      name: validation.name,
      packageName: pkg.packageName,
      version: pkg.version,
      source,
      dir: pkg.dir,
      status: validation.status,
      manifest: validation.manifest,
      problems: validation.problems,
      shadowed: [],
      conflicts: [],
    });
  }

  // Every name a runnable extension claims: its own, and each command's.
  /** @type {Map<string, DiscoveredExtension[]>} */
  const claims = new Map();
  for (const ext of winners.values()) {
    if (ext.status !== "valid" || !ext.manifest) continue;
    const names = new Set([ext.manifest.name, ...(ext.manifest.commands ?? []).map((c) => c.name)]);
    for (const name of names) claims.set(name, [...(claims.get(name) ?? []), ext]);
  }
  for (const [name, claimants] of claims) {
    if (claimants.length < 2) continue;
    for (const ext of claimants) {
      ext.status = "conflict";
      for (const other of claimants) {
        if (other === ext) continue;
        const existing = ext.conflicts.find((c) => c.packageName === other.packageName);
        if (existing) existing.names.push(name);
        else ext.conflicts.push({ packageName: other.packageName, source: other.source, dir: other.dir, names: [name] });
      }
    }
  }
  return [...winners.values()];
}

// ── cache and file helpers ───────────────────────────────────────────────────

/**
 * @param {DiscoveryFs} fs
 * @param {SourceEntry | undefined} entry
 */
function isFresh(fs, entry) {
  if (!isObject(entry) || !Array.isArray(entry.watch) || !Array.isArray(entry.packages) || !Array.isArray(entry.errors)) return false;
  return entry.watch.every(([path, mtime]) => mtimeOf(fs, path) === mtime);
}

/**
 * @param {DiscoveryFs} fs
 * @param {Iterable<string>} paths
 * @returns {Array<[string, number | null]>}
 */
function stamp(fs, paths) {
  return [...paths].map((path) => [path, mtimeOf(fs, path)]);
}

/**
 * @param {DiscoveryFs} fs
 * @param {string} path
 * @returns {number | null}
 */
function mtimeOf(fs, path) {
  return fs.statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? null;
}

/**
 * @param {DiscoveryFs} fs
 * @param {string} dir
 * @returns {string[]}
 */
function listDir(fs, dir) {
  try {
    return fs.readdirSync(dir);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT" || /** @type {NodeJS.ErrnoException} */ (error).code === "ENOTDIR") return [];
    throw error;
  }
}

/**
 * Parse a JSON file. A missing file is `{ok: true, value: undefined}`; one that
 * cannot be read or parsed is `{ok: false}` and, when `report` is set, an error.
 *
 * @param {DiscoveryFs} fs
 * @param {string} path
 * @param {DiscoveryError[] | null} errors
 * @param {boolean} [report]
 * @returns {{ok: boolean, value: unknown}}
 */
function readJson(fs, path, errors, report = true) {
  let text;
  try {
    text = fs.readFileSync(path, "utf8");
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { ok: true, value: undefined };
    if (report && errors) errors.push({ path, message: `cannot be read: ${/** @type {Error} */ (error).message}` });
    return { ok: false, value: undefined };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    if (report && errors) errors.push({ path, message: `is not valid JSON: ${/** @type {Error} */ (error).message}` });
    return { ok: false, value: undefined };
  }
}

/**
 * Write the cache through a temporary file and a rename, so a reader never
 * sees half of it. A failure is reported, not thrown: the cache only saves
 * work, and discovery's result is already complete.
 *
 * @param {DiscoveryFs} fs
 * @param {string} path
 * @param {unknown} value
 * @param {DiscoveryError[]} errors
 */
function writeCache(fs, path, value, errors) {
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(dirname(path), { recursive: true });
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(tmp, path);
  } catch (error) {
    errors.push({ path, message: `cache not written: ${/** @type {Error} */ (error).message}` });
  }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {string} a
 * @param {string} b
 */
function samePath(a, b) {
  const norm = (/** @type {string} */ p) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));
  return norm(a) === norm(b);
}
