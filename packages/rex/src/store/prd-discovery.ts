/**
 * PRD file discovery and selection for branch-scoped multi-file management.
 *
 * Scans the `.rex/` directory for `prd_{branch}_{date}.json` files, matches
 * them against the current git branch, and either returns the existing file
 * or creates a new empty PRD. This is the single entry point for resolving
 * which PRD file to use for the current branch context.
 *
 * @module rex/store/prd-discovery
 */

import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SCHEMA_VERSION } from "../schema/v1.js";
import { toCanonicalJSON } from "../core/canonical.js";
import {
  sanitizeBranchName,
  resolveGitBranch,
  getFirstCommitDate,
  generatePRDFilename,
} from "./branch-naming.js";
import type { PRDDocument } from "../schema/v1.js";

/**
 * Pattern matching `prd_{branch}_{YYYY-MM-DD}.json`.
 *
 * Greedy `.+` captures the branch segment (which may contain underscores),
 * and the date is always the last `_YYYY-MM-DD` before `.json`.
 */
const PRD_FILENAME_RE = /^prd_(.+)_(\d{4}-\d{2}-\d{2})\.json$/;

/** Result of resolving a PRD file for the current branch. */
export interface PRDFileResolution {
  /** The filename (not full path) of the resolved PRD file. */
  filename: string;
  /** Full absolute path to the PRD file. */
  path: string;
  /** `true` when a new file was created; `false` when an existing file was found. */
  created: boolean;
}

/**
 * Discover all `prd_*.json` files in the `.rex/` directory.
 *
 * Returns filenames (not full paths) sorted lexicographically.
 * Ignores the legacy `prd.json`, lock files, and temp files.
 */
export async function discoverPRDFiles(rexDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(rexDir);
  } catch {
    return [];
  }

  return entries
    .filter((name) => PRD_FILENAME_RE.test(name))
    .sort();
}

/**
 * Parse the sanitized branch segment from a PRD filename.
 *
 * @returns The branch segment, or `null` if the filename doesn't match
 *          the `prd_{branch}_{date}.json` convention.
 */
export function parsePRDBranchSegment(filename: string): string | null {
  const match = PRD_FILENAME_RE.exec(filename);
  return match ? match[1] : null;
}

/**
 * Extract the creation date from a PRD filename.
 *
 * @returns The `YYYY-MM-DD` date string, or `null` for legacy `prd.json`
 *          and other files that don't match the naming convention.
 */
export function parsePRDFileDate(filename: string): string | null {
  const match = PRD_FILENAME_RE.exec(filename);
  return match ? match[2] : null;
}

/**
 * Find an existing PRD file matching the given branch name.
 *
 * The branch name is sanitized before comparison — callers can pass
 * the raw git branch (e.g. `feature/thing`).
 *
 * @returns The matching filename, or `null` if none matches.
 */
export async function findPRDFileForBranch(
  rexDir: string,
  branch: string,
): Promise<string | null> {
  const sanitized = sanitizeBranchName(branch);
  const files = await discoverPRDFiles(rexDir);

  for (const file of files) {
    const segment = parsePRDBranchSegment(file);
    if (segment === sanitized) {
      return file;
    }
  }

  return null;
}

/**
 * Resolve the PRD file for the current branch context.
 *
 * This is the single entry point for determining which PRD file to use:
 *
 * 1. Detects the current git branch via `resolveGitBranch`.
 * 2. Scans `.rex/` for existing `prd_*.json` files.
 * 3. If a file matches the current branch, returns its path.
 * 4. Otherwise, creates a new empty PRD file with the correct naming
 *    convention and returns its path.
 *
 * @param rexDir  Path to the `.rex/` directory.
 * @param cwd     Working directory for git operations (typically the project root).
 * @returns Resolution result with filename, path, and whether a new file was created.
 */
export async function resolvePRDFile(
  rexDir: string,
  cwd: string,
): Promise<PRDFileResolution> {
  const branch = resolveGitBranch(cwd);

  // Check for an existing file matching this branch
  const existing = await findPRDFileForBranch(rexDir, branch);
  if (existing) {
    return {
      filename: existing,
      path: join(rexDir, existing),
      created: false,
    };
  }

  // No match — create a new PRD file
  const date = getFirstCommitDate(cwd);
  const filename = generatePRDFilename(branch, date);
  const filePath = join(rexDir, filename);

  const doc: PRDDocument = {
    schema: SCHEMA_VERSION,
    title: branch,
    items: [],
  };

  await writeFile(filePath, toCanonicalJSON(doc), "utf-8");

  return {
    filename,
    path: filePath,
    created: true,
  };
}
