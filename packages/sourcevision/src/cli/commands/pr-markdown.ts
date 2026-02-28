/**
 * PR markdown generation command.
 *
 * Generates PR-ready markdown from rex completion data and branch
 * work records, without relying on git diff output.
 *
 * ## Flow
 *
 * 1. Collect completed work items from the rex PRD via the branch work collector.
 * 2. Convert the result to a {@link BranchWorkRecord}.
 * 3. Render markdown using the pure-function template generator.
 * 4. Write to `.sourcevision/pr-markdown.md`.
 *
 * Works without git history — the collector degrades gracefully
 * when git is unavailable, returning all completed items as branch work.
 *
 * @module sourcevision/cli/commands/pr-markdown
 */

import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { requireSvDir } from "../errors.js";
import { SV_DIR } from "./constants.js";
import { info } from "../output.js";
import { collectBranchWork } from "../../analyzers/branch-work-collector.js";
import { classifyItems } from "../../analyzers/branch-work-classifier.js";
import { renderPRMarkdownFromRecord } from "../../generators/pr-markdown-template.js";
import type {
  BranchWorkRecord,
  BranchWorkRecordItem,
  BranchWorkEpicSummary,
} from "../../schema/v1.js";
import type { BranchWorkResult } from "../../analyzers/branch-work-collector.js";

/** Output filename for generated PR markdown. */
export const PR_MARKDOWN_FILENAME = "pr-markdown.md";

/**
 * Convert a {@link BranchWorkResult} from the collector into a
 * {@link BranchWorkRecord} suitable for the PR markdown template renderer.
 *
 * Items without a `completedAt` timestamp use the collection timestamp
 * as a fallback — these are items that were marked completed in the PRD
 * but lack explicit timestamps.
 *
 * Each item is classified for change significance (patch/minor/major) and
 * breaking change status using heuristic analysis of tags, descriptions,
 * acceptance criteria, priority, and epic scope.
 */
export function toBranchWorkRecord(result: BranchWorkResult): BranchWorkRecord {
  const now = result.collectedAt;

  const rawItems: BranchWorkRecordItem[] = result.items.map((item) => ({
    id: item.id,
    title: item.title,
    level: item.level,
    completedAt: item.completedAt ?? now,
    parentChain: item.parentChain.map((ref) => ({
      id: ref.id,
      title: ref.title,
      level: ref.level,
    })),
    ...(item.priority !== undefined && { priority: item.priority }),
    ...(item.tags !== undefined && { tags: item.tags }),
    ...(item.description !== undefined && { description: item.description }),
    ...(item.acceptanceCriteria !== undefined && {
      acceptanceCriteria: item.acceptanceCriteria,
    }),
  }));

  const epicSummaries: BranchWorkEpicSummary[] = (
    result.epicSummaries ?? []
  ).map((s) => ({
    id: s.id,
    title: s.title,
    completedCount: s.completedCount,
  }));

  // Classify items for change significance and breaking change status
  const items = classifyItems(rawItems, epicSummaries);

  return {
    schemaVersion: "1.0.0",
    branch: result.branch,
    baseBranch: result.baseBranch,
    createdAt: now,
    updatedAt: now,
    items,
    epicSummaries,
  };
}

/** Result of PR markdown file generation. */
export interface PrMarkdownGenerationResult {
  /** Absolute path of the written file. */
  outputPath: string;
  /** Number of completed work items included in the markdown. */
  itemCount: number;
  /** Non-fatal warnings collected during generation. */
  warnings: string[];
}

/**
 * Generate PR markdown file from rex completion data.
 *
 * Core generation logic shared by the standalone `pr-markdown` command
 * and the analyze command integration. Callers provide resolved paths
 * — this function performs no CLI error checking.
 *
 * Gracefully handles:
 * - Missing `.rex/prd.json` (produces "no completed work" output)
 * - Non-git directories (all completed items treated as branch work)
 * - Missing base branch (all completed items treated as branch work)
 * - Corrupted PRD JSON (produces empty result with warnings)
 */
export async function generatePrMarkdownFile(
  absDir: string,
  svDir: string,
): Promise<PrMarkdownGenerationResult> {
  const result = await collectBranchWork({ dir: absDir });
  const warnings = result.errors ? [...result.errors] : [];

  const record = toBranchWorkRecord(result);
  const markdown = renderPRMarkdownFromRecord(record);
  const outputPath = join(svDir, PR_MARKDOWN_FILENAME);
  writeFileSync(outputPath, markdown, "utf-8");

  return { outputPath, itemCount: record.items.length, warnings };
}

/**
 * Generate PR markdown from rex completion data.
 *
 * Collects completed work items from `.rex/prd.json`, converts to a
 * branch work record, and renders structured markdown organized by
 * epics and features.
 *
 * Gracefully handles:
 * - Missing `.rex/prd.json` (produces "no completed work" output)
 * - Non-git directories (all completed items treated as branch work)
 * - Missing base branch (all completed items treated as branch work)
 * - Corrupted PRD JSON (produces empty result with warnings)
 */
export async function cmdPrMarkdown(targetDir: string): Promise<void> {
  const absDir = resolve(targetDir);
  requireSvDir(absDir);

  const { outputPath, warnings } = await generatePrMarkdownFile(
    absDir,
    join(absDir, SV_DIR),
  );

  for (const warning of warnings) {
    info(`Warning: ${warning}`);
  }

  info(`PR markdown regenerated → ${outputPath}`);
}
