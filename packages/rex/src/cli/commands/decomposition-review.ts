/**
 * Decomposition confirmation UI for the proposal review workflow.
 *
 * After the LoE decomposition pass annotates oversized tasks with their
 * decomposed children, this module presents each decomposed task to the
 * user with three choices:
 *
 * - **Accept decomposed** — add child tasks, discard the parent
 * - **Keep original** — add the parent task unmodified
 * - **Skip** — omit the task entirely
 *
 * Non-interactive mode (--accept / --yes) defaults to accepting the
 * decomposed version.
 *
 * @module rex/cli/commands/decomposition-review
 */

import { createInterface } from "node:readline";
import type { Proposal, ProposalTask, ProposalFeature } from "../../analyze/index.js";
import { info } from "../output.js";

// ── Types ──

export type DecompositionChoice = "accept_decomposed" | "keep_original" | "skip";

export interface DecompositionReviewResult {
  /** Proposals with decomposition choices applied. */
  proposals: Proposal[];
  /** Summary of decisions made. */
  summary: DecompositionReviewSummary;
}

export interface DecompositionReviewSummary {
  /** Total number of decomposed tasks reviewed. */
  total: number;
  /** Count of tasks where decomposed children were accepted. */
  acceptedDecomposed: number;
  /** Count of tasks where the original was kept. */
  keptOriginal: number;
  /** Count of tasks that were skipped entirely. */
  skipped: number;
}

// ── Display formatting ──

/**
 * Format a single decomposed task with its children for display.
 * Shows the parent task with LoE annotation and children indented beneath.
 *
 * Pure function — no I/O.
 */
export function formatDecomposedTask(task: ProposalTask, featureTitle: string): string {
  const decomp = task.decomposition;
  if (!decomp) return "";

  const loeLabel = task.loe !== undefined ? `${task.loe}w` : "?";
  const thresholdLabel = `${decomp.thresholdWeeks}w`;
  const pri = task.priority ? ` [${task.priority}]` : "";

  const lines: string[] = [];
  lines.push(`  ⚡ Auto-decomposed (LoE: ${loeLabel} > ${thresholdLabel} threshold)`);
  lines.push(`  [task] ${task.title}${pri}`);
  if (task.description) {
    lines.push(`    ${task.description}`);
  }
  lines.push(`  Decomposed into ${decomp.children.length} child task${decomp.children.length === 1 ? "" : "s"}:`);
  for (const child of decomp.children) {
    const childPri = child.priority ? ` [${child.priority}]` : "";
    const childLoe = child.loe !== undefined ? ` (LoE: ${child.loe}w)` : "";
    lines.push(`    ↳ ${child.title}${childPri}${childLoe}`);
  }

  return lines.join("\n");
}

/**
 * Format decomposed tasks inline within proposal display output.
 * This extends the standard proposal format to show decomposition annotations.
 *
 * Pure function — no I/O.
 */
export function formatProposalsWithDecomposition(proposals: Proposal[]): string {
  const lines: string[] = [];
  for (const p of proposals) {
    lines.push(`[epic] ${p.epic.title} (from: ${p.epic.source})`);
    for (const f of p.features) {
      lines.push(`  [feature] ${f.title} (from: ${f.source})`);
      for (const t of f.tasks) {
        const pri = t.priority ? ` [${t.priority}]` : "";
        if (t.decomposition) {
          const loeLabel = t.loe !== undefined ? `${t.loe}w` : "?";
          const thresholdLabel = `${t.decomposition.thresholdWeeks}w`;
          lines.push(`    [task] ${t.title}${pri} ⚡ decomposed (LoE: ${loeLabel} > ${thresholdLabel} threshold)`);
          for (const child of t.decomposition.children) {
            const childPri = child.priority ? ` [${child.priority}]` : "";
            const childLoe = child.loe !== undefined ? ` (LoE: ${child.loe}w)` : "";
            lines.push(`      ↳ ${child.title}${childPri}${childLoe}`);
          }
        } else {
          lines.push(`    [task] ${t.title}${pri} (from: ${t.sourceFile})`);
        }
      }
    }
  }
  return lines.join("\n");
}

// ── Decomposition counting ──

/** Count total decomposed tasks across all proposals. */
export function countDecomposedTasks(proposals: Proposal[]): number {
  let count = 0;
  for (const p of proposals) {
    for (const f of p.features) {
      for (const t of f.tasks) {
        if (t.decomposition) count++;
      }
    }
  }
  return count;
}

// ── Choice application (pure) ──

/**
 * Apply a decomposition choice to a single task.
 * Returns the task(s) that should replace it in the feature's task list.
 *
 * - `accept_decomposed`: returns the decomposed children
 * - `keep_original`: returns the original task with decomposition stripped
 * - `skip`: returns empty array (task omitted)
 *
 * Pure function — no I/O.
 */
export function applyDecompositionChoice(
  task: ProposalTask,
  choice: DecompositionChoice,
): ProposalTask[] {
  if (!task.decomposition) return [task];

  switch (choice) {
    case "accept_decomposed":
      return task.decomposition.children;
    case "keep_original": {
      const { decomposition: _, ...original } = task;
      return [original];
    }
    case "skip":
      return [];
  }
}

/**
 * Resolve all decomposition annotations in proposals using the provided
 * choice function. For each decomposed task, the chooser is called to
 * determine what to do.
 *
 * Pure function — the chooser may be async for interactive I/O.
 */
export async function resolveDecompositions(
  proposals: Proposal[],
  chooser: (task: ProposalTask, featureTitle: string, epicTitle: string) => Promise<DecompositionChoice> | DecompositionChoice,
): Promise<DecompositionReviewResult> {
  const summary: DecompositionReviewSummary = {
    total: 0,
    acceptedDecomposed: 0,
    keptOriginal: 0,
    skipped: 0,
  };

  const resultProposals: Proposal[] = [];

  for (const proposal of proposals) {
    const resultFeatures: ProposalFeature[] = [];

    for (const feature of proposal.features) {
      const resultTasks: ProposalTask[] = [];

      for (const task of feature.tasks) {
        if (!task.decomposition) {
          resultTasks.push(task);
          continue;
        }

        summary.total++;
        const choice = await chooser(task, feature.title, proposal.epic.title);

        switch (choice) {
          case "accept_decomposed":
            summary.acceptedDecomposed++;
            break;
          case "keep_original":
            summary.keptOriginal++;
            break;
          case "skip":
            summary.skipped++;
            break;
        }

        resultTasks.push(...applyDecompositionChoice(task, choice));
      }

      resultFeatures.push({ ...feature, tasks: resultTasks });
    }

    resultProposals.push({ ...proposal, features: resultFeatures });
  }

  return { proposals: resultProposals, summary };
}

// ── Auto-resolve (non-interactive) ──

/**
 * Resolve all decompositions by accepting the decomposed versions.
 * Used in non-interactive mode (--accept / --yes).
 *
 * Pure function — no I/O.
 */
export async function autoResolveDecompositions(
  proposals: Proposal[],
): Promise<DecompositionReviewResult> {
  return resolveDecompositions(proposals, () => "accept_decomposed");
}

// ── Interactive I/O ──

function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Parse user input for the decomposition choice prompt.
 * Returns the choice or null for invalid input.
 */
export function parseDecompositionInput(input: string): DecompositionChoice | null {
  const trimmed = input.trim().toLowerCase();

  if (["d", "decomposed", "accept", "y", "yes"].includes(trimmed)) {
    return "accept_decomposed";
  }
  if (["k", "keep", "original"].includes(trimmed)) {
    return "keep_original";
  }
  if (["s", "skip", "n", "no"].includes(trimmed)) {
    return "skip";
  }

  return null;
}

/**
 * Run the interactive decomposition review.
 * For each decomposed task, displays the parent and children, then
 * prompts the user for their choice.
 */
export async function runDecompositionReview(
  proposals: Proposal[],
): Promise<DecompositionReviewResult> {
  const totalDecomposed = countDecomposedTasks(proposals);
  if (totalDecomposed === 0) {
    return { proposals, summary: { total: 0, acceptedDecomposed: 0, keptOriginal: 0, skipped: 0 } };
  }

  info("");
  info(`${totalDecomposed} task${totalDecomposed === 1 ? "" : "s"} auto-decomposed due to LoE threshold.`);
  info("Review each decomposed task:");
  info("");

  let taskNum = 0;

  return resolveDecompositions(proposals, async (task, featureTitle, epicTitle) => {
    taskNum++;
    info(`─── Decomposition ${taskNum}/${totalDecomposed} ───`);
    info(`  Epic: ${epicTitle} → Feature: ${featureTitle}`);
    info(formatDecomposedTask(task, featureTitle));
    info("");
    info("  [d] Accept decomposed  [k] Keep original  [s] Skip");

    while (true) {
      const input = await promptLine(`  (${taskNum}/${totalDecomposed}) > `);
      const choice = parseDecompositionInput(input);
      if (choice) {
        const label = choice === "accept_decomposed"
          ? "Accepted decomposed version"
          : choice === "keep_original"
            ? "Keeping original task"
            : "Skipped";
        info(`  → ${label}`);
        info("");
        return choice;
      }
      info("  Invalid input. Use: d=accept decomposed, k=keep original, s=skip");
    }
  });
}

/**
 * Format a summary of the decomposition review results.
 * Pure function — returns a multi-line string.
 */
export function formatDecompositionSummary(summary: DecompositionReviewSummary): string {
  if (summary.total === 0) return "";

  const parts: string[] = [];
  if (summary.acceptedDecomposed > 0) {
    parts.push(`${summary.acceptedDecomposed} decomposed`);
  }
  if (summary.keptOriginal > 0) {
    parts.push(`${summary.keptOriginal} kept original`);
  }
  if (summary.skipped > 0) {
    parts.push(`${summary.skipped} skipped`);
  }

  return `Decomposition review: ${parts.join(", ")} (${summary.total} total)`;
}
