/**
 * Which build of a package is on disk, and whether it is a build of the source
 * beside it.
 *
 * A full build writes `dist/.build-stamp.json` as its last step, holding a hash
 * of the source it compiled (scripts/write-build-stamp.mjs). The hash is
 * defined here, once: the root test gates read it through
 * scripts/lib/stale-dist.mjs, and `ndx start` reads it to tell whether the
 * `dist/` it is about to spawn — or that a running hub was spawned from — is a
 * build of the current source.
 *
 * Only a source-linked install has both halves. A published package ships
 * `dist/` without `src/` and without the stamp (`files` excludes it), so there
 * is nothing to compare and nothing to warn about.
 *
 * Node builtins only: core is plain JS run from source, and this module ships
 * with it.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

/** Source extensions that a build turns into dist/ output. */
export const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|mts|cts)$/;

/** File name of the stamp inside a package's dist/. */
export const BUILD_STAMP_FILE = ".build-stamp.json";

/**
 * Source files under `dir` that a build compiles, as sorted absolute paths.
 * Skips node_modules and nested dist so vendored or generated files never
 * masquerade as sources.
 */
function sourceFiles(dir) {
  const out = [];
  const walk = (current) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (SOURCE_EXTENSIONS.test(entry.name)) out.push(full);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

/** Hash of every compiled source file's path and content under `srcDir`. */
export function sourceHash(srcDir) {
  const hash = createHash("sha256");
  for (const file of sourceFiles(srcDir)) {
    hash.update(relative(srcDir, file).split(sep).join("/"));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** The source hash `distDir`'s stamp records, or null when there is no readable stamp. */
export function readStampHash(distDir) {
  try {
    const stamp = JSON.parse(readFileSync(join(distDir, BUILD_STAMP_FILE), "utf8"));
    return typeof stamp?.sourceHash === "string" ? stamp.sourceHash : null;
  } catch {
    return null;
  }
}

/**
 * Whether `distDir` is a build of the current `srcDir`: false when the stamp is
 * missing, unreadable, or records different source content — and when the
 * source cannot be hashed (a file removed mid-walk, a dangling symlink), which
 * a gate must read as "rebuild", never as a crash.
 */
export function isBuildCurrent(srcDir, distDir) {
  const stamped = readStampHash(distDir);
  if (stamped === null) return false;
  try {
    return stamped === sourceHash(srcDir);
  } catch {
    return false;
  }
}

/**
 * The newest modification time of any file under `dir` whose name `accept`
 * admits, in ms, or 0 when there is none. Skips node_modules. Unreadable
 * entries are skipped rather than thrown.
 *
 * @param {string} dir
 * @param {(name: string) => boolean} accept
 * @returns {number}
 */
function newestMtime(dir, accept) {
  let newest = 0;
  const walk = (current) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules") continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (accept(entry.name)) {
        try {
          newest = Math.max(newest, statSync(full).mtimeMs);
        } catch {
          // Removed mid-walk: it no longer counts.
        }
      }
    }
  };
  walk(dir);
  return newest;
}

/**
 * The nearest directory at or above `start` holding a package.json, or null.
 *
 * @param {string} start
 * @returns {string | null}
 */
export function packageRootOf(start) {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * @typedef {object} PackageBuildIdentity
 * @property {string | null} packageDir   The package's root, or null when none was found.
 * @property {string | null} name         Its package name.
 * @property {string | null} version      Its package version.
 * @property {string | null} sourceHash   What its dist/ stamp records; null without a stamp (a published install).
 * @property {boolean} sourceLinked       Whether src/ sits beside dist/ — a checkout, not a published package.
 * @property {boolean | null} current     For a source-linked install, whether dist/ is a build of src/; null otherwise,
 *                                        and null when the source could not be hashed.
 * @property {boolean | null} lagging     For a source-linked install whose stamp does not match, whether dist/ was
 *                                        last written before the newest source edit — see {@link packageBuildIdentity}.
 */

/**
 * The build identity of the package that owns `entry` (a file inside it, such
 * as its CLI under dist/). A missing or unreadable package yields nulls, never
 * a throw: this feeds warnings, and a warning must not stop `ndx start`.
 *
 * Hashing the source is only done for a source-linked install, the one case
 * where dist/ can lag the source it sits beside.
 *
 * `current` is the stamp's strict answer, the one the test gates use: only a
 * full build writes the stamp. `lagging` is the softer answer a user-facing
 * warning wants. A watch build (`pnpm dev` runs `tsc --watch`) keeps dist/
 * current without ever writing the stamp, so it reads as not current; but it
 * rewrites dist/ after each source edit, so dist/ is not older than the
 * source. A dist/ last written before the newest source edit is lagging.
 *
 * @param {string} entry
 * @returns {PackageBuildIdentity}
 */
export function packageBuildIdentity(entry) {
  const packageDir = packageRootOf(dirname(entry));
  if (!packageDir) return { packageDir: null, name: null, version: null, sourceHash: null, sourceLinked: false, current: null, lagging: null };
  let name = null;
  let version = null;
  try {
    const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
    name = typeof pkg.name === "string" ? pkg.name : null;
    version = typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    // Unreadable manifest: report what can be read.
  }
  const srcDir = join(packageDir, "src");
  const distDir = join(packageDir, "dist");
  const stamped = readStampHash(distDir);
  const sourceLinked = existsSync(srcDir) && existsSync(distDir);
  let current = null;
  if (sourceLinked) {
    try {
      current = stamped !== null && stamped === sourceHash(srcDir);
    } catch {
      // A source file removed mid-walk, or a dangling symlink: unknown, not stale.
      current = null;
    }
  }
  const lagging = current === false
    ? newestMtime(distDir, (n) => n !== BUILD_STAMP_FILE) < newestMtime(srcDir, (n) => SOURCE_EXTENSIONS.test(n))
    : null;
  return { packageDir, name, version, sourceHash: stamped, sourceLinked, current, lagging };
}
