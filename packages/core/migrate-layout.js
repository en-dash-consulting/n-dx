/**
 * `ndx migrate-layout` — move an already-initialized project from the legacy
 * layout (`.rex/`, `.hench/`, `.sourcevision/` and five loose `.n-dx*` files at
 * the project root) onto the `.ndx/` container.
 *
 * Why this is a command and not something `ndx init` does. Re-running init is
 * how people pick up new assistant surfaces and repaired config, so it must
 * never turn into a migration nobody asked for — `establishInitLayout` in
 * cli.js keeps an initialized project on the layout it has, and hands the move
 * to this module, where it can be done deliberately and undone.
 *
 * The shape of the change is the point: **renames plus two dotfiles.** History
 * follows every tracked path, the untracked and ignored state comes with it,
 * and the only edits are to `.gitignore` and `.gitattributes`, whose patterns
 * have to follow the files they name. A `.rex/**` pin on a project whose PRD
 * now lives in `.ndx/rex/` matches nothing, which is indistinguishable from
 * having no pin at all until a Windows checkout rewrites every PRD file's line
 * endings.
 *
 * **Why not `git mv`.** Git stores no rename records — `git log --follow` and
 * the `R` status are both diff-time similarity detection over blobs. Moving a
 * path on disk and staging both ends produces a byte-identical commit, and
 * survives a case `git mv` does not: `git mv <dir>` aborts the whole directory
 * on any single tracked entry that is missing from the working tree, and a
 * tracked-but-deleted file under `.rex/` is an ordinary mid-work state rather
 * than a corrupt repository. One rename path for tracked and untracked state
 * is also one restore path.
 *
 * That trade is only safe because the migrated paths must be clean before a
 * commit is made — see {@link runMigrateLayout}. Staging with `git add -A`
 * over a dirty tree would sweep the operator's uncommitted work into a commit
 * that is supposed to be nothing but renames.
 *
 * Nothing here knows a directory name. The move list and the pattern rewrites
 * are both derived by resolving the *same* project root under both modes and
 * pairing the fields — so a field added to the resolver joins the migration
 * without an edit here, which is the failure this module would otherwise have:
 * a new n-dx path silently left behind at the root.
 *
 * Orchestration tier, so it spawns rather than imports: `git` through
 * win-spawn's Windows-safe wrapper, and `rex validate` through the `runCapture`
 * the caller injects (the same shape `ci.js` takes its spawn helpers in).
 *
 * @module n-dx/migrate-layout
 * @see packages/core/layout.js — the resolver both halves of the plan come from
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";

import { buildCommitMessage } from "./commit-trailers.js";
import { isInsideGitRepo } from "./git-preflight.js";
import { ensureGitattributesRules } from "./gitattributes-pins.js";
import { ensureGitignoreEntry, isGitTracked } from "./gitignore.js";
import { relativeToRoot, resolveLayout } from "./layout.js";
import { execFileSyncCli } from "./win-spawn.js";

/**
 * Layout fields that are not project paths, and so are not migrated.
 * `container` is excluded because it is the destination, not a thing to move.
 */
const NON_PATH_FIELDS = new Set(["mode", "root", "container"]);

/** Commit subject when the migration commits its own renames. */
export const MIGRATE_COMMIT_SUBJECT = "chore: move n-dx state into .ndx/";

/**
 * One path's before and after, in both the absolute form the filesystem needs
 * and the root-relative forward-slash form git patterns are written in.
 *
 * @typedef {object} PathMapping
 * @property {string} field         The layout field this pair came from.
 * @property {string} from          Absolute legacy path.
 * @property {string} to            Absolute `.ndx/` path.
 * @property {string} fromPattern   Legacy path as `.gitignore` spells it.
 * @property {string} toPattern     `.ndx/` path as `.gitignore` spells it.
 * @property {boolean} [tracked]    Whether git knew the path before the move.
 *   Decided once, before anything is renamed — afterwards the question has no
 *   answer, because the path git would be asked about is gone.
 */

/**
 * Pair every layout field's legacy path with its `.ndx/` path.
 *
 * Returns *all* fields, not only the ones present on disk: the move list wants
 * the subset that exists, but the pattern rewrite wants the lot. `.gitignore`
 * legitimately names paths that have not been created yet — `.hench/reviews/`
 * is ignored from the moment `hench init` runs and created the first time a
 * review is written — and a pattern left behind at `.hench/reviews/` would
 * start silently matching nothing.
 *
 * Sorted longest-pattern-first so a prefix can never shadow a longer sibling.
 * No two of today's names are in that relation, which is exactly why the
 * ordering is worth stating rather than relying on.
 *
 * @param {string} root  Absolute project root.
 * @returns {PathMapping[]}
 */
export function planMigration(root) {
  const legacy = resolveLayout(root, { mode: "legacy" });
  const target = resolveLayout(root, { mode: "ndx" });

  return Object.keys(legacy)
    .filter((field) => !NON_PATH_FIELDS.has(field))
    .map((field) => ({
      field,
      from: legacy[field],
      to: target[field],
      fromPattern: relativeToRoot(legacy, legacy[field]),
      toPattern: relativeToRoot(target, target[field]),
    }))
    .sort((a, b) => b.fromPattern.length - a.fromPattern.length);
}

/**
 * Rewrite one git path pattern, leaving a pattern that names nothing n-dx owns
 * exactly as it was.
 *
 * A match is the whole token or a whole leading path segment — never a
 * substring. This repo's own `.gitignore` carries both `.n-dx.json` and
 * `.n-dx2.json`, and a prefix match would rename the second to
 * `.ndx/config.json2`. The `!` negation and `/` anchor are carried through
 * untouched because they qualify the pattern rather than being part of it.
 *
 * @param {string} token      One pattern, e.g. `.rex/**‍/*.md` or `!.hench/keep`.
 * @param {PathMapping[]} mappings
 * @returns {string}
 */
export function rewritePathPattern(token, mappings) {
  const negation = token.startsWith("!") ? "!" : "";
  let body = token.slice(negation.length);
  const anchor = body.startsWith("/") ? "/" : "";
  body = body.slice(anchor.length);

  for (const { fromPattern, toPattern } of mappings) {
    if (body === fromPattern) return `${negation}${anchor}${toPattern}`;
    if (body.startsWith(`${fromPattern}/`)) {
      return `${negation}${anchor}${toPattern}${body.slice(fromPattern.length)}`;
    }
  }
  return token;
}

/**
 * Rewrite every pattern in a `.gitignore`. Comments, blank lines and any
 * pattern naming something n-dx does not own are returned byte-for-byte — this
 * is the operator's file, and the migration has no business reformatting it.
 *
 * @param {string} content
 * @param {PathMapping[]} mappings
 * @returns {{content: string, rewritten: number}}
 */
export function rewriteIgnoreContent(content, mappings) {
  return rewriteLines(content, mappings, (line) => line.trim());
}

/**
 * Rewrite every pattern in a `.gitattributes`. Identical to the `.gitignore`
 * case except that the pattern is the first whitespace-delimited token and the
 * attributes after it must survive verbatim, alignment included.
 *
 * @param {string} content
 * @param {PathMapping[]} mappings
 * @returns {{content: string, rewritten: number}}
 */
export function rewriteAttributesContent(content, mappings) {
  return rewriteLines(content, mappings, (line) => line.trim().split(/\s+/)[0]);
}

/**
 * Shared line walk for the two dotfiles: pull the pattern out of a line with
 * `pick`, rewrite it, and splice it back in place so surrounding whitespace
 * (indentation, alignment, a CRLF's `\r`) is preserved.
 *
 * @param {string} content
 * @param {PathMapping[]} mappings
 * @param {(line: string) => string} pick
 * @returns {{content: string, rewritten: number}}
 */
function rewriteLines(content, mappings, pick) {
  let rewritten = 0;
  const lines = content.split("\n").map((line) => {
    const pattern = pick(line);
    if (pattern === "" || pattern.startsWith("#")) return line;
    const next = rewritePathPattern(pattern, mappings);
    if (next === pattern) return line;
    rewritten++;
    return line.replace(pattern, next);
  });
  return { content: lines.join("\n"), rewritten };
}

/**
 * Run a git command, returning its outcome rather than throwing.
 *
 * `execFileSyncCli` rather than a direct `child_process` call: it is the
 * package's existing Windows-safe wrapper, and routing through it keeps this
 * module off the `node:child_process` allowlist in
 * `tests/e2e/architecture-policy.test.js`.
 *
 * @param {string[]} args
 * @param {string} cwd
 * @returns {{ok: boolean, stdout: string, error: string}}
 */
function git(args, cwd) {
  try {
    const stdout = execFileSyncCli("git", args, {
      cwd, encoding: "utf-8", stdio: "pipe", timeout: 30_000,
    });
    return { ok: true, stdout: stdout ?? "", error: "" };
  } catch (err) {
    const stderr = err?.stderr?.toString?.() ?? "";
    return {
      ok: false,
      stdout: err?.stdout?.toString?.() ?? "",
      error: (stderr || err?.message || String(err)).trim(),
    };
  }
}

/**
 * What has to be undone if verification fails.
 *
 * A journal rather than a copy of the tree. Every step this module takes is
 * exactly reversible — a rename has an inverse, and the two dotfiles are small
 * enough to hold in memory — so replaying the record backwards puts the project
 * back byte for byte. Nothing is staged until after verification passes, so a
 * restore never has an index to unwind.
 *
 * @typedef {object} MigrationJournal
 * @property {Array<PathMapping & {tracked: boolean}>} moves  Completed, in order.
 * @property {boolean} createdContainer  Whether `.ndx/` was created by this run.
 * @property {Map<string, string | null>} files  Dotfile path → original content,
 *   or `null` when the file did not exist.
 */

/** Read a file's contents, or `null` when it is not there. */
function readOrNull(path) {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

/** Put a file back exactly as the journal found it — including not existing. */
function restoreFile(path, original) {
  if (original === null) {
    rmSync(path, { force: true });
    return;
  }
  writeFileSync(path, original, "utf-8");
}

/**
 * Replay the journal backwards. Best-effort by construction: a restore that
 * hits an error has nothing better to do than keep undoing the rest, and the
 * caller reports the original failure, which is the one worth acting on.
 *
 * @param {string} root
 * @param {MigrationJournal} journal
 * @param {string} container  The `.ndx/` directory.
 */
function restore(root, journal, container) {
  for (const move of [...journal.moves].reverse()) {
    if (existsSync(move.to)) renameSync(move.to, move.from);
  }
  for (const [path, original] of journal.files) restoreFile(path, original);

  // Only remove the container this run created, and only once it is empty —
  // a leftover entry means something was not undone, and deleting it would
  // turn a failed migration into data loss.
  if (journal.createdContainer && existsSync(container) && readdirSync(container).length === 0) {
    rmSync(container, { recursive: true, force: true });
  }
}

/**
 * Capture `rex validate`'s exit code, or `null` when there is no PRD to
 * validate or no way to ask.
 *
 * The verification compares this before and after rather than demanding a pass.
 * A project whose PRD already fails validation is still entitled to migrate,
 * and failing it here would make the command refuse to run for the projects
 * most likely to want a clean slate. What must not change is the *answer*.
 *
 * @param {string} dir
 * @param {{runCapture?: Function, tools?: Record<string, string>}} deps
 * @returns {Promise<number | null>}
 */
async function captureValidate(dir, deps) {
  const { runCapture, tools } = deps;
  if (!runCapture || !tools?.rex) return null;
  if (!existsSync(resolveLayout(dir).rexDir)) return null;
  try {
    const { code } = await runCapture(tools.rex, ["validate", dir]);
    return code;
  } catch {
    return null;
  }
}

/**
 * Move a project onto the `.ndx/` layout.
 *
 * @param {string} dir   Project root.
 * @param {string[]} flags  CLI flags (`--dry-run`, `--no-commit`).
 * @param {{runCapture?: Function, tools?: Record<string, string>}} [deps]
 *   Spawn helpers, injected by cli.js so this module needs no library imports.
 *   Omitting them skips the `rex validate` half of the verification; the
 *   filesystem half always runs.
 * @returns {Promise<number>} Process exit code.
 */
export async function runMigrateLayout(dir, flags = [], deps = {}) {
  const root = resolve(dir);
  const dryRun = flags.includes("--dry-run");
  const noCommit = flags.includes("--no-commit");

  if (resolveLayout(root).mode === "ndx") {
    console.log(`Already on the .ndx/ layout — nothing to migrate in ${root}`);
    return 0;
  }

  const mappings = planMigration(root);
  const moves = mappings.filter((mapping) => existsSync(mapping.from));
  if (moves.length === 0) {
    console.error("Error: no n-dx state found to migrate.");
    console.error(`Hint: Run 'ndx init ${root === process.cwd() ? "" : root}' to set up the project.`.trimEnd());
    return 1;
  }

  const inRepo = isInsideGitRepo(root);
  const container = resolveLayout(root, { mode: "ndx" }).container;

  // Whether git knows a path decides whether it is staged afterwards, and the
  // answer has to be taken before anything moves.
  for (const move of moves) move.tracked = inRepo && isGitTracked(move.fromPattern, root);

  console.log(`Migrating n-dx state to the .ndx/ layout in ${root}\n`);
  const width = Math.max(...moves.map((m) => m.fromPattern.length));
  for (const move of moves) {
    console.log(`  ${move.fromPattern.padEnd(width)}  →  ${move.toPattern}${move.tracked ? "  (tracked)" : ""}`);
  }
  console.log("");

  if (dryRun) {
    console.log("--dry-run: nothing was moved.");
    return 0;
  }

  if (inRepo && !noCommit) {
    const refusal = refuseDirtyTree(root, moves);
    if (refusal) {
      console.error(`Error: ${refusal.reason}`);
      console.error(`Hint: ${refusal.hint}`);
      return 1;
    }
  }

  const validateBefore = await captureValidate(root, deps);

  /** @type {MigrationJournal} */
  const journal = {
    moves: [],
    createdContainer: !existsSync(container),
    files: new Map([
      [join(root, ".gitignore"), readOrNull(join(root, ".gitignore"))],
      [join(root, ".gitattributes"), readOrNull(join(root, ".gitattributes"))],
    ]),
  };

  mkdirSync(container, { recursive: true });

  for (const move of moves) {
    try {
      renameSync(move.from, move.to);
    } catch (err) {
      restore(root, journal, container);
      console.error(`Error: moving ${move.fromPattern} failed — nothing was migrated.`);
      console.error(`Detail: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
    journal.moves.push(move);
  }

  const rewrites = rewriteDotfiles(root, mappings);

  // Top up with whatever `ndx init` would guarantee, now that the patterns name
  // the new layout: the same two ignore entries and the same pin set. Both
  // writers skip what is already present, so this adds only what the rewrite
  // could not — a project initialized before a pin existed gets it here.
  const target = resolveLayout(root);
  ensureGitignoreEntry(root, relativeToRoot(target, target.localConfigFile));
  ensureGitignoreEntry(root, "ndx-export/");
  ensureGitattributesRules(root, target);

  for (const [name, count] of Object.entries(rewrites)) {
    console.log(`  ${name.padEnd(width)}  ${count} pattern${count === 1 ? "" : "s"} rewritten`);
  }

  const failure = await verifyMigration(root, moves, validateBefore, deps);
  if (failure) {
    restore(root, journal, container);
    console.error(`\nError: verification failed — ${failure}`);
    console.error("The project was restored to the legacy layout; nothing was committed.");
    return 1;
  }
  console.log(`\n  Verified: ${moves.length} path${moves.length === 1 ? "" : "s"} moved${validateBefore === null ? "" : `, rex validate unchanged (exit ${validateBefore})`}`);

  if (!inRepo) {
    console.log("\nNot a git repository — the move is on disk only.");
    return 0;
  }

  const staged = stageMigration(root, moves, journal);
  if (!staged.ok) {
    console.error(`\nError: staging the migration failed.\nDetail: ${staged.error}`);
    console.error("The move is complete on disk; stage and commit it yourself.");
    return 1;
  }

  if (noCommit) {
    console.log("\n--no-commit: the migration is staged. Review it with `git diff --cached -M`.");
    return 0;
  }

  const commit = git(["commit", "-m", buildCommitMessage(MIGRATE_COMMIT_SUBJECT, "migrate-layout")], root);
  if (!commit.ok) {
    console.error(`\nError: the migration is staged but committing it failed.\nDetail: ${commit.error}`);
    return 1;
  }
  console.log(`  Committed: ${MIGRATE_COMMIT_SUBJECT}`);
  return 0;
}

/**
 * Rewrite the two dotfiles in place, writing only the ones that changed.
 *
 * @param {string} root
 * @param {PathMapping[]} mappings
 * @returns {Record<string, number>}  Dotfile name → patterns rewritten.
 */
function rewriteDotfiles(root, mappings) {
  const counts = {};
  const files = [
    [".gitignore", rewriteIgnoreContent],
    [".gitattributes", rewriteAttributesContent],
  ];
  for (const [name, rewrite] of files) {
    const path = join(root, name);
    const original = readOrNull(path);
    if (original === null) continue;
    const { content, rewritten } = rewrite(original, mappings);
    if (rewritten > 0) writeFileSync(path, content, "utf-8");
    counts[name] = rewritten;
  }
  return counts;
}

/**
 * Stage both ends of every tracked rename, plus the two dotfiles.
 *
 * `git add -A` over the old and new path in one call: the old side records the
 * removals, the new side the additions, and git's similarity detection pairs
 * them into renames when the diff is read. Restricted to paths git already
 * knew, because a pathspec naming an untracked directory that no longer exists
 * is an error rather than a no-op.
 *
 * Runs *after* the `.gitignore` rewrite, and that order is load-bearing: until
 * the patterns name `.ndx/`, every run log and cache file that just moved is
 * unignored, and `-A` would commit all of it.
 *
 * @param {string} root
 * @param {PathMapping[]} moves
 * @param {MigrationJournal} journal
 */
function stageMigration(root, moves, journal) {
  const layout = resolveLayout(root);
  const paths = [
    ...moves.filter((move) => move.tracked).flatMap((move) => [move.fromPattern, move.toPattern]),
    ...[...journal.files.keys()].filter(existsSync).map((path) => relativeToRoot(layout, path)),
  ];
  if (paths.length === 0) return { ok: true, stdout: "", error: "" };
  return git(["add", "-A", "--", ...paths], root);
}

/**
 * Refuse to commit over uncommitted work.
 *
 * Two questions. Does the index hold anything at all — a commit here takes the
 * whole index, so unrelated staged work would ride along. And is anything
 * modified, deleted or newly added under the paths about to move — `git add -A`
 * would sweep that into a commit the operator has been told is nothing but
 * renames.
 *
 * The second check is what makes a plain rename safe where `git mv` was not,
 * and it is worth the friction: `.rex/prd_tree/` is dirty for most of a working
 * session, and silently committing someone's in-progress PRD edits inside a
 * structural migration is exactly the surprise this command must not spring.
 *
 * @param {string} root
 * @param {PathMapping[]} moves
 * @returns {{reason: string, hint: string} | null}
 */
function refuseDirtyTree(root, moves) {
  if (!git(["diff", "--cached", "--quiet"], root).ok) {
    return {
      reason: "the git index already has staged changes.",
      hint: "Commit or reset them first, or re-run with --no-commit.",
    };
  }

  const tracked = moves.filter((move) => move.tracked).map((move) => move.fromPattern);
  if (tracked.length === 0) return null;

  const status = git(["status", "--porcelain", "--", ...tracked], root);
  if (!status.ok) {
    return { reason: `git status failed: ${status.error}`, hint: "Resolve the repository state and re-run." };
  }
  const dirty = status.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  if (dirty.length === 0) return null;

  return {
    reason: `${dirty.length} uncommitted change${dirty.length === 1 ? "" : "s"} under the paths being migrated.`,
    hint: "Commit them first so the migration commit is only renames, or re-run with --no-commit.",
  };
}

/**
 * Check the move landed. Returns a reason string on failure, `null` on success.
 *
 * Two questions, in the order they can go wrong. Did every path arrive and
 * leave nothing behind — which catches a rename that reported success and a
 * partial directory move. And does rex still read the PRD the same way it did
 * before, which is the only check that looks *inside* what moved.
 *
 * @param {string} root
 * @param {PathMapping[]} moves
 * @param {number | null} validateBefore
 * @param {{runCapture?: Function, tools?: Record<string, string>}} deps
 * @returns {Promise<string | null>}
 */
async function verifyMigration(root, moves, validateBefore, deps) {
  for (const move of moves) {
    if (!existsSync(move.to)) return `${move.toPattern} is missing`;
    if (existsSync(move.from)) return `${move.fromPattern} is still there`;
  }
  if (resolveLayout(root).mode !== "ndx") return "the resolver still reports the legacy layout";

  if (validateBefore === null) return null;
  const validateAfter = await captureValidate(root, deps);
  if (validateAfter !== validateBefore) {
    return `rex validate changed from exit ${validateBefore} to exit ${validateAfter}`;
  }
  return null;
}
