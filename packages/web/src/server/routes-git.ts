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
import { exec } from "@n-dx/llm-client";
import type { ServerContext } from "./types.js";
import { jsonResponse, errorResponse, readBody } from "./response-utils.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GitFileStatus =
  | "modified" | "added" | "deleted" | "renamed" | "untracked" | "unmerged" | "other";

export interface GitStatusFile {
  path: string;
  /** Raw two-character porcelain status code, e.g. " M", "??", "A ". */
  code: string;
  status: GitFileStatus;
}

export interface GitStatusResponse {
  isRepo: boolean;
  branch: string | null;
  dirty: boolean;
  files: GitStatusFile[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_DIFF_BYTES = 200_000;
/** New/untracked files are read raw (no diff exists yet) — cap the preview. */
const MAX_UNTRACKED_PREVIEW_BYTES = 20_000;

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
export function parsePorcelainStatus(output: string): GitStatusFile[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const code = line.slice(0, 2);
      const rest = line.slice(3);
      // Renamed entries read "old -> new" — surface the new path.
      const path = rest.includes(" -> ") ? rest.split(" -> ")[1] : rest;
      return { path, code, status: classify(code) };
    });
}

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
    jsonResponse(res, 200, { isRepo: false, branch: null, dirty: false, files: [] } satisfies GitStatusResponse);
    return true;
  }

  const [status, branch] = await Promise.all([
    gitCommand(ctx.projectDir, ["status", "--porcelain"]),
    gitCommand(ctx.projectDir, ["rev-parse", "--abbrev-ref", "HEAD"]),
  ]);
  const files = parsePorcelainStatus(status.stdout);

  jsonResponse(res, 200, {
    isRepo: true,
    branch: branch.ok ? branch.stdout.trim() : null,
    dirty: files.length > 0,
    files,
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

  const statusResult = await gitCommand(ctx.projectDir, ["status", "--porcelain", "--", file]);
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
  try {
    const body = await readBody(req, res);
    const input = JSON.parse(body) as { message?: string };
    message = (input.message ?? "").trim();
  } catch {
    errorResponse(res, 400, "Invalid JSON body");
    return true;
  }
  if (!message) {
    errorResponse(res, 400, "message is required");
    return true;
  }

  const add = await gitCommand(ctx.projectDir, ["add", "-A"]);
  if (!add.ok) {
    errorResponse(res, 500, `git add failed: ${add.stderr.trim() || "unknown error"}`);
    return true;
  }

  const commit = await gitCommand(ctx.projectDir, ["commit", "-m", message]);
  if (!commit.ok) {
    errorResponse(res, 500, `git commit failed: ${(commit.stderr || commit.stdout).trim() || "unknown error"}`);
    return true;
  }

  const status = await gitCommand(ctx.projectDir, ["status", "--porcelain"]);
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

  const statusBefore = await gitCommand(ctx.projectDir, ["status", "--porcelain"]);
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

  const statusAfter = await gitCommand(ctx.projectDir, ["status", "--porcelain"]);
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
  const fileStatus = await gitCommand(ctx.projectDir, ["status", "--porcelain", "--", `:(literal)${bare}`]);
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
      errorResponse(res, 500, `Failed to write .gitignore: ${err instanceof Error ? err.message : String(err)}`);
      return true;
    }
  }

  const status = await gitCommand(ctx.projectDir, ["status", "--porcelain"]);
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
