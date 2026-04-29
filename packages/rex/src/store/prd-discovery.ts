import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { sanitizeBranchName, resolveGitBranch, getFirstCommitDate, generatePRDFilename } from "./branch-naming.js";

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
  /** Always `false` — no JSON file is created by this call. */
  created: boolean;
}

/**
 * Resolve the branch-scoped attribution filename for the current git branch.
 *
 * Does not create any file on disk. The returned filename is used only to
 * set the `sourceFile` attribution on new items written to `prd.md`.
 *
 * Resolution order:
 * 1. If a branch-scoped JSON file already exists on disk, return it (legacy).
 * 2. Otherwise compute the canonical branch-scoped filename for attribution.
 * 3. Falls back to `prd.json` when the branch cannot be resolved.
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

  // Generate the target branch-scoped filename.
  // No JSON file is created — prd.md is the sole writable PRD surface.
  // The filename is used only for item attribution (sourceFile field).
  const date = getFirstCommitDate(cwd);
  const filename = generatePRDFilename(branch, date);
  const targetPath = join(rexDir, filename);

  return { filename, path: targetPath, created: false };
}
