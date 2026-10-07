/**
 * Detecting task work that earlier attempts already committed (#539 item 1).
 *
 * A forked session that ends with no diff and no edit calls looks like a
 * read-only refusal (#473). On a retry of work an earlier attempt committed it
 * is something else: the agent correctly found nothing left to do. Re-spawning
 * cold would only re-verify everything, so the refusal check stands down when
 * this module reports that the task's files are already on the branch.
 *
 * Every git failure reads as "no prior work", which keeps the #473 behaviour.
 */

import type { RunRecord } from "../../schema/index.js";
import { exec } from "../../process/exec.js";
import { isAncestorOfHead } from "../../process/git-ancestry.js";
import { taskRunsNewestFirst } from "./gate-only-retry.js";

/** Earlier attempts' commits that touch the files those attempts changed. */
export interface PriorAttemptWork {
  /** Short ids of the earlier runs of this task, oldest first. */
  runIds: string[];
  /** Files touched by the earlier runs' own commits that are still in HEAD. */
  files: string[];
}

/** Bookkeeping the completion check also ignores (see validation/completion.ts). */
const BOOKKEEPING_EXCLUDES = [":(exclude).rex", ":(exclude).hench", ":(exclude).hench-commit-msg.txt"];

/**
 * Find the task's files that earlier attempts committed to the current branch.
 *
 * Only commits recorded on the task's own earlier runs (`RunRecord.commits`)
 * that are still ancestors of HEAD count; the files are those the commits
 * touched. Uncommitted edits and other tasks' commits to the same files never
 * count. Returns undefined when there is no such commit or git cannot answer.
 */
export async function findPriorAttemptWork(opts: {
  projectDir: string;
  taskId: string;
  runHistory?: readonly RunRecord[];
}): Promise<PriorAttemptWork | undefined> {
  const earlier = taskRunsNewestFirst(opts.taskId, opts.runHistory ?? []).reverse();
  const shas = new Set(earlier.flatMap((r) => (r.commits ?? []).map((c) => c.sha)));

  const files = new Set<string>();
  for (const sha of shas) {
    if (!(await isAncestorOfHead(opts.projectDir, sha))) continue;
    const shown = await exec(
      "git",
      ["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", sha, "--", ".", ...BOOKKEEPING_EXCLUDES],
      { cwd: opts.projectDir, timeout: 10_000 },
    );
    if (shown.exitCode !== 0) return undefined;
    for (const line of shown.stdout.split("\n")) {
      const file = line.trim();
      if (file) files.add(file);
    }
  }
  if (files.size === 0) return undefined;
  return { runIds: earlier.map((r) => r.id.slice(0, 8)), files: [...files] };
}

/** Diagnostics note recorded when the read-only refusal is suppressed. */
export function suppressionNote(work: PriorAttemptWork): string {
  return `read_only_refusal_suppressed: prior attempts committed ${work.files.length} task files`;
}

/**
 * The no-changes rejection when earlier attempts already committed the work:
 * says what happened and the two ways forward.
 */
export function describePriorAttemptWork(work: PriorAttemptWork, taskId: string): string {
  return (
    `This task's files were already committed by earlier attempts (runs ${work.runIds.join(", ")}; ` +
    `${work.files.length} file${work.files.length === 1 ? "" : "s"}), so this attempt had nothing left to change. ` +
    "If those runs failed only at the test gate, retry the task for a gate-only run. " +
    `Otherwise verify the work and mark the task done with: ndx rex update ${taskId} --status=completed`
  );
}
