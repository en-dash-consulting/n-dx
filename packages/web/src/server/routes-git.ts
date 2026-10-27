/**
 * Working-tree git status API routes — lets the dashboard show uncommitted
 * changes and commit them without leaving the browser.
 *
 * GET  /api/git/status  — dirty files + current branch
 * GET  /api/git/diff    — diff for one file (?file=<path>)
 * POST /api/git/commit  — stage everything currently dirty and commit
 * POST /api/git/discard — hard-reset tracked changes and remove untracked
 *                         files (git reset --hard HEAD + git clean -fd)
 * POST /api/git/ignore  — append one untracked path to .gitignore
 *
 * Deliberately narrow: read-only status/diff plus three scoped mutations
 * (stage-all + commit, discard-all, and ignore-one-path). No branch
 * switching, merge, rebase, partial staging, or conflict resolution here —
 * those carry real destructive-action risk and are better served by a
 * terminal or IDE.
 * Discard in particular is irreversible for untracked files (`git clean`
 * does not go through the reflog) — the route requires the caller to echo
 * back the dirty-file count it is confirming against (a stale-request
 * guard, same pattern as rex's prune route), and the client gates the
 * action behind an explicit confirmation step. This exists to close one
 * specific gap:
 * `performPreRunCommitGateIfNeeded` (packages/hench) refuses to start an
 * autonomous run against a dirty tree, and the dashboard had no visibility
 * into that at all — a blocked run was invisible until the user went to a
 * terminal to find out why.
 *
 * @module web/server/routes-git
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { exec, resolveLayout } from "@n-dx/llm-client";
import type { ServerContext } from "./types.js";
import { jsonResponse, errorResponse, readBody, errorMessage } from "./response-utils.js";
import { isFeatureEnabled } from "./routes-features.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GitFileStatus =
  | "modified" | "added" | "deleted" | "renamed" | "untracked" | "unmerged" | "other";

/**
 * Where a dirty file came from.
 *
 * `prd` and `analysis` are files n-dx itself rewrites — the PRD tree, and the
 * tracked SourceVision outputs an analyze run regenerates. They are the bulk
 * of the noise in a working tree, and committing them needs no review, so the
 * dashboard offers a one-click labelled commit when the whole dirty set is one
 * of them. `other` is the user's own work and never gets that treatment.
 */
export type GitFileOrigin = "prd" | "analysis" | "other";

export interface GitStatusFile {
  path: string;
  /** Raw two-character porcelain status code, e.g. " M", "??", "A ". */
  code: string;
  status: GitFileStatus;
  origin: GitFileOrigin;
}

export interface GitStatusResponse {
  isRepo: boolean;
  branch: string | null;
  dirty: boolean;
  files: GitStatusFile[];
  /**
   * The single origin every dirty file shares, or null when the tree is clean
   * or mixed. Only a non-null value of `prd` or `analysis` offers a quick
   * commit — a mixed tree must never be committed wholesale, because the
   * user's own work would ride along.
   */
  scope: GitFileOrigin | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_DIFF_BYTES = 200_000;
/** New/untracked files are read raw (no diff exists yet) — cap the preview. */
const MAX_UNTRACKED_PREVIEW_BYTES = 20_000;

// Paths come back from `git status` and go straight back out as pathspecs,
// so `core.quotepath=false` is load-bearing: with git's default, a non-ASCII
// path is rendered as an escaped, quoted string that matches no file and
// classifies as "other" — which makes the tree look permanently mixed and
// silently disables both the quick commit and auto-commit for the repo.
async function gitCommand(
  projectDir: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const result = await exec("git", args, { cwd: projectDir, timeout: 10_000 });
  return { ok: !result.error && result.exitCode === 0, stdout: result.stdout, stderr: result.stderr };
}

function classify(code: string): GitFileStatus {
  if (code === "??") return "untracked";
  if (code.includes("U") || code === "AA" || code === "DD") return "unmerged";
  if (code[0] === "R" || code[1] === "R") return "renamed";
  if (code.includes("A")) return "added";
  if (code.includes("D")) return "deleted";
  if (code.includes("M")) return "modified";
  return "other";
}

/** Parse `git status --porcelain` output (v1, unquoted paths). */
export function parsePorcelainStatus(
  output: string,
  originOf: (path: string) => GitFileOrigin = () => "other",
): GitStatusFile[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const code = line.slice(0, 2);
      const rest = line.slice(3);
      // Renamed entries read "old -> new" — surface the new path.
      const path = rest.includes(" -> ") ? rest.split(" -> ")[1] : rest;
      return { path, code, status: classify(code), origin: originOf(path) };
    });
}

/**
 * Classify a repo-relative path by which tool owns it.
 *
 * Built from the project's own layout rather than hardcoded `.rex` /
 * `.sourcevision` spellings, because a v2 project keeps both under `.ndx/`.
 * git reports paths with forward slashes on every platform, so the layout's
 * absolute directories are reduced to forward-slash prefixes to compare.
 */
export function makeOriginClassifier(projectDir: string): (path: string) => GitFileOrigin {
  const layout = resolveLayout(projectDir);
  const prefix = (dir: string): string => {
    const rel = relative(projectDir, dir).split(sep).join("/");
    return rel.endsWith("/") ? rel : rel + "/";
  };
  const prd = prefix(layout.rexDir);
  const analysis = prefix(layout.sourcevisionDir);

  return (path) => {
    let p = path.split(sep).join("/");
    if (p.startsWith("./")) p = p.slice(2);
    if (p.startsWith(prd)) return "prd";
    if (p.startsWith(analysis)) return "analysis";
    return "other";
  };
}

/** The one origin every dirty file shares, or null when clean or mixed. */
export function scopeOf(files: GitStatusFile[]): GitFileOrigin | null {
  if (files.length === 0) return null;
  const first = files[0].origin;
  return files.every((f) => f.origin === first) ? first : null;
}

/**
 * Commit subjects for a scoped commit. Constant by design — these commits
 * record a regeneration, so there is nothing per-commit worth composing.
 */
export const SCOPE_MESSAGE: Record<Exclude<GitFileOrigin, "other">, string> = {
  prd: "chore(prd): update the PRD tree",
  analysis: "chore(analysis): refresh the SourceVision scan output",
};

/**
 * Resolve `file` (untrusted query param) against `projectDir` and refuse
 * anything that escapes it — the only thing standing between an arbitrary
 * `?file=` value and reading a file outside the repo for the untracked-file
 * raw-content fallback below (git's own diff/status commands are pathspec-
 * scoped and can't escape the repo on their own).
 */
function resolveWithinProject(projectDir: string, file: string): string | null {
  const projectRoot = resolve(projectDir);
  const resolved = resolve(projectRoot, file);
  if (resolved !== projectRoot && !resolved.startsWith(projectRoot + sep)) return null;
  return resolved;
}

const GITIGNORE_NAME = ".gitignore";

/**
 * Turn a project-relative path into a literal `.gitignore` entry.
 *
 * The leading `/` earns its place twice over: it anchors the entry to this
 * exact path instead of matching the same basename anywhere in the tree,
 * and it keeps a path beginning with `#` or `!` out of comment/negation
 * position. Glob metacharacters in the path itself are escaped so a file
 * literally named `report[1].txt` ignores that file and not a character
 * class.
 */
export function toGitignorePattern(relPath: string): string {
  const escaped = relPath
    .split(sep).join("/")
    .replace(/([*?[\]\\])/g, "\\$1")
    // A trailing space is stripped from a .gitignore line unless escaped.
    .replace(/ $/, "\\ ");
  return `/${escaped}`;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleGitStatus(res: ServerResponse, ctx: ServerContext): Promise<boolean> {
  const isRepo = await gitCommand(ctx.projectDir, ["rev-parse", "--is-inside-work-tree"]);
  if (!isRepo.ok) {
    jsonResponse(res, 200, { isRepo: false, branch: null, dirty: false, files: [], scope: null } satisfies GitStatusResponse);
    return true;
  }

  const [status, branch] = await Promise.all([
    gitCommand(ctx.projectDir, ["-c", "core.quotepath=false", "status", "--porcelain"]),
    gitCommand(ctx.projectDir, ["rev-parse", "--abbrev-ref", "HEAD"]),
  ]);
  const files = parsePorcelainStatus(status.stdout, makeOriginClassifier(ctx.projectDir));

  jsonResponse(res, 200, {
    isRepo: true,
    branch: branch.ok ? branch.stdout.trim() : null,
    dirty: files.length > 0,
    files,
    scope: scopeOf(files),
  } satisfies GitStatusResponse);
  return true;
}

async function handleGitDiff(
  res: ServerResponse,
  ctx: ServerContext,
  file: string,
): Promise<boolean> {
  const resolved = resolveWithinProject(ctx.projectDir, file);
  if (!resolved) {
    errorResponse(res, 400, "file must resolve within the project directory");
    return true;
  }

  const statusResult = await gitCommand(ctx.projectDir, ["-c", "core.quotepath=false", "status", "--porcelain", "--", file]);
  const isUntracked = statusResult.stdout.startsWith("??");

  if (isUntracked) {
    try {
      const stat = statSync(resolved);
      if (!stat.isFile()) {
        jsonResponse(res, 200, { file, diff: null, newFile: true, preview: null, truncated: false });
        return true;
      }
      const raw = readFileSync(resolved, "utf-8");
      const truncated = raw.length > MAX_UNTRACKED_PREVIEW_BYTES;
      jsonResponse(res, 200, {
        file,
        diff: null,
        newFile: true,
        preview: truncated ? raw.slice(0, MAX_UNTRACKED_PREVIEW_BYTES) : raw,
        truncated,
      });
    } catch {
      // Binary or unreadable as UTF-8 — report size only.
      jsonResponse(res, 200, { file, diff: null, newFile: true, preview: null, truncated: false });
    }
    return true;
  }

  // Combined staged + unstaged diff against HEAD, also covers deletions.
  const diff = await gitCommand(ctx.projectDir, ["diff", "--no-color", "HEAD", "--", file]);
  const truncated = diff.stdout.length > MAX_DIFF_BYTES;
  jsonResponse(res, 200, {
    file,
    diff: truncated ? diff.stdout.slice(0, MAX_DIFF_BYTES) : diff.stdout,
    newFile: false,
    preview: null,
    truncated,
  });
  return true;
}

async function handleGitCommit(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  let message: string;
  let scope: Exclude<GitFileOrigin, "other"> | undefined;
  // An unattended commit, fired by the toggle rather than by a click.
  let auto = false;
  try {
    const body = await readBody(req, res);
    const input = JSON.parse(body) as { message?: string; scope?: string; auto?: boolean };
    message = (input.message ?? "").trim();
    if (input.scope !== undefined) {
      if (input.scope !== "prd" && input.scope !== "analysis") {
        errorResponse(res, 400, 'scope must be "prd" or "analysis"');
        return true;
      }
      scope = input.scope;
    }
    auto = input.auto === true;
  } catch {
    errorResponse(res, 400, "Invalid JSON body");
    return true;
  }

  if (auto) {
    if (!scope) {
      errorResponse(res, 400, "An automatic commit must name a scope.");
      return true;
    }
    if (!isFeatureEnabled(ctx.projectDir, "git.autoCommitGenerated")) {
      errorResponse(res, 403, "Auto-commit of generated files is turned off.");
      return true;
    }
  }

  // Paths to stage. Undefined means the historical whole-tree commit.
  let paths: string[] | undefined;

  if (scope) {
    // Re-read status here rather than trusting paths from the client: this is
    // the only thing deciding what gets staged, and a scoped commit that
    // staged a caller-supplied list would be a way to commit anything.
    const current = await gitCommand(ctx.projectDir, ["-c", "core.quotepath=false", "status", "--porcelain"]);
    if (!current.ok) {
      errorResponse(res, 500, `git status failed: ${current.stderr.trim() || "unknown error"}`);
      return true;
    }
    const files = parsePorcelainStatus(current.stdout, makeOriginClassifier(ctx.projectDir));
    if (files.length === 0) {
      errorResponse(res, 409, "Nothing to commit — the working tree is clean.");
      return true;
    }
    const actual = scopeOf(files);
    if (actual !== scope) {
      // The tree changed under us, or the caller guessed. Either way, refuse
      // rather than sweep a mixed tree into a commit labelled as one thing.
      const offending = files.filter((f) => f.origin !== scope).map((f) => f.path);
      errorResponse(
        res,
        409,
        `The working tree is no longer only ${scope} files. Not committing. ` +
          `Unexpected: ${offending.slice(0, 5).join(", ")}${offending.length > 5 ? ", …" : ""}`,
      );
      return true;
    }
    paths = files.map((f) => f.path);
    if (!message) message = SCOPE_MESSAGE[scope];
  }

  if (!message) {
    errorResponse(res, 400, "message is required");
    return true;
  }

  const add = paths
    ? await gitCommand(ctx.projectDir, ["add", "--", ...paths])
    : await gitCommand(ctx.projectDir, ["add", "-A"]);
  if (!add.ok) {
    errorResponse(res, 500, `git add failed: ${add.stderr.trim() || "unknown error"}`);
    return true;
  }

  const commit = paths
    ? await gitCommand(ctx.projectDir, ["commit", "-m", message, "--", ...paths])
    : await gitCommand(ctx.projectDir, ["commit", "-m", message]);
  if (!commit.ok) {
    errorResponse(res, 500, `git commit failed: ${(commit.stderr || commit.stdout).trim() || "unknown error"}`);
    return true;
  }

  const status = await gitCommand(ctx.projectDir, ["-c", "core.quotepath=false", "status", "--porcelain"]);
  jsonResponse(res, 200, {
    ok: true,
    output: commit.stdout.trim(),
    dirty: parsePorcelainStatus(status.stdout).length > 0,
  });
  return true;
}

async function handleGitDiscard(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  let confirmCount: number;
  try {
    const body = await readBody(req, res);
    const input = JSON.parse(body) as { confirmCount?: number };
    if (typeof input.confirmCount !== "number") {
      errorResponse(res, 400, "confirmCount is required");
      return true;
    }
    confirmCount = input.confirmCount;
  } catch {
    errorResponse(res, 400, "Invalid JSON body");
    return true;
  }

  const statusBefore = await gitCommand(ctx.projectDir, ["-c", "core.quotepath=false", "status", "--porcelain"]);
  const filesBefore = parsePorcelainStatus(statusBefore.stdout);
  if (filesBefore.length === 0) {
    jsonResponse(res, 200, { ok: true, discarded: 0, dirty: false });
    return true;
  }
  if (confirmCount !== filesBefore.length) {
    errorResponse(
      res, 409,
      `Stale discard request: expected ${confirmCount} file(s) but found ${filesBefore.length}. Refresh and try again.`,
    );
    return true;
  }

  // Order doesn't matter — reset only touches tracked files, clean only
  // touches untracked ones — but run reset first so a failure there leaves
  // untracked files (the irreversible half) untouched.
  const reset = await gitCommand(ctx.projectDir, ["reset", "--hard", "HEAD"]);
  if (!reset.ok) {
    errorResponse(res, 500, `git reset failed: ${reset.stderr.trim() || "unknown error"}`);
    return true;
  }
  // No -x: only removes untracked files git already considers non-ignored.
  // Gitignored paths (node_modules, .env.local, build output) are never
  // touched by this route.
  const clean = await gitCommand(ctx.projectDir, ["clean", "-fd"]);
  if (!clean.ok) {
    errorResponse(res, 500, `git clean failed: ${clean.stderr.trim() || "unknown error"}`);
    return true;
  }

  const statusAfter = await gitCommand(ctx.projectDir, ["-c", "core.quotepath=false", "status", "--porcelain"]);
  jsonResponse(res, 200, {
    ok: true,
    discarded: filesBefore.length,
    dirty: parsePorcelainStatus(statusAfter.stdout).length > 0,
  });
  return true;
}

/**
 * Append one untracked path to the project's `.gitignore`.
 *
 * Scoped to untracked paths on purpose: adding a *tracked* file to
 * `.gitignore` changes nothing — git keeps tracking what it already tracks
 * — so the request is refused with that explanation rather than written and
 * silently ignored. The write itself is a plain append, reversible by
 * editing the file; `.gitignore` becoming modified is exactly what the
 * caller sees next in the status list.
 */
async function handleGitIgnore(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  let file: string;
  try {
    const body = await readBody(req, res);
    const input = JSON.parse(body) as { file?: string };
    file = (input.file ?? "").trim();
  } catch {
    errorResponse(res, 400, "Invalid JSON body");
    return true;
  }
  if (!file) {
    errorResponse(res, 400, "file is required");
    return true;
  }

  const resolved = resolveWithinProject(ctx.projectDir, file);
  if (!resolved) {
    errorResponse(res, 400, "file must resolve within the project directory");
    return true;
  }
  const rel = relative(resolve(ctx.projectDir), resolved);
  if (!rel) {
    errorResponse(res, 400, "file must name a path inside the project, not the project root");
    return true;
  }
  const bare = rel.split(sep).join("/");
  if (bare === GITIGNORE_NAME) {
    errorResponse(res, 400, ".gitignore cannot ignore itself");
    return true;
  }

  // `:(literal)` because a pathspec is glob-matched by default — a file
  // genuinely named `report[1].txt` would otherwise look absent and be
  // refused as "not untracked".
  const fileStatus = await gitCommand(ctx.projectDir, ["-c", "core.quotepath=false", "status", "--porcelain", "--", `:(literal)${bare}`]);
  if (!fileStatus.stdout.startsWith("??")) {
    errorResponse(
      res, 409,
      `${bare} is not untracked — .gitignore has no effect on a path git already tracks or already ignores (for a tracked path, run \`git rm --cached\` first).`,
    );
    return true;
  }

  const pattern = toGitignorePattern(rel);
  const gitignorePath = join(resolve(ctx.projectDir), GITIGNORE_NAME);
  let existing = "";
  try {
    existing = readFileSync(gitignorePath, "utf-8");
  } catch {
    // No .gitignore yet — the write below creates it.
  }

  // Compare against both the anchored pattern and the bare path: an entry a
  // human wrote by hand is far more likely to be the latter. Reachable even
  // though an ignored path is never untracked — a later `!` negation line
  // un-ignores it, and appending a second identical entry wouldn't help.
  const already = existing
    .split("\n")
    .some((line) => line.trim() === pattern || line.trim() === bare);

  if (!already) {
    const separator = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
    try {
      writeFileSync(gitignorePath, `${existing}${separator}${pattern}\n`, "utf-8");
    } catch (err) {
      errorResponse(res, 500, `Failed to write .gitignore: ${errorMessage(err)}`);
      return true;
    }
  }

  const status = await gitCommand(ctx.projectDir, ["-c", "core.quotepath=false", "status", "--porcelain"]);
  jsonResponse(res, 200, {
    ok: true,
    pattern,
    added: !already,
    dirty: parsePorcelainStatus(status.stdout).length > 0,
  });
  return true;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/** Handle git status/diff/commit API requests. Returns true if handled. */
export async function handleGitRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  const fullUrl = new URL(req.url || "/", "http://localhost");
  const path = fullUrl.pathname;
  const method = req.method || "GET";

  if (!path.startsWith("/api/git/")) return false;

  if (path === "/api/git/status" && method === "GET") {
    return handleGitStatus(res, ctx);
  }

  if (path === "/api/git/diff" && method === "GET") {
    const file = fullUrl.searchParams.get("file");
    if (!file) {
      errorResponse(res, 400, "file query param is required");
      return true;
    }
    return handleGitDiff(res, ctx, file);
  }

  if (path === "/api/git/commit" && method === "POST") {
    return handleGitCommit(req, res, ctx);
  }

  if (path === "/api/git/discard" && method === "POST") {
    return handleGitDiscard(req, res, ctx);
  }

  if (path === "/api/git/ignore" && method === "POST") {
    return handleGitIgnore(req, res, ctx);
  }

  return false;
}
