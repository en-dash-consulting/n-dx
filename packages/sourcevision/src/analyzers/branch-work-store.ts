/**
 * Branch work record storage — persistent JSON files for tracking
 * completed PRD items on a per-branch basis.
 *
 * ## File layout
 *
 * Records are stored under `.sourcevision/` with branch-specific names:
 *
 * ```
 * .sourcevision/
 *   branch-work-feature-add-auth.json
 *   branch-work-release-v2.0.json
 * ```
 *
 * ## Validation
 *
 * All reads and writes are validated against `BranchWorkRecordSchema`
 * (Zod). Invalid data is rejected on write; corrupted files return `null`
 * on read — the same graceful degradation pattern used by the collector.
 *
 * @module sourcevision/analyzers/branch-work-store
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_DIRS } from "@n-dx/llm-client";
import { BranchWorkRecordSchema } from "../schema/validate.js";
import type { BranchWorkRecord } from "../schema/v1.js";

// ---------------------------------------------------------------------------
// Branch name sanitization
// ---------------------------------------------------------------------------

/**
 * Sanitize a branch name for use in a filename.
 *
 * Replaces characters that are problematic in filenames (slashes, `@`, spaces,
 * colons, tildes, carets, question marks, asterisks, brackets) with dashes,
 * collapses consecutive dashes, and trims leading/trailing dashes.
 *
 * @example
 * sanitizeBranchName("feature/add-auth")  // → "feature-add-auth"
 * sanitizeBranchName("release/v2.0@rc1")  // → "release-v2.0-rc1"
 */
export function sanitizeBranchName(branch: string): string {
  return branch
    .replace(/[/@:~^?*[\]\\]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Compute the file path for a branch work record.
 *
 * @param projectDir - Project root directory
 * @param branch     - Git branch name (will be sanitized)
 * @returns Absolute path to the record file
 */
export function branchWorkRecordPath(projectDir: string, branch: string): string {
  const sanitized = sanitizeBranchName(branch);
  return join(projectDir, PROJECT_DIRS.SOURCEVISION, `branch-work-${sanitized}.json`);
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

/**
 * Save a branch work record to disk.
 *
 * - Validates the record against the Zod schema before writing.
 * - Creates the `.sourcevision/` directory if it does not exist.
 * - Updates the `updatedAt` timestamp to the current time.
 * - Writes pretty-printed JSON with a trailing newline.
 *
 * @throws If the record fails schema validation
 */
export async function saveBranchWorkRecord(
  projectDir: string,
  record: BranchWorkRecord,
): Promise<void> {
  // Update the timestamp before validation
  const toSave: BranchWorkRecord = {
    ...record,
    updatedAt: new Date().toISOString(),
  };

  // Validate before writing — fail fast on bad data
  const result = BranchWorkRecordSchema.safeParse(toSave);
  if (!result.success) {
    const messages = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid branch work record: ${messages}`);
  }

  // Ensure directory exists
  const svDir = join(projectDir, PROJECT_DIRS.SOURCEVISION);
  if (!existsSync(svDir)) {
    await mkdir(svDir, { recursive: true });
  }

  const filePath = branchWorkRecordPath(projectDir, record.branch);
  const json = JSON.stringify(toSave, null, 2) + "\n";
  await writeFile(filePath, json, "utf-8");
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * Load a branch work record from disk.
 *
 * Returns `null` when the file does not exist, cannot be parsed as JSON,
 * or fails schema validation. This mirrors the graceful degradation
 * pattern used by the branch work collector.
 *
 * @param projectDir - Project root directory
 * @param branch     - Git branch name
 */
export async function loadBranchWorkRecord(
  projectDir: string,
  branch: string,
): Promise<BranchWorkRecord | null> {
  const filePath = branchWorkRecordPath(projectDir, branch);

  if (!existsSync(filePath)) return null;

  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);

    const result = BranchWorkRecordSchema.safeParse(parsed);
    if (!result.success) return null;

    return result.data as BranchWorkRecord;
  } catch {
    return null;
  }
}
