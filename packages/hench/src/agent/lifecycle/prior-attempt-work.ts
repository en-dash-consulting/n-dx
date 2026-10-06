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
  /** Task files (changed by earlier runs) with commits since the first attempt. */
  files: string[];
}

/** Bookkeeping the completion check also ignores (see validation/completion.ts). */
const BOOKKEEPING_EXCLUDES = [":(exclude).rex", ":(exclude).hench", ":(exclude).hench-commit-msg.txt"];

/**
 * Find the task's files that earlier attempts committed to the current branch.
 *
 * The first attempt is the oldest run of the task whose `startHead` is still
 * an ancestor of HEAD; the task's files are the union of the earlier runs'
 * `structuredSummary.filesChanged`. Returns undefined when there is no such
 * run, no file overlap, or git cannot answer.
 */
export async function findPriorAttemptWork(opts: {
  projectDir: string;
  taskId: string;
  runHistory?: readonly RunRecord[];
}): Promise<PriorAttemptWork | undefined> {
  const earlier = taskRunsNewestFirst(opts.taskId, opts.runHistory ?? []).reverse();
  const taskFiles = new Set(earlier.flatMap((r) => r.structuredSummary?.filesChanged ?? []));
  if (taskFiles.size === 0) return undefined;

  let firstHead: string | undefined;
  for (const run of earlier) {
    if (run.startHead && (await isAncestorOfHead(opts.projectDir, run.startHead))) {
      firstHead = run.startHead;
      break;
    }
  }
  if (!firstHead) return undefined;

  const diff = await exec("git", ["diff", "--name-only", `${firstHead}..HEAD`, "--", ".", ...BOOKKEEPING_EXCLUDES], {
    cwd: opts.projectDir,
    timeout: 10_000,
  });
  if (diff.exitCode !== 0) return undefined;

  const files = diff.stdout.split("\n").map((l) => l.trim()).filter((f) => taskFiles.has(f));
  if (files.length === 0) return undefined;
  return { runIds: earlier.map((r) => r.id.slice(0, 8)), files };
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
