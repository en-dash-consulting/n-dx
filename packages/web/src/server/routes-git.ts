/**
 * Working-tree git status API routes — lets the dashboard show uncommitted
 * changes and commit them without leaving the browser.
 *
 * GET  /api/git/status  — dirty files + current branch
 * GET  /api/git/diff    — diff for one file (?file=<path>)
 * POST /api/git/commit  — stage everything currently dirty and commit
 * POST /api/git/discard — hard-reset tracked changes and remove untracked
 *                         files (git reset --hard HEAD + git clean -fd)
 *
 * Deliberately narrow: read-only status/diff plus two scoped mutations
 * (stage-all + commit, and discard-all). No branch switching, merge,
 * rebase, partial staging, or conflict resolution here — those carry real
 * destructive-action risk and are better served by a terminal or IDE.
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
import { readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
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
    const body = await readBody(req);
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
    const body = await readBody(req);
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

  return false;
}
