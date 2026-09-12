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
 * the per-run and per-session output paths below.
 *
 * `.hench/session-cache.json` earns its place the hard way: it was committed
 * on this branch by the very `git add -A` described above, and then rewritten
 * by the next orientation, so an autonomous run would refuse to start against
 * a file it had just written itself. An ignore line alone does not fix that
 * once the file is tracked — the untrack and the discount are both required.
 *
 * @module hench/store/artifacts
 */

import { relative as relativePath } from "node:path";
import { realpath } from "node:fs/promises";
import { execStdout } from "../process/exec.js";

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
  ".hench/reviews/",
  ".hench/session-cache.json",
  ".hench-commit-msg.txt",
];

/** Normalize a path for comparison: forward slashes, no leading `./`. */
function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * True when `path` (repository-relative, as git reports it) is covered by one
 * of the project-relative `patterns`.
 *
 * A pattern with a trailing slash matches the directory itself — with or
 * without that slash, because `git status --porcelain` collapses a wholly
 * untracked directory to `?? .hench/locks/` but reports individual files once
 * any sibling is tracked — and everything beneath it. A pattern without one
 * matches that exact path.
 *
 * `repoPrefix` is applied to the *pattern* rather than stripped from the path:
 * every path hench cares about is expressed relative to its project, and that
 * direction keeps a sibling project's `other/.hench/runs/` outside the match —
 * it is somebody else's uncommitted work. See {@link repoRelativePrefix}.
 *
 * The single matcher for every porcelain line hench judges. Two copies of this
 * rule existed — this one and the uncommitted-work gate's discount list — which
 * meant the pre-run gate and the post-run gate could be fixed apart and disagree
 * about the same line.
 *
 * @param path Repository-relative path, as reported by git.
 * @param patterns Project-relative paths; trailing slash means "and beneath".
 * @param repoPrefix The project's location within the repo, from
 *   {@link repoRelativePrefix}; `""` when the project is the repo root.
 */
export function matchesProjectPath(
  path: string,
  patterns: readonly string[],
  repoPrefix = "",
): boolean {
  const normalized = normalize(path);
  return patterns.some((entry) => {
    const target = repoPrefix + normalize(entry);
    if (target.endsWith("/")) {
      return (
        normalized === target ||
        normalized === target.slice(0, -1) ||
        normalized.startsWith(target)
      );
    }
    return normalized === target;
  });
}

/**
 * True when `path` is one of hench's own runtime artifacts.
 *
 * @param path Repository-relative path, as reported by git.
 * @param repoPrefix The project's location within the repo, from
 *   {@link repoRelativePrefix}; `""` when the project is the repo root.
 */
export function isHenchRuntimeArtifact(path: string, repoPrefix = ""): boolean {
  return matchesProjectPath(path, HENCH_RUNTIME_GITIGNORE_ENTRIES, repoPrefix);
}

/**
 * Where the project sits inside its repository, as a porcelain path prefix.
 *
 * **`git status --porcelain` reports paths relative to the repository root, not
 * to the directory it was invoked from.** That is the whole reason this
 * function exists, and it is the assumption every match above rests on. A run
 * in `sub/` sees `?? sub/.hench/locks/run.lock`, so matching that against a
 * bare `.hench/locks/` fails and hench's own lock file counts as operator work
 * — which made the gate refuse to start on a file it had just created, then
 * remove it on exit so the tree read clean to anyone who looked afterwards.
 *
 * Every path hench cares about is expressed relative to `projectDir`, so the
 * prefix is applied to the pattern rather than stripped from each line. That
 * keeps a sibling project's `other/.hench/runs/` outside the match: it is
 * somebody else's uncommitted work, not this project's runtime state.
 *
 * @param projectDir - the directory hench is operating on
 * @returns `""` when the project *is* the repo root, otherwise a `sub/`-style
 *   prefix. Also `""` when the directory is not in a repository or git is
 *   unavailable — `execStdout` resolves empty rather than throwing, and the
 *   pre-nesting behaviour is the right thing to fall back to.
 */
export async function repoRelativePrefix(projectDir: string): Promise<string> {
  const root = (
    await execStdout("git", ["rev-parse", "--show-toplevel"], {
      cwd: projectDir,
      timeout: 15_000,
    })
  ).trim();
  if (!root) return "";

  // Both sides must be canonical before they can be subtracted. `git rev-parse`
  // resolves symlinks and `projectDir` generally has not: on macOS a path under
  // `/var/...` or `/tmp/...` comes back as `/private/var/...`, and a symlinked
  // home or checkout does the same anywhere. Comparing the two raw strings
  // yields a `..`-laden relative path, the guard below discards it, and the
  // prefix silently falls back to "" — leaving exactly the bug this function
  // was written to fix, on developer machines only.
  const canonical = await realpath(projectDir).catch(() => projectDir);
  const canonicalRoot = await realpath(root).catch(() => root);

  const rel = relativePath(canonicalRoot, canonical).replaceAll("\\", "/");
  // `..` means projectDir is outside the reported root, which should not happen
  // — treat it as unknown rather than building a nonsense prefix.
  if (!rel || rel.startsWith("..")) return "";
  return `${rel}/`;
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
/**
 * Split `git status --porcelain` output into lines without damaging them.
 *
 * **Never `trim()` porcelain output.** The XY status field is two columns wide
 * and the first is blank for an unstaged-only change, so a leading space is
 * part of the format: a trim eats it from the *first* line only, and every
 * subsequent field shifts left by one. The path then parses one character
 * short (`.rex/prd_tree/…` → `rex/prd_tree/…`, matching no discount rule) and
 * `isFullyStaged` reads the worktree column as the index column, so ` M file`
 * masquerades as staged and is discounted outright. Both failures apply to
 * whichever entry git happened to report first, which is why they looked
 * intermittent.
 *
 * Blank lines are dropped and a trailing `\r` is tolerated; nothing else about
 * a line is altered.
 */
export function splitPorcelainLines(output: string): string[] {
  return output.split(/\r?\n/).filter((line) => line.trim().length > 0);
}

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
 *
 * `projectDir` is required rather than defaulted because porcelain paths are
 * repo-root-relative and the artifact list is project-relative: without it the
 * two cannot be compared, and a default would silently reintroduce the
 * nested-project bug at whichever call site forgot to pass one. Making it
 * mandatory means the compiler, not a reviewer, checks that the callers agree.
 *
 * @param porcelainLines - porcelain lines, as produced for `projectDir`
 * @param projectDir - the directory those lines were collected for
 * @see HENCH_RUNTIME_GITIGNORE_ENTRIES — the list, shared with `hench init`
 * @see repoRelativePrefix — why the project's position in the repo matters
 */
export async function excludeHenchRuntimeArtifacts(
  porcelainLines: string[],
  projectDir: string,
): Promise<string[]> {
  const prefix = await repoRelativePrefix(projectDir);
  return porcelainLines.filter((line) => !isHenchRuntimeArtifact(parsePorcelainPath(line), prefix));
}
