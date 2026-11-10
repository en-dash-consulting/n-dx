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
import { existsSync, rmSync } from "fs";
import { dirname, join, relative, resolve, sep } from "path";
import { execFileSync } from "child_process";
import { createInterface } from "readline/promises";
import { buildCommitMessage } from "./commit-trailers.js";
import { relativeToRoot, resolveLayout } from "./layout.js";

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
 *   - `non-interactive` → no TTY (or `quiet`) and no explicit consent; treated as a
 *                         decline, warning persists.
 *   - `init-failed`     → user consented but `git init` failed (e.g. git missing).
 * @property {string} [error]  Error detail when status === "init-failed".
 */

/**
 * Detect whether `dir` is inside a git working tree; when it is not, prompt
 * the user to run `git init`. The prompt is skipped for non-TTY or `quiet`
 * runs — those resolve to `non-interactive` so the caller can still surface
 * the persistent warning in the recap.
 *
 * `consent` answers the prompt ahead of time, which is what a caller that has
 * no TTY to prompt on needs: `ndx init --git` on the command line, and the
 * dashboard setup wizard, which asks the question in the browser and spawns
 * `ndx init` with piped stdio. `true` creates the repository, `false` declines
 * it outright (no prompt, warning still surfaced), `undefined` keeps the
 * interactive behaviour.
 *
 * @param {string} dir
 * @param {{ quiet?: boolean, consent?: boolean }} [opts]
 * @returns {Promise<GitPreflightResult>}
 */
export async function runGitPreflight(dir, { quiet = false, consent } = {}) {
  if (isInsideGitRepo(dir)) return { status: "inside" };

  if (consent === false) return { status: "declined" };
  if (consent === true) {
    const result = runGitInit(dir);
    if (!result.ok) return { status: "init-failed", error: result.error };
    if (!quiet) process.stdout.write(`Initialized empty Git repository in ${resolve(dir)}\n`);
    return { status: "initialized" };
  }

  const interactive = isInteractive() && !quiet;

  if (interactive) {
    process.stdout.write(PREFLIGHT_MESSAGE);
    const answer = await promptYesNo("Initialize git in this directory now? [Y/n] ");
    if (answer === false) return { status: "declined" };

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
 * Paths that are n-dx's own state, wherever this project keeps it.
 *
 * On the `.ndx/` layout the container covers all four in one entry; the legacy
 * layout spreads them across the root. Asking the resolver rather than listing
 * both is the point — a baseline commit that staged `.rex` on a project whose
 * PRD lives in `.ndx/rex` would leave the whole tree untracked and the working
 * directory dirty straight out of `ndx init`.
 *
 * @param {string} dir  Project root.
 * @returns {string[]} Root-relative paths.
 */
function stateCommitPaths(dir) {
  const layout = resolveLayout(dir);
  if (layout.container) return [relativeToRoot(layout, layout.container)];
  return [
    layout.sourcevisionDir,
    layout.rexDir,
    layout.henchDir,
    layout.configFile,
  ].map((path) => relativeToRoot(layout, path));
}

/**
 * Paths considered "n-dx generated" for the baseline commit but not owned by
 * the layout resolver: assistant surfaces, the n-dx-modified `.gitignore`, and
 * the README artifacts — all fixed at the project root on either layout, so the
 * working tree is clean immediately after `ndx init`.
 *
 * Only entries that actually exist on disk are passed to `git add`; a missing
 * path would abort the entire stage.
 */
const BASELINE_COMMIT_PATHS = [
  ".gitignore",
  ".gitattributes",
  ".mcp.json",
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
 * @property {"committed"|"nothing-to-commit"|"unchanged"|"skipped"|"add-failed"|"commit-failed"} status
 *   - `committed`         → stage + commit succeeded.
 *   - `nothing-to-commit` → none of the candidate paths exist (unexpected).
 *   - `unchanged`         → init wrote nothing git sees (a no-op re-init); no commit.
 *   - `skipped`           → `ndx init --no-commit`.
 *   - `add-failed`        → `git add` failed (e.g. corrupt index).
 *   - `commit-failed`     → `git commit` failed (e.g. user.name/email unset).
 * @property {"baseline"|"files"} [kind]  `files` for a commit in an existing repository.
 * @property {string[]} [paths]   Paths staged (when status === "committed").
 * @property {string[]} [untracked]  Machine-local paths dropped from tracking by the commit.
 * @property {string[]} [leftDirty]  Init paths the user had already changed, left out of the
 *   commit (repository-relative); `ndx work` refuses the tree until they are committed.
 * @property {string} [error]     Error detail (when add-failed or commit-failed).
 */

/**
 * The subset of `paths` git ignores in `dir` (any ignore source, the user's
 * global excludes included). Empty when git cannot answer.
 *
 * @param {string} dir
 * @param {string[]} paths
 * @returns {Set<string>}
 */
function ignoredPaths(dir, paths) {
  if (paths.length === 0) return new Set();
  try {
    const out = execFileSync("git", ["check-ignore", "-z", "--stdin"], {
      cwd: dir, encoding: "utf-8", stdio: "pipe", timeout: 15_000, input: paths.join("\0") + "\0",
    });
    return new Set(out.split("\0").filter(Boolean));
  } catch {
    // Exit 1 means none is ignored.
    return new Set();
  }
}

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
  const candidates = [...stateCommitPaths(dir), ...BASELINE_COMMIT_PATHS];
  const present = candidates.filter((p) => existsSync(join(dir, p)));
  // `git add` refuses a path named outright that an ignore rule covers — the
  // user's global excludes may ignore `.claude/` — and stages nothing after it.
  const ignored = ignoredPaths(dir, present);
  const existing = present.filter((p) => !ignored.has(p));
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
    // --no-verify for the reason commitInitChanges gives; a global
    // core.hooksPath reaches even a repository `git init` just created.
    execFileSync("git", ["commit", "--no-verify", "-m", buildCommitMessage("chore: n-dx init", "init/baseline")], {
      cwd: dir, stdio: "pipe", timeout: 15_000,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "commit-failed", error: message };
  }

  return { status: "committed", paths: existing };
}

/**
 * @typedef {Object} GitDirtySnapshot
 * @property {string} root        Repository top level; every path is relative to it.
 * @property {Set<string>} paths  Paths `git status` reports as changed or untracked.
 */

/**
 * Record which paths in the repository containing `dir` are already changed,
 * staged or untracked. Taken before `ndx init` writes anything, it is what
 * separates the user's own work from the files init goes on to write.
 *
 * Returns null when `dir` is not in a repository or git cannot be run.
 *
 * @param {string} dir
 * @returns {GitDirtySnapshot | null}
 */
export function snapshotDirtyPaths(dir) {
  let root;
  try {
    root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: dir, encoding: "utf-8", stdio: "pipe", timeout: 15_000,
    }).trim();
  } catch {
    return null;
  }
  if (!root) return null;
  let out;
  try {
    out = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
      cwd: root, encoding: "utf-8", stdio: "pipe", timeout: 30_000, maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
  return { root, paths: parsePorcelainZ(out) };
}

/**
 * Parse `git status --porcelain=v1 -z` into the set of paths it names. A
 * rename or copy record carries its source path as the following field; both
 * count as touched.
 *
 * @param {string} out
 * @returns {Set<string>}
 */
export function parsePorcelainZ(out) {
  const paths = new Set();
  const fields = out.split("\0");
  for (let i = 0; i < fields.length; i++) {
    const record = fields[i];
    if (record.length < 4) continue;
    const xy = record.slice(0, 2);
    paths.add(record.slice(3));
    if (/[RC]/.test(xy) && i + 1 < fields.length) {
      i++;
      if (fields[i]) paths.add(fields[i]);
    }
  }
  return paths;
}

/**
 * Feed a NUL-separated pathspec list to git on stdin, literally (no globbing),
 * so a large init cannot overflow the argument list.
 *
 * @param {string} cwd
 * @param {string[]} args
 * @param {string[]} paths
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function gitWithPathspecs(cwd, args, paths, env) {
  return execFileSync("git", ["--literal-pathspecs", ...args, "--pathspec-from-file=-", "--pathspec-file-nul"], {
    cwd, stdio: "pipe", timeout: 30_000, input: paths.join("\0"), encoding: "utf-8",
    ...(env ? { env } : {}),
  });
}

/**
 * Files n-dx rewrites on every server start or analysis and that are only
 * meaningful on this machine: the dashboard's pid, port and spend ledger
 * (under both layouts' names — a hub-started server writes the legacy root
 * names before init creates `.ndx/`) and the sourcevision and rex caches.
 * Committed, they dirty the tree again on the next `ndx start` or analysis,
 * and autonomous runs refuse a dirty tree.
 *
 * @param {string} dir  Project root.
 * @returns {{ path: string, dir: boolean }[]}  Absolute paths.
 */
export function machineLocalPaths(dir) {
  const layout = resolveLayout(dir);
  const legacy = resolveLayout(dir, { mode: "legacy" });
  const entries = [
    { path: layout.webPidFile, dir: false },
    { path: layout.webPortFile, dir: false },
    { path: layout.webUsageFile, dir: false },
    { path: legacy.webPidFile, dir: false },
    { path: legacy.webPortFile, dir: false },
    { path: legacy.webUsageFile, dir: false },
    { path: join(layout.sourcevisionDir, ".cache"), dir: true },
    { path: join(layout.rexDir, ".cache"), dir: true },
  ];
  const seen = new Set();
  return entries.filter((e) => !seen.has(e.path) && seen.add(e.path));
}

/**
 * `.gitignore` lines for {@link machineLocalPaths}, relative to `dir`.
 *
 * @param {string} dir
 * @returns {string[]}
 */
export function machineLocalIgnoreEntries(dir) {
  return machineLocalPaths(dir).map((e) => toPosix(relative(dir, e.path)) + (e.dir ? "/" : ""));
}

/** @param {string} p */
function toPosix(p) {
  return sep === "/" ? p : p.split(sep).join("/");
}

/**
 * Which machine-local paths git still tracks (an earlier commit took them in
 * before they were ignored), relative to the repository root.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function trackedMachineLocalFiles(dir) {
  // Resolved from `dir` with --full-name, not by relativising against the
  // root: the two can spell the same directory differently (/var vs
  // /private/var on macOS), which would turn every spec into a `../` path.
  const specs = machineLocalIgnoreEntries(dir).map((e) => e.replace(/\/$/, ""));
  try {
    // ls-files takes no --pathspec-from-file; the list is short and fixed.
    const out = execFileSync("git", ["--literal-pathspecs", "ls-files", "--full-name", "-z", "--", ...specs], {
      cwd: dir, encoding: "utf-8", stdio: "pipe", timeout: 15_000,
    });
    return out.split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Which repository paths `ndx init` may commit, as root-relative matchers.
 *
 * `owned` is the baseline commit's list ({@link stateCommitPaths} plus
 * {@link BASELINE_COMMIT_PATHS}) under `dir`: anything else that changed
 * while init ran — a file saved in another terminal during a prompt, or a
 * sibling package when `dir` is below the repository root — is not init's.
 *
 * `analysis` is the sourcevision output directory. Everything in it is
 * generated by `sv analyze`, which init reruns, so its changes are init's even
 * when they predate this run (a hub-started server analyses before the user
 * commits): nobody hand-edits it, unlike the PRD.
 *
 * Prefixed with `rev-parse --show-prefix` rather than relativised against the
 * root, for the reason {@link trackedMachineLocalFiles} gives. Null when git
 * cannot say where `dir` sits.
 *
 * @param {string} dir
 * @returns {{ owned: (p: string) => boolean, analysis: (p: string) => boolean } | null}
 */
function initPathMatchers(dir) {
  let prefix;
  try {
    prefix = execFileSync("git", ["rev-parse", "--show-prefix"], {
      cwd: dir, encoding: "utf-8", stdio: "pipe", timeout: 15_000,
    }).trim();
  } catch {
    return null;
  }
  /** @param {string[]} entries */
  const under = (entries) => {
    const full = entries.map((e) => prefix + toPosix(e));
    return (/** @type {string} */ p) => full.some((e) => p === e || p.startsWith(e + "/"));
  };
  return {
    owned: under([...stateCommitPaths(dir), ...BASELINE_COMMIT_PATHS]),
    analysis: under([relative(dir, resolveLayout(dir).sourcevisionDir)]),
  };
}

/**
 * Commit the paths `ndx init` created or changed in a repository that already
 * existed, so the first `ndx work` starts on a clean tree. Machine-local files
 * an earlier commit tracked ({@link machineLocalPaths}) are dropped from
 * tracking in the same commit; they stay on disk.
 *
 * Only paths init owns ({@link initPathMatchers}) are candidates. One is
 * committed when it is changed now and was not before init ran (`before`), or
 * when it is sourcevision output. An init path the user already had changed is
 * left as it was and returned in `leftDirty`, because `ndx work` will still
 * refuse the tree until it is committed. Everything outside init's paths is
 * never looked at. The commit is built in a
 * temporary index seeded from HEAD, so the user's staged entries are never
 * committed; afterwards only the committed paths are reset in the real index.
 * (`git commit --only` cannot be used: it re-reads each path from the working
 * tree, which would re-add a file being dropped from tracking.)
 *
 * @param {GitDirtySnapshot} before  Snapshot taken before init wrote anything.
 * @param {string} [dir]  Project root; defaults to the repository root.
 * @returns {GitInitCommitResult}
 */
export function commitInitChanges(before, dir = before.root) {
  const after = snapshotDirtyPaths(before.root);
  if (!after) return { status: "add-failed", kind: "files", error: "`git status` failed" };
  const match = initPathMatchers(dir);
  if (!match) return { status: "add-failed", kind: "files", error: "could not locate the project in the repository" };
  const untrack = trackedMachineLocalFiles(dir);
  const untrackSet = new Set(untrack);
  const owned = [...after.paths].filter((p) => !untrackSet.has(p) && match.owned(p)).sort();
  const isInits = (/** @type {string} */ p) => !before.paths.has(p) || match.analysis(p);
  const paths = owned.filter(isInits);
  const leftDirty = owned.filter((p) => !isInits(p));
  const extra = leftDirty.length > 0 ? { leftDirty } : {};
  if (paths.length === 0 && untrack.length === 0) return { status: "unchanged", kind: "files", ...extra };

  const root = before.root;
  let indexFile;
  try {
    indexFile = resolve(root, execFileSync("git", ["rev-parse", "--git-path", `ndx-init-${process.pid}.index`], {
      cwd: root, encoding: "utf-8", stdio: "pipe", timeout: 15_000,
    }).trim());
  } catch (err) {
    return { status: "add-failed", kind: "files", error: err instanceof Error ? err.message : String(err), ...extra };
  }
  const env = { ...process.env, GIT_INDEX_FILE: indexFile };
  const all = [...paths, ...untrack];

  try {
    try {
      execFileSync("git", ["rev-parse", "--verify", "-q", "HEAD"], { cwd: root, stdio: "pipe", timeout: 15_000 });
      execFileSync("git", ["read-tree", "HEAD"], { cwd: root, stdio: "pipe", timeout: 30_000, env });
    } catch {
      execFileSync("git", ["read-tree", "--empty"], { cwd: root, stdio: "pipe", timeout: 30_000, env });
    }
    if (paths.length > 0) gitWithPathspecs(root, ["add", "--all"], paths, env);
    if (untrack.length > 0) gitWithPathspecs(root, ["rm", "-r", "--cached", "--quiet", "--ignore-unmatch"], untrack, env);
  } catch (err) {
    rmSync(indexFile, { force: true });
    return { status: "add-failed", kind: "files", error: err instanceof Error ? err.message : String(err), ...extra };
  }

  try {
    // --no-verify: the commit holds only generated files under a message n-dx
    // owns. A project's hooks would run against the temporary index, and a
    // formatter such as lint-staged would rewrite generated output that the
    // next analysis or init writes back, dirtying the tree again.
    execFileSync("git", ["commit", "-q", "--no-verify", "-m", buildCommitMessage("chore: n-dx init", "init/files")], {
      cwd: root, stdio: "pipe", timeout: 60_000, env,
    });
  } catch (err) {
    return { status: "commit-failed", kind: "files", error: err instanceof Error ? err.message : String(err), ...extra };
  } finally {
    rmSync(indexFile, { force: true });
  }

  // Bring the real index in line with the new commit for exactly these paths.
  try {
    gitWithPathspecs(root, ["reset", "-q"], all);
  } catch { /* the commit stands; `git status` shows the index as staged edits */ }

  return { status: "committed", kind: "files", paths: all, ...(untrack.length > 0 ? { untracked: untrack } : {}), ...extra };
}

/**
 * The commit step that ends `ndx init`, for both the static and the Ink path.
 *
 * - A repository the preflight just created gets the baseline commit.
 * - An existing repository gets a commit of exactly the paths init wrote.
 * - Outside a repository nothing runs; the preflight warning says why.
 *
 * @param {string} dir
 * @param {{ gitResult?: GitPreflightResult | null, before?: GitDirtySnapshot | null, commit?: boolean }} opts
 *   `commit: false` is `ndx init --no-commit`.
 * @returns {GitInitCommitResult | null}
 */
export function finishInitCommit(dir, { gitResult, before, commit = true }) {
  const status = gitResult?.status;
  if (status !== "initialized" && status !== "inside") return null;
  if (!commit) return { status: "skipped" };
  if (status === "initialized") return commitInitBaseline(dir);
  if (!before) return { status: "add-failed", error: "could not read `git status` before init" };
  return commitInitChanges(before, dir);
}

/**
 * Format the init-commit step for the init summary.  Emits a confirmation
 * line on success and a clear warning when stage or commit failed.  Returns
 * an empty array when the commit step did not run or init changed nothing.
 *
 * @param {GitInitCommitResult | null | undefined} result
 * @returns {string[]}
 */
export function formatGitInitCommitLines(result) {
  if (!result) return [];
  const dirty = leftDirtyLines(result.leftDirty);
  if (result.status === "unchanged") return dirty;
  if (result.status === "committed") {
    if (result.kind === "files") {
      const n = result.paths?.length ?? 0;
      const lines = [`  Committed ${n} init file${n === 1 ? "" : "s"} (chore: n-dx init).`];
      const u = result.untracked?.length ?? 0;
      if (u > 0) lines.push(`  Stopped tracking ${u} machine-local file${u === 1 ? "" : "s"} (kept on disk, now gitignored).`);
      return [...lines, ...dirty];
    }
    return ["  Initial git commit created (chore: n-dx init)."];
  }
  if (result.status === "skipped") {
    return ["  Init files left uncommitted (--no-commit). Commit them before `ndx work`."];
  }
  if (result.status === "nothing-to-commit") {
    return ["  Initial git commit skipped — no n-dx files found to stage."];
  }
  if (result.status === "add-failed") {
    return [
      "  Warning: staging n-dx files failed — init files were left uncommitted.",
      `  Detail: ${result.error || "unknown error"}`,
      "  Commit them before `ndx work`.",
    ];
  }
  // commit-failed. The baseline commit staged into the real index; the
  // `files` commit used a temporary one it has since deleted, so nothing is
  // staged.
  const state = result.kind === "files" ? "left uncommitted" : "staged but uncommitted";
  return [
    `  Warning: creating the n-dx init commit failed — init files are ${state}.`,
    `  Detail: ${result.error || "unknown error"}`,
    "  Check git's user.name/user.email, then commit them before `ndx work`.",
  ];
}

/** How many left-dirty paths the summary names before it counts the rest. */
const LEFT_DIRTY_SHOWN = 5;

/**
 * The summary line for init paths the commit skipped because the user had
 * already changed them.
 *
 * @param {string[] | undefined} paths
 * @returns {string[]}
 */
function leftDirtyLines(paths) {
  const n = paths?.length ?? 0;
  if (!paths || n === 0) return [];
  const shown = paths.slice(0, LEFT_DIRTY_SHOWN).join(", ");
  const more = n > LEFT_DIRTY_SHOWN ? ` and ${n - LEFT_DIRTY_SHOWN} more` : "";
  return [
    `  Left ${n} init file${n === 1 ? "" : "s"} you had already changed uncommitted: ${shown}${more}.`,
    "  Commit them before `ndx work`.",
  ];
}
