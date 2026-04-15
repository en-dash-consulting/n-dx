/**
 * Project metadata API routes — project name, description, and git info.
 *
 * Extracts project information from package.json and git, then exposes it
 * through a cached API endpoint for web UI consumption.
 *
 * GET /api/project — project metadata (name, description, git info)
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { exec } from "@n-dx/llm-client";
import type { ServerContext } from "./types.js";
import { jsonResponse } from "./response-utils.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitInfo {
  /** Current branch name, or null if detached/unavailable. */
  branch: string | null;
  /** Short SHA of HEAD, or null if unavailable. */
  sha: string | null;
  /** Remote origin URL, or null if no remotes configured. */
  remoteUrl: string | null;
  /** Repository name extracted from remote URL, or null. */
  repoName: string | null;
}

export interface ProjectMetadata {
  /** Project name from package.json, or directory basename as fallback. */
  name: string;
  /** Project description from package.json, or null. */
  description: string | null;
  /** Package version from package.json, or null. */
  version: string | null;
  /** Git information, or null if not a git repository. */
  git: GitInfo | null;
  /** Source of the project name: "package.json" or "directory". */
  nameSource: "package.json" | "directory";
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  metadata: ProjectMetadata;
  projectDir: string;
  timestamp: number;
}

/** Cache TTL in milliseconds (30 seconds). */
const CACHE_TTL_MS = 30_000;

let cache: CacheEntry | null = null;

/** Clear the metadata cache (exposed for testing). */
export function clearProjectMetadataCache(): void {
  cache = null;
}

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

/** Read and parse package.json from the project directory. */
function readPackageJson(
  projectDir: string,
): { name?: string; description?: string; version?: string } | null {
  const pkgPath = join(projectDir, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    return JSON.parse(readFileSync(pkgPath, "utf-8"));
  } catch {
    return null;
  }
}

/** Run a git command in the project directory, returning trimmed stdout or null on failure. */
async function gitCommand(projectDir: string, args: string[]): Promise<string | null> {
  const result = await exec("git", args, { cwd: projectDir, timeout: 5_000 });
  if (result.exitCode !== 0 || result.error) return null;
  const output = result.stdout.trim();
  return output || null;
}

/**
 * Extract repository name from a git remote URL.
 *
 * Handles common formats:
 *   - https://github.com/user/repo.git → repo
 *   - git@github.com:user/repo.git     → repo
 *   - https://github.com/user/repo     → repo
 */
export function extractRepoName(remoteUrl: string): string | null {
  if (!remoteUrl) return null;
  // Remove trailing .git and slashes
  const cleaned = remoteUrl.replace(/\.git\/?$/, "").replace(/\/+$/, "");
  // Get the last path segment
  const parts = cleaned.split(/[/:]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

/** Extract git information from the project directory. */
async function extractGitInfo(projectDir: string): Promise<GitInfo | null> {
  // Check if this is a git repo by trying rev-parse
  const isGit = await gitCommand(projectDir, ["rev-parse", "--is-inside-work-tree"]);
  if (isGit !== "true") return null;

  const [branch, sha, remoteUrl] = await Promise.all([
    gitCommand(projectDir, ["rev-parse", "--abbrev-ref", "HEAD"]),
    gitCommand(projectDir, ["rev-parse", "--short", "HEAD"]),
    gitCommand(projectDir, ["config", "--get", "remote.origin.url"]),
  ]);
  const repoName = remoteUrl ? extractRepoName(remoteUrl) : null;

  return { branch, sha, remoteUrl, repoName };
}

/** Build project metadata for the given directory. */
export async function extractProjectMetadata(projectDir: string): Promise<ProjectMetadata> {
  const pkg = readPackageJson(projectDir);
  const git = await extractGitInfo(projectDir);

  const pkgName = pkg?.name;
  const hasPackageName = pkgName != null && pkgName.length > 0;

  return {
    name: hasPackageName ? pkgName : basename(projectDir),
    description: pkg?.description ?? null,
    version: pkg?.version ?? null,
    git,
    nameSource: hasPackageName ? "package.json" : "directory",
  };
}

// ---------------------------------------------------------------------------
// Cached accessor
// ---------------------------------------------------------------------------

/** Get project metadata, using cache when available and project dir hasn't changed. */
async function getProjectMetadata(ctx: ServerContext): Promise<ProjectMetadata> {
  const now = Date.now();

  if (
    cache &&
    cache.projectDir === ctx.projectDir &&
    now - cache.timestamp < CACHE_TTL_MS
  ) {
    return cache.metadata;
  }

  const metadata = await extractProjectMetadata(ctx.projectDir);
  cache = { metadata, projectDir: ctx.projectDir, timestamp: now };
  return metadata;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

const PROJECT_PREFIX = "/api/project";

/** Handle project metadata API requests. Returns true if the request was handled. */
export async function handleProjectRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  const url = req.url || "/";
  const method = req.method || "GET";

  if (method !== "GET" || url !== PROJECT_PREFIX) return false;

  try {
    const metadata = await getProjectMetadata(ctx);
    jsonResponse(res, 200, metadata);
  } catch {
    jsonResponse(res, 200, {
      name: basename(ctx.projectDir),
      description: null,
      version: null,
      git: null,
      nameSource: "directory" as const,
    });
  }

  return true;
}
