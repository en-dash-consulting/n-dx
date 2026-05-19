/**
 * Git utilities for reshape audit trail recording.
 *
 * Provides functions to capture git commit hash for reshape rollback support.
 * Falls back gracefully to 'no-git' if not in a git repository.
 *
 * @module core/git-utils
 */

import { exec as foundationExec } from "@n-dx/llm-client";

/**
 * Capture the current git HEAD commit hash.
 *
 * Returns the full commit hash if in a git repository,
 * or 'no-git' if git is not available or not in a repo.
 *
 * @param workDir - Working directory to run git command in (defaults to current directory)
 * @returns Promise<string> - Full commit hash or 'no-git'
 */
export async function captureGitCommitHash(workDir: string = "."): Promise<string> {
  try {
    const result = await foundationExec("git", ["rev-parse", "HEAD"], {
      cwd: workDir,
      timeout: 5000, // 5 second timeout
    });
    const hash = result.stdout?.trim();
    if (hash && hash.length > 0) {
      return hash;
    }
    return "no-git";
  } catch {
    // Not a git repo, git not installed, or command failed
    return "no-git";
  }
}
