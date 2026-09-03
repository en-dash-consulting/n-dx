/**
 * Hench's own runtime artifacts — paths hench writes as a side effect of
 * running, as distinct from operator-authored content.
 *
 * Two consumers must agree on this list:
 * - `hench init` gitignores these paths (`cli/commands/init.ts`)
 * - the pre-run git gate discounts them (`agent/lifecycle/shared.ts`)
 *
 * Both are needed. Gitignoring keeps the paths out of `git status` on a
 * freshly initialized project; the discount is what makes the gate correct on
 * a project initialized before those entries existed, on one whose
 * `.gitignore` the operator has since edited, and on one that is not using
 * `hench init` at all.
 *
 * Without the discount, `.hench/locks/` — created at process startup, before
 * the gate fires — reads back as one untracked path, and an autonomous run
 * refuses to start with "1 uncommitted file(s), 0 line(s) changed in the
 * working tree": blocked by a lock it created itself. The lock is removed on
 * exit, so the tree looks clean to anyone who checks afterwards and the
 * message reads as unreproducible.
 *
 * Deliberately narrow. `.hench/config.json` is operator-authored and is
 * expected to be tracked, so `.hench/` as a whole is *not* discounted — only
 * the per-run and per-session output directories below.
 *
 * @module hench/store/artifacts
 */

/**
 * `.gitignore` lines written by `hench init` covering hench's runtime output.
 *
 * Directory entries carry a trailing slash (git's own convention for
 * "directory only"); {@link isHenchRuntimeArtifact} relies on that shape to
 * tell the two kinds apart.
 */
export const HENCH_RUNTIME_GITIGNORE_ENTRIES: readonly string[] = [
  ".hench/runs/",
  ".hench/locks/",
  ".hench/usage-cursors/",
  ".hench-commit-msg.txt",
];

const RUNTIME_DIRS = HENCH_RUNTIME_GITIGNORE_ENTRIES.filter((e) => e.endsWith("/"));
const RUNTIME_FILES = HENCH_RUNTIME_GITIGNORE_ENTRIES.filter((e) => !e.endsWith("/"));

/**
 * True when `path` is one of hench's own runtime artifacts.
 *
 * Matches the artifact directories themselves (with or without a trailing
 * slash — `git status --porcelain` collapses a wholly untracked directory to
 * `?? .hench/locks/`, but reports individual files once any sibling is
 * tracked) and anything beneath them.
 *
 * @param path Repository-relative path, as reported by git.
 */
export function isHenchRuntimeArtifact(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  if (RUNTIME_FILES.includes(normalized)) return true;
  return RUNTIME_DIRS.some(
    (dir) => normalized === dir || normalized === dir.slice(0, -1) || normalized.startsWith(dir),
  );
}

/**
 * Extract the working-tree path from one `git status --porcelain` line.
 *
 * Porcelain v1 format is two status characters, a space, then the path.
 * Rename and copy entries (status `R`/`C`) carry `old -> new`; the second
 * half is the path that exists on disk. Paths containing spaces or other
 * special characters are wrapped in double quotes, which are stripped here so
 * the result compares against real path strings. The arrow split is gated on
 * the status characters rather than applied unconditionally, so a filename
 * that merely contains " -> " is not truncated.
 */
export function parsePorcelainPath(line: string): string {
  const status = line.slice(0, 2);
  let path = line.length > 3 ? line.slice(3) : line.trim();

  if (status.includes("R") || status.includes("C")) {
    const arrow = path.lastIndexOf(" -> ");
    if (arrow !== -1) path = path.slice(arrow + 4);
  }

  path = path.trim();
  if (path.length >= 2 && path.startsWith('"') && path.endsWith('"')) {
    path = path.slice(1, -1);
  }
  return path;
}

/**
 * Drop hench's own runtime artifacts from a list of `git status --porcelain`
 * lines, leaving only paths that represent operator work.
 */
export function excludeHenchRuntimeArtifacts(porcelainLines: string[]): string[] {
  return porcelainLines.filter((line) => !isHenchRuntimeArtifact(parsePorcelainPath(line)));
}
