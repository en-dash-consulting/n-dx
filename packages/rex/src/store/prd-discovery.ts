import { readdir, stat, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sanitizeBranchName, resolveGitBranch, getFirstCommitDate, generatePRDFilename } from "./branch-naming.js";
import { SCHEMA_VERSION } from "../schema/v1.js";
import { toCanonicalJSON } from "../core/canonical.js";
import type { PRDDocument } from "../schema/v1.js";

const PRD_FILENAME_RE = /^prd_(.+)_(\d{4}-\d{2}-\d{2})\.json$/;

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

export function parsePRDBranchSegment(filename: string): string | null {
  const match = PRD_FILENAME_RE.exec(filename);
  return match ? match[1] : null;
}

/**
 * Extract the YYYY-MM-DD date segment from a branch-scoped PRD filename.
 * Returns `null` for `prd.json` or any filename that doesn't match the
 * branch-scoped pattern.
 */
export function parsePRDFileDate(filename: string): string | null {
  const match = PRD_FILENAME_RE.exec(filename);
  return match ? match[2] : null;
}

export async function findPRDFileForBranch(
  rexDir: string,
  branch: string,
): Promise<string | null> {
  const sanitized = sanitizeBranchName(branch);
  if (!sanitized) return null;

  const files = await discoverPRDFiles(rexDir);
  for (const file of files) {
    const segment = parsePRDBranchSegment(file);
    if (segment === sanitized) {
      return file;
    }
  }

  return null;
}

/** Result of resolving a branch-scoped PRD file. */
export interface PRDFileResolution {
  /** Branch-scoped filename (e.g. `prd_feature-x_2025-04-01.json`). */
  filename: string;
  /** Full path to the file. */
  path: string;
  /** `true` when the file was created by this call (first add on this branch). */
  created: boolean;
}

/**
 * Resolve (or create) the branch-scoped PRD file for the current git branch.
 *
 * Resolution order:
 * 1. If a branch file already exists for this branch, return it unchanged.
 * 2. If no branch file exists but `prd.json` does, rename `prd.json` to the
 *    new branch-scoped name (one-time migration) and return it.
 * 3. If neither exists, create an empty branch-scoped PRD file.
 * 4. Falls back to `prd.json` when the branch cannot be resolved.
 */
export async function resolvePRDFile(
  rexDir: string,
  cwd: string,
): Promise<PRDFileResolution> {
  const branch = resolveGitBranch(cwd);
  if (!branch || branch === "unknown") {
    return { filename: "prd.json", path: join(rexDir, "prd.json"), created: false };
  }

  // Return existing branch file when found
  const existing = await findPRDFileForBranch(rexDir, branch);
  if (existing) {
    return { filename: existing, path: join(rexDir, existing), created: false };
  }

  // Generate the target branch-scoped filename
  const date = getFirstCommitDate(cwd);
  const filename = generatePRDFilename(branch, date);
  const targetPath = join(rexDir, filename);

  // Migrate prd.json → branch file when prd.json exists
  const canonicalPath = join(rexDir, "prd.json");
  try {
    await stat(canonicalPath);
    await rename(canonicalPath, targetPath);
    return { filename, path: targetPath, created: false };
  } catch {
    // prd.json does not exist — fall through to create an empty branch file
  }

  // Create an empty branch-scoped PRD file titled with the branch name
  const sanitized = sanitizeBranchName(branch);
  const doc: PRDDocument = {
    schema: SCHEMA_VERSION,
    title: sanitized,
    items: [],
  };
  await writeFile(targetPath, toCanonicalJSON(doc), "utf-8");
  return { filename, path: targetPath, created: true };
}
