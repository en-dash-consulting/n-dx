/**
 * Canonical JSON serialization shared across all packages.
 *
 * Produces deterministic, human-readable output with 2-space indent
 * and a trailing newline — the standard format for all .json files
 * in the n-dx project.
 */

/**
 * Serialize data to pretty-printed JSON with a trailing newline.
 *
 * Used throughout the monorepo for writing config files, PRD documents,
 * analysis output, and run records. The trailing newline ensures
 * POSIX-compliant text files and clean git diffs.
 */
export function toCanonicalJSON(data: unknown): string {
  return JSON.stringify(data, null, 2) + "\n";
}
