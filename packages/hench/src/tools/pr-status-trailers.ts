/**
 * PR status-trailer reader.
 *
 * Extracts `N-DX-Status:` trailers from git commit messages in a branch range
 * so that PR-description generators and dashboards can surface which PRD items
 * were closed by commits on a branch.
 *
 * Trailer format (written by `shared.ts → performCommitPromptIfNeeded`):
 *   N-DX-Status: <item-id> <from-status> → <to-status>
 *
 * This format is intentionally compatible with `git interpret-trailers --parse`
 * and round-trips cleanly through `git log --format='%(trailers)'`.
 *
 * @module
 */

import { execStdout } from "../process/exec.js";

/** A parsed `N-DX-Status:` trailer extracted from a commit. */
export interface StatusTrailerEntry {
  /** The full commit SHA. */
  commitHash: string;
  /** PRD item ID (as stored in the folder tree, e.g. a UUID or slug). */
  itemId: string;
  /** Status before the transition (e.g. "in_progress"). */
  fromStatus: string;
  /** Status after the transition (e.g. "completed"). */
  toStatus: string;
}

/**
 * Regex that matches `N-DX-Status: <id> <from> → <to>` lines.
 * The arrow is the Unicode right-arrow (U+2192), the same character written
 * by `performCommitPromptIfNeeded`.
 */
const TRAILER_RE = /^N-DX-Status:\s+(\S+)\s+(\S+)\s+→\s+(\S+)\s*$/;

/**
 * Extract all `N-DX-Status:` trailers from commits in the given range.
 *
 * @param projectDir - Absolute path to the git working tree root.
 * @param range - git commit range passed to `git log`, e.g. `"main..HEAD"` or
 *   `"origin/main..HEAD"`. If omitted, defaults to `"HEAD"` (only the most
 *   recent commit — useful for testing).
 * @returns Ordered list of trailer entries (oldest → newest commit).
 */
export async function extractStatusTrailers(
  projectDir: string,
  range = "HEAD",
): Promise<StatusTrailerEntry[]> {
  // Two-pass approach: first collect all commit SHAs in the range (oldest first),
  // then retrieve each commit's full body to parse trailers. This avoids the
  // fragile null-byte separator tricks that break across shells and platforms.
  let shaList: string;
  try {
    shaList = await execStdout(
      "git",
      ["log", "--format=%H", "--reverse", range],
      { cwd: projectDir, timeout: 15_000 },
    );
  } catch {
    return [];
  }

  const shas = shaList.trim().split("\n").map((s) => s.trim()).filter((s) => s.length === 40);
  if (shas.length === 0) return [];

  const results: StatusTrailerEntry[] = [];

  for (const sha of shas) {
    let body: string;
    try {
      body = await execStdout(
        "git",
        ["log", "-1", "--format=%B", sha],
        { cwd: projectDir, timeout: 10_000 },
      );
    } catch {
      continue;
    }

    for (const line of body.split("\n")) {
      const m = TRAILER_RE.exec(line);
      if (m) {
        results.push({
          commitHash: sha,
          itemId: m[1],
          fromStatus: m[2],
          toStatus: m[3],
        });
      }
    }
  }

  return results;
}

/**
 * Build a PR description section that lists the PRD items closed on the branch.
 *
 * Returns an empty string when no status trailers are found (so callers can
 * skip the section entirely rather than append an empty heading).
 *
 * @param trailers - Parsed trailer entries from {@link extractStatusTrailers}.
 */
export function formatPrStatusSection(trailers: StatusTrailerEntry[]): string {
  // Keep only transitions that ended in "completed"
  const closed = trailers.filter((t) => t.toStatus === "completed");
  if (closed.length === 0) return "";

  const lines: string[] = ["## Closed PRD items", ""];
  for (const entry of closed) {
    const shortSha = entry.commitHash.slice(0, 7);
    lines.push(`- \`${entry.itemId}\` — ${entry.fromStatus} → ${entry.toStatus} (${shortSha})`);
  }
  return lines.join("\n");
}
