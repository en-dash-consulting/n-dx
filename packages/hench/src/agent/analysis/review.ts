import { createInterface } from "node:readline";
import { execStdout } from "../../process/exec.js";
import { section, subsection, info } from "../../types/output.js";

/**
 * Review mode — shows proposed changes and prompts for approval
 * before committing task completion.
 *
 * The review gate sits between completion validation (changes exist,
 * tests pass) and status updates (marking the task complete). When
 * `--review` is active, the user sees a full diff and can approve
 * or reject the agent's work.
 */

export interface ReviewResult {
  approved: boolean;
  /** Reason for rejection, if rejected. */
  reason?: string;
}

export interface ReviewDiff {
  /** Full diff output (git diff HEAD). */
  diff: string;
  /** Summary stat line (git diff --stat HEAD). */
  stat: string;
}

const DEFAULT_TIMEOUT = 30_000;

/**
 * Collect the current diff for review.
 */
export async function collectReviewDiff(
  projectDir: string,
  timeout = DEFAULT_TIMEOUT,
): Promise<ReviewDiff> {
  const [diff, stat] = await Promise.all([
    execStdout("git", ["diff", "HEAD"], { cwd: projectDir, timeout }),
    execStdout("git", ["diff", "--stat", "HEAD"], { cwd: projectDir, timeout }),
  ]);

  return {
    diff: diff.trim(),
    stat: stat.trim(),
  };
}

/**
 * Display the review UI and prompt for approval.
 *
 * Shows:
 * 1. Diff stat summary
 * 2. Full diff
 * 3. Approve/reject prompt
 *
 * The `promptFn` parameter allows injection for testing.
 */
export async function promptReview(
  reviewDiff: ReviewDiff,
  promptFn?: (question: string) => Promise<string>,
): Promise<ReviewResult> {
  section("Review");

  subsection("Changes");
  info(reviewDiff.stat);

  subsection("Diff");
  info(reviewDiff.diff);

  info("");

  const askUser = promptFn ?? defaultPrompt;
  const answer = await askUser("Approve these changes? [Y/n] ");

  const normalized = answer.trim().toLowerCase();

  // Empty string or "y"/"yes" → approve; anything else → reject
  if (normalized === "" || normalized === "y" || normalized === "yes") {
    return { approved: true };
  }

  return {
    approved: false,
    reason: "Changes rejected by reviewer",
  };
}

function defaultPrompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Revert all uncommitted changes in the working tree.
 * Used when the reviewer rejects the agent's work.
 */
export async function revertChanges(
  projectDir: string,
  timeout = DEFAULT_TIMEOUT,
): Promise<void> {
  // Unstage everything, then discard working tree changes + untracked files
  await execStdout("git", ["reset", "HEAD", "."], { cwd: projectDir, timeout });
  await execStdout("git", ["checkout", "."], { cwd: projectDir, timeout });
  await execStdout("git", ["clean", "-fd"], { cwd: projectDir, timeout });
}
