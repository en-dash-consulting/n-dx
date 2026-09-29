/**
 * Resolving one side of a tree diff to PRD items.
 *
 * `rex tree-diff` compares two trees that may not both be on disk: a git ref
 * (so two commits can be compared), a sibling checkout's directory (so a
 * worktree can be compared against its anchor), or the working tree itself.
 * This module turns each of those into `PRDItem[]` through the one canonical
 * parser, {@link parseFolderTree}, so no side of a diff is read by a
 * second implementation that could drift from the store's.
 *
 * ## Reading a tree at a commit
 *
 * The tree at a ref is materialised into a temp directory with
 *
 * ```
 * GIT_INDEX_FILE=<tmp>/index git --work-tree=<tmp> checkout <ref> -- <treePath>
 * ```
 *
 * one spawn for the whole subtree, whatever its size. The alternatives were
 * worse in ways worth recording, because each looks reasonable until you
 * count something:
 *
 * - `git show <ref>:<file>` per file is one process per item. This
 *   repository's own PRD tree is ~1,750 files, so that is ~1,750 spawns for
 *   one diff.
 * - `git cat-file --batch` is one process but wants the object list on
 *   stdin, and llm-client's `exec` — the only sanctioned process API for a
 *   domain package — does not write to a child's stdin.
 * - `git worktree add` registers state under `.git/worktrees` that outlives
 *   a killed process and needs pruning.
 *
 * `GIT_INDEX_FILE` pointing at a throwaway file is what keeps this from
 * touching the repository: `git checkout -- <path>` writes the index as well
 * as the work tree, and without the override it would stage the ref's
 * version of every PRD file into the caller's real index.
 *
 * @module core/tree-source
 */

import { mkdtemp, rm, realpath } from "node:fs/promises";
import { join, relative, sep, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { exec, execStdout, PROJECT_DIRS } from "@n-dx/llm-client";
import { parseFolderTree } from "../store/folder-tree-parser.js";
import { PRD_TREE_DIRNAME } from "../store/paths.js";
import type { ParseWarning } from "../store/folder-tree-parser.js";
import type { PRDItem } from "../schema/index.js";

/** Long enough for a large subtree checkout on a cold cache. */
const GIT_TIMEOUT_MS = 60_000;

/** One side of a diff, resolved to items. */
export interface ResolvedTree {
  /** How this side was named, for the report: a ref, a path, or "working tree". */
  label: string;
  items: PRDItem[];
  /** Parser warnings — a malformed item file on either side is worth surfacing. */
  warnings: ParseWarning[];
  /**
   * False when the source resolved but carried no PRD tree at all — a commit
   * from before the tree existed, or a checkout that was never initialised.
   * Distinguished from an empty tree so a diff against a ref that simply
   * predates the PRD does not read as "everything was added".
   */
  present: boolean;
}

/** Raised when a source cannot be resolved at all (unknown ref, no repo). */
export class TreeSourceError extends Error {
  constructor(message: string, readonly suggestion?: string) {
    super(message);
    this.name = "TreeSourceError";
  }
}

/** Absolute path of the PRD folder tree inside a project directory. */
export function prdTreePath(projectDir: string): string {
  return join(projectDir, PROJECT_DIRS.REX, PRD_TREE_DIRNAME);
}

/** Read a project directory's PRD tree as it currently stands on disk. */
export async function loadTreeFromDir(
  projectDir: string,
  label: string,
): Promise<ResolvedTree> {
  const { items, warnings } = await parseFolderTree(prdTreePath(projectDir));
  return { label, items, warnings, present: !missingRoot(warnings) };
}

/**
 * Read the PRD tree as it stood at a git ref.
 *
 * @param projectDir Project directory, used to locate the repository and the
 *                   tree's path within it.
 * @param ref        Anything `git rev-parse` accepts: a branch, a tag, a sha,
 *                   `HEAD~3`, `origin/main`.
 */
export async function loadTreeAtRef(
  projectDir: string,
  ref: string,
): Promise<ResolvedTree> {
  const repoRoot = await resolveRepoRoot(projectDir);
  await assertRefExists(repoRoot, ref);

  // Both sides of the relative() below must be real paths. `git rev-parse
  // --show-toplevel` always reports one, while projectDir is whatever the
  // caller typed — and on macOS the common cases (/tmp, /var, and any
  // checkout reached through a symlinked home) differ, which would make
  // every path inside the repository look like it was outside it.
  const realProjectDir = await realpath(projectDir).catch(() => projectDir);

  // Pathspec and extraction path are both relative to the repository root, so
  // the command does not depend on where inside the repo it was invoked.
  const treeRelative = toPosix(relative(repoRoot, prdTreePath(realProjectDir)));
  if (treeRelative.startsWith("..") || isAbsolute(treeRelative)) {
    throw new TreeSourceError(
      `${projectDir} is not inside the git repository at ${repoRoot}.`,
      "Run tree-diff from within the checkout whose history you want to read.",
    );
  }

  const scratch = await mkdtemp(join(tmpdir(), "rex-tree-diff-"));
  try {
    const checkout = await exec(
      "git",
      [`--work-tree=${scratch}`, "checkout", ref, "--", treeRelative],
      {
        cwd: repoRoot,
        timeout: GIT_TIMEOUT_MS,
        // C locale: isMissingPathspec parses git's English error text.
        env: { ...process.env, GIT_INDEX_FILE: join(scratch, "index"), LC_ALL: "C" },
      },
    );

    // A ref that predates the PRD tree has nothing at that path. git reports
    // that as a failed pathspec match, which is an absent tree rather than an
    // error — the diff is still meaningful, and saying so is more useful than
    // reporting every current item as added with no explanation.
    if (checkout.exitCode !== 0) {
      if (isMissingPathspec(checkout.stderr)) {
        return { label: ref, items: [], warnings: [], present: false };
      }
      throw new TreeSourceError(
        `Could not read the PRD tree at "${ref}": ${firstLine(checkout.stderr)}`,
      );
    }

    const { items, warnings } = await parseFolderTree(join(scratch, treeRelative));
    return { label: ref, items, warnings, present: !missingRoot(warnings) };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * The branch this checkout should be compared against by default — what
 * `origin/HEAD` names, else `main`, else `master`, whichever the repository
 * actually has. Returns null when none of them resolve.
 *
 * Preferred over reading the local branch of the same name because the point
 * of the default comparison is "what has this worktree done that the shared
 * line has not", and a stale local `main` answers a different question.
 */
export async function resolveAnchorRef(projectDir: string): Promise<string | null> {
  const repoRoot = await resolveRepoRoot(projectDir).catch(() => null);
  if (repoRoot === null) return null;

  const symbolic = (
    await execStdout("git", ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], {
      cwd: repoRoot,
      timeout: GIT_TIMEOUT_MS,
    })
  ).trim();
  if (symbolic.startsWith("refs/remotes/")) return symbolic.slice("refs/remotes/".length);

  for (const candidate of ["origin/main", "origin/master", "main", "master"]) {
    if (await refExists(repoRoot, candidate)) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// git helpers
// ---------------------------------------------------------------------------

async function resolveRepoRoot(projectDir: string): Promise<string> {
  const raw = (
    await execStdout("git", ["rev-parse", "--show-toplevel"], {
      cwd: projectDir,
      timeout: GIT_TIMEOUT_MS,
    })
  ).trim();
  // Resolved for the same reason the project dir is: the two are compared.
  const root = raw ? await realpath(raw).catch(() => raw) : raw;

  if (!root) {
    throw new TreeSourceError(
      `${projectDir} is not inside a git repository.`,
      "Comparing commits needs git history — use --against=<dir> to compare two checkouts instead.",
    );
  }
  return root;
}

async function refExists(repoRoot: string, ref: string): Promise<boolean> {
  const result = await exec("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
    cwd: repoRoot,
    timeout: GIT_TIMEOUT_MS,
  });
  return result.exitCode === 0;
}

async function assertRefExists(repoRoot: string, ref: string): Promise<void> {
  if (await refExists(repoRoot, ref)) return;
  throw new TreeSourceError(
    `"${ref}" is not a commit this repository knows.`,
    "Pass a branch, tag or sha that resolves here — 'git rev-parse <ref>' should print a hash.",
  );
}

/**
 * Whether git's failure was "that path is not in that commit" rather than a
 * real error. Matched on the message because git exits 1 for both.
 */
function isMissingPathspec(stderr: string): boolean {
  return /did not match any file\(s\) known to git|pathspec .* did not match/i.test(stderr);
}

/** The parser's signal that the tree root itself was absent. */
function missingRoot(warnings: ParseWarning[]): boolean {
  return warnings.some((w) => w.message === "Tree root directory does not exist");
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0] || "git reported no error output";
}

function toPosix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}
