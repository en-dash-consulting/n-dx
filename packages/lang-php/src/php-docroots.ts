/**
 * Where a PHP application's entry scripts and document roots are, from its
 * file list alone (project-relative, forward-slash paths). Shared by include
 * resolution (`php-includes.ts`: the working directory) and the docroot
 * routes (`php-docroot.ts`).
 *
 * @module lang-php/php-docroots
 */

import { PHP_DOCROOT_DIRECTORIES } from "@n-dx/lang-kit";

/** The directory of a project-relative path; `""` at the root. */
export const dirOf = (path: string): string => {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
};

const baseOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/** `path` is `dir` or below it; everything is below the root (`""`). */
export const isWithin = (path: string, dir: string): boolean => dir === "" || path === dir || path.startsWith(`${dir}/`);

/** Directories holding an `index.php`: entry-script directories. */
export function entryDirectories(files: Iterable<string>): Set<string> {
  const dirs = new Set<string>();
  for (const f of files) if (baseOf(f) === "index.php") dirs.add(dirOf(f));
  return dirs;
}

/**
 * The docroot include resolution falls back to: the first of
 * {@link PHP_DOCROOT_DIRECTORIES} at the repository root holding an
 * `index.php`, else the root.
 */
export function primaryDocroot(files: ReadonlySet<string>): string {
  return PHP_DOCROOT_DIRECTORIES.find((d) => files.has(`${d}/index.php`)) ?? "";
}

/**
 * Every document root, sorted: each directory named as one of
 * {@link PHP_DOCROOT_DIRECTORIES} that holds an `index.php`, at any depth
 * (one per application directory) and not inside another; else the
 * repository root (`""`) when it holds `index.php`; else none.
 */
export function phpDocroots(files: Iterable<string>): string[] {
  const named = [...entryDirectories(files)]
    .filter((dir) => dir !== "" && PHP_DOCROOT_DIRECTORIES.includes(baseOf(dir)))
    .sort();
  const roots = named.filter((dir) => !named.some((outer) => outer !== dir && isWithin(dir, outer)));
  if (roots.length > 0) return roots;
  return entryDirectories(files).has("") ? [""] : [];
}
