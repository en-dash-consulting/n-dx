/**
 * Git repository preflight for `ndx init`.
 *
 * n-dx's autonomous workflows (hench task execution, auto-commit, pair
 * programming) record progress as git commits. When `ndx init` runs against
 * a directory that is not inside a git working tree, the user is offered the
 * option to initialize one. Declining is allowed — init still completes —
 * but a persistent warning surfaces in the recap that auto-commit features
 * are disabled.
 *
 * The detection is a pure filesystem walk (no `git rev-parse` spawn) so it
 * stays fast and works even when git is missing from PATH.
 *
 * @module n-dx/git-preflight
 */
import { existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { execFileSync } from "child_process";
import { createInterface } from "readline/promises";

const PREFLIGHT_MESSAGE = [
  "",
  "This directory is not inside a git repository.",
  "n-dx workflows record progress with automatic commits — autonomous task",
  "execution, pair programming, and the hench run loop all assume a git",
  "working tree. Without one, those features are disabled.",
  "",
].join("\n");

/**
 * Walk up parent directories looking for a `.git` entry (file or directory).
 * Submodules use a `.git` file pointing at the parent worktree; both forms
 * count as "inside a git working tree".
 *
 * @param {string} dir
 * @returns {boolean}
 */
export function isInsideGitRepo(dir) {
  let cur = resolve(dir);
  // Walk until we reach the filesystem root; dirname(root) === root.
  while (true) {
    if (existsSync(join(cur, ".git"))) return true;
    const parent = dirname(cur);
    if (parent === cur) return false;
    cur = parent;
  }
}

function isInteractive() {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

/**
 * Prompt for a yes/no answer, defaulting to "yes" on an empty Enter press.
 * Returns null when the input is not a TTY.
 *
 * @param {string} question
 * @returns {Promise<boolean|null>}
 */
async function promptYesNo(question) {
  if (!isInteractive()) return null;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    if (answer === "" || answer === "y" || answer === "yes") return true;
    return false;
  } finally {
    rl.close();
  }
}

/**
 * Run `git init` in the target directory. Captures stderr so a missing git
 * binary or write failure does not abort the surrounding init flow.
 *
 * @param {string} dir
 * @returns {{ ok: boolean, error?: string }}
 */
export function runGitInit(dir) {
  try {
    execFileSync("git", ["init"], { cwd: dir, stdio: "pipe", timeout: 15_000 });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * @typedef {Object} GitPreflightResult
 * @property {"inside"|"initialized"|"declined"|"non-interactive"|"init-failed"} status
 *   - `inside`          → target directory already inside a git repo; no action.
 *   - `initialized`     → user consented and `git init` succeeded.
 *   - `declined`        → user answered "no"; auto-commit features disabled.
 *   - `non-interactive` → no TTY (or `quiet`); treated as decline, warning persists.
 *   - `init-failed`     → user consented but `git init` failed (e.g. git missing).
 * @property {string} [error]  Error detail when status === "init-failed".
 */

/**
 * Detect whether `dir` is inside a git working tree; when it is not, prompt
 * the user to run `git init`. The prompt is skipped for non-TTY or `quiet`
 * runs — those resolve to `non-interactive` so the caller can still surface
 * the persistent warning in the recap.
 *
 * @param {string} dir
 * @param {{ quiet?: boolean }} [opts]
 * @returns {Promise<GitPreflightResult>}
 */
export async function runGitPreflight(dir, { quiet = false } = {}) {
  if (isInsideGitRepo(dir)) return { status: "inside" };

  const interactive = isInteractive() && !quiet;

  if (interactive) {
    process.stdout.write(PREFLIGHT_MESSAGE);
    const consent = await promptYesNo("Initialize git in this directory now? [Y/n] ");
    if (consent === false) return { status: "declined" };

    const result = runGitInit(dir);
    if (!result.ok) return { status: "init-failed", error: result.error };
    process.stdout.write(`Initialized empty Git repository in ${resolve(dir)}\n`);
    return { status: "initialized" };
  }

  return { status: "non-interactive" };
}

/**
 * Format the persistent warning lines emitted in the init summary when the
 * project is not a git repository. Returns an empty array for the `inside`
 * and `initialized` states.
 *
 * @param {GitPreflightResult | null | undefined} result
 * @returns {string[]}
 */
export function formatGitWarningLines(result) {
  if (!result) return [];
  if (result.status === "inside" || result.status === "initialized") return [];
  if (result.status === "init-failed") {
    return [
      "  Warning: `git init` failed — n-dx auto-commit features are disabled.",
      `  Detail: ${result.error || "unknown error"}`,
      "  Initialize git manually and re-run `ndx init` to enable automatic commits.",
    ];
  }
  // declined or non-interactive
  return [
    "  Warning: this project is not a git repository — n-dx auto-commit features are disabled.",
    "  Run `git init` in this directory and re-run `ndx init` to enable automatic commits.",
  ];
}

/**
 * Paths considered "n-dx generated" for the baseline commit.  Only entries
 * that actually exist on disk are passed to `git add`; a missing path would
 * abort the entire stage.  The list intentionally includes the assistant
 * surfaces and the n-dx-modified `.gitignore` so the working tree is clean
 * immediately after `ndx init`.
 */
const BASELINE_COMMIT_PATHS = [
  ".sourcevision",
  ".rex",
  ".hench",
  ".n-dx.json",
  ".gitignore",
  ".claude",
  ".codex",
  ".agents",
  "CLAUDE.md",
  "AGENTS.md",
  "README.md",
  "README.proposed.md",
];

/**
 * @typedef {Object} GitInitCommitResult
 * @property {"committed"|"nothing-to-commit"|"add-failed"|"commit-failed"} status
 *   - `committed`         → stage + commit succeeded.
 *   - `nothing-to-commit` → none of the candidate paths exist (unexpected).
 *   - `add-failed`        → `git add` failed (e.g. corrupt index).
 *   - `commit-failed`     → `git commit` failed (e.g. user.name/email unset).
 * @property {string[]} [paths]   Paths staged (when status === "committed").
 * @property {string} [error]     Error detail (when add-failed or commit-failed).
 */

/**
 * Stage and commit the n-dx init baseline.  Intended to run only after
 * `runGitPreflight` returns `initialized` — i.e., the user consented to
 * `git init` during this init run and the repository was created.
 *
 * Stages the n-dx tool directories, top-level config, and any assistant
 * surfaces / README artifacts written during init, then creates a commit
 * with a fixed message identifying the n-dx init baseline.  Failure modes
 * are returned (not thrown) so the caller can surface a clear warning in
 * the init summary without aborting the rest of the run.
 *
 * @param {string} dir
 * @returns {GitInitCommitResult}
 */
export function commitInitBaseline(dir) {
  const existing = BASELINE_COMMIT_PATHS.filter((p) => existsSync(join(dir, p)));
  if (existing.length === 0) return { status: "nothing-to-commit" };

  try {
    execFileSync("git", ["add", "--", ...existing], {
      cwd: dir, stdio: "pipe", timeout: 15_000,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "add-failed", error: message };
  }

  try {
    execFileSync("git", ["commit", "-m", "chore: n-dx init"], {
      cwd: dir, stdio: "pipe", timeout: 15_000,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "commit-failed", error: message };
  }

  return { status: "committed", paths: existing };
}

/**
 * Format the init-commit step for the init summary.  Emits a confirmation
 * line on success and a clear warning when stage or commit failed.  Returns
 * an empty array when the commit step did not run (no preflight init, or
 * `result` is null).
 *
 * @param {GitInitCommitResult | null | undefined} result
 * @returns {string[]}
 */
export function formatGitInitCommitLines(result) {
  if (!result) return [];
  if (result.status === "committed") {
    return ["  Initial git commit created (chore: n-dx init)."];
  }
  if (result.status === "nothing-to-commit") {
    return ["  Initial git commit skipped — no n-dx files found to stage."];
  }
  if (result.status === "add-failed") {
    return [
      "  Warning: staging n-dx files for the initial commit failed.",
      `  Detail: ${result.error || "unknown error"}`,
    ];
  }
  // commit-failed
  return [
    "  Warning: creating the initial n-dx commit failed.",
    `  Detail: ${result.error || "unknown error"}`,
  ];
}
