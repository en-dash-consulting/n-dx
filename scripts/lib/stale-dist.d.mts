/**
 * Types for scripts/lib/stale-dist.mjs, which TypeScript callers import.
 * The web package typechecks its tests (tsconfig.test.json) and its build guard
 * uses the same content-based freshness check as the root gates, so the module
 * needs a declaration; the implementation stays plain JS so the root scripts and
 * JS tests can import it too.
 */

/** Source extensions that a build turns into dist/ output. */
export const SOURCE_EXTENSIONS: RegExp;

/** File name of the stamp inside a package's dist/. */
export const BUILD_STAMP_FILE: string;

/** Hash of every compiled source file's path and content under `srcDir`. */
export function sourceHash(srcDir: string): string;

/** Record that `distDir` was fully built from the current content of `srcDir`. */
export function writeBuildStamp(srcDir: string, distDir: string): void;

/**
 * Whether `distDir` is a build of the current `srcDir`: false when the stamp is
 * missing, unreadable, or records different source content.
 */
export function isBuildCurrent(srcDir: string, distDir: string): boolean;

export interface PackageManifest {
  /** Directory name under packages/. */
  dir: string;
  /** Scoped package name. */
  name: string;
}

/**
 * Packages the change edited under `src/` whose `dist/` is not a full build of
 * the current source.
 */
export function staleChangedPackages(
  root: string,
  changedFiles: string[],
  manifests: PackageManifest[],
): PackageManifest[];

/** The gate's failure message: names each package and the command that fixes it. */
export function staleDistMessage(stale: PackageManifest[]): string;
