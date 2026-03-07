import type { PRDDocument } from "../../schema/index.js";
import { isRootLevel } from "../../schema/index.js";
import type { EpiclessFeature } from "../../core/structural.js";
import {
  correlateEpiclessFeatures,
  formatScore,
} from "../../core/epic-correlation.js";
import type { CorrelationResult } from "../../core/epic-correlation.js";
import { insertChild, removeFromTree } from "../../core/tree.js";
import {
  preCheckFeatureDeletion,
  removeFeature,
} from "../../core/remove-feature.js";
import { info, warn } from "../output.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type EpiclessAction = "correlate" | "delete" | "skip";

export interface EpiclessResolution {
  featureId: string;
  action: EpiclessAction;
  /** Target epic ID when action is "correlate". */
  targetEpicId?: string;
}

/**
 * Function signature for interactive prompts.
 * Abstracted for testability — production uses readline, tests inject stubs.
 */
export type PromptFn = (question: string) => Promise<string>;

// ── Interactive resolution ───────────────────────────────────────────────────

/**
 * Present interactive prompts to resolve epicless features found during validation.
 *
 * For each epicless feature, the system first runs correlation analysis to suggest
 * semantically similar parent epics. The user can:
 * - **Correlate**: move under a suggested epic (ranked by similarity) or browse all epics
 * - **Delete**: remove the feature (and its children) from the PRD
 * - **Skip**: leave it unchanged (still reported as validation error)
 *
 * When a high-confidence match is found (≥50% similarity), the top suggestion
 * is highlighted in the prompt to guide the user.
 *
 * Returns an array of resolutions describing the chosen action per feature.
 *
 * @param doc              The loaded PRD document (read-only for resolution gathering)
 * @param epiclessFeatures Detected epicless features from structural validation
 * @param options.prompt   Injectable prompt function (default: readline-based TTY prompt)
 */
export async function resolveEpiclessFeatures(
  doc: PRDDocument,
  epiclessFeatures: EpiclessFeature[],
  options?: { prompt?: PromptFn },
): Promise<EpiclessResolution[]> {
  const prompt = options?.prompt ?? defaultPrompt;
  const resolutions: EpiclessResolution[] = [];

  // Collect available epics for correlation
  const availableEpics = doc.items.filter(
    (item) => isRootLevel(item.level) && item.status !== "deleted",
  );

  // Run correlation analysis for all epicless features
  const correlations = correlateEpiclessFeatures(
    doc.items,
    epiclessFeatures,
  );

  // Build a lookup map for correlation results
  const correlationMap = new Map<string, CorrelationResult>();
  for (const cr of correlations) {
    correlationMap.set(cr.featureId, cr);
  }

  info("");
  info(
    `Found ${epiclessFeatures.length} feature${epiclessFeatures.length === 1 ? "" : "s"} without parent epic${epiclessFeatures.length === 1 ? "" : "s"}:`,
  );

  for (const feature of epiclessFeatures) {
    const correlation = correlationMap.get(feature.itemId);
    const childInfo =
      feature.childCount > 0
        ? `, ${feature.childCount} child${feature.childCount === 1 ? "" : "ren"}`
        : "";

    info("");
    info(
      `  Feature: "${feature.title}" [${feature.itemId.slice(0, 8)}] (${feature.status}${childInfo})`,
    );

    // Show correlation suggestions if available
    if (correlation && correlation.candidates.length > 0) {
      info("");
      info("  Suggested parent epics (by similarity):");
      for (let i = 0; i < correlation.candidates.length; i++) {
        const c = correlation.candidates[i];
        const marker = i === 0 && correlation.hasHighConfidence ? " ★" : "";
        info(
          `    ${i + 1}. "${c.epicTitle}" [${c.epicId.slice(0, 8)}] — ${formatScore(c.score)} match${marker}`,
        );
      }
      info("");
    }

    // Present action options with context-aware hints
    if (correlation?.hasHighConfidence) {
      const top = correlation.candidates[0];
      info(
        `    [1] Correlate — move under "${top.epicTitle}" (${formatScore(top.score)} match, recommended)`,
      );
    } else {
      info("    [1] Correlate — move under an existing epic");
    }
    info("    [2] Delete — remove this feature and its children");
    info("    [3] Skip — leave as-is");

    const choice = await prompt("  Choice (1-3): ");

    switch (choice.trim()) {
      case "1": {
        if (availableEpics.length === 0) {
          warn("  No epics available for correlation. Skipping.");
          resolutions.push({ featureId: feature.itemId, action: "skip" });
          break;
        }

        // If high-confidence match, offer to accept the top suggestion directly
        if (correlation?.hasHighConfidence) {
          const top = correlation.candidates[0];
          info("");
          info(
            `  Top suggestion: "${top.epicTitle}" (${formatScore(top.score)} match)`,
          );
          info("    [y] Accept this suggestion");
          info("    [n] Browse all epics");

          const accept = await prompt("  Accept? (y/n): ");

          if (accept.trim().toLowerCase() === "y") {
            resolutions.push({
              featureId: feature.itemId,
              action: "correlate",
              targetEpicId: top.epicId,
            });
            info(`  ✓ Will move under "${top.epicTitle}"`);
            break;
          }
        }

        // Show full epic list (sorted by correlation score when available)
        info("");
        info("  Available epics:");
        const epicOrder = buildEpicDisplayOrder(
          availableEpics,
          correlation,
        );
        for (let i = 0; i < epicOrder.length; i++) {
          const epic = epicOrder[i];
          const scoreLabel = epic.score !== undefined
            ? ` — ${formatScore(epic.score)} match`
            : "";
          info(
            `    [${i + 1}] "${epic.title}" [${epic.id.slice(0, 8)}]${scoreLabel}`,
          );
        }

        const epicChoice = await prompt(
          `  Move under which epic? (1-${epicOrder.length}): `,
        );
        const epicIdx = parseInt(epicChoice.trim(), 10) - 1;

        if (epicIdx >= 0 && epicIdx < epicOrder.length) {
          resolutions.push({
            featureId: feature.itemId,
            action: "correlate",
            targetEpicId: epicOrder[epicIdx].id,
          });
          info(`  ✓ Will move under "${epicOrder[epicIdx].title}"`);
        } else {
          warn("  Invalid epic selection. Skipping.");
          resolutions.push({ featureId: feature.itemId, action: "skip" });
        }
        break;
      }

      case "2": {
        // Run integrity pre-checks before confirming deletion
        const preCheck = preCheckFeatureDeletion(doc.items, feature.itemId);

        if (!preCheck.safe) {
          info("");
          warn("  ⚠ Integrity warnings:");
          for (const w of preCheck.warnings) {
            warn(`    • ${w}`);
          }
          info("");
          info(`    This will permanently delete ${preCheck.subtreeCount} item${preCheck.subtreeCount === 1 ? "" : "s"}.`);
          info("    [y] Confirm deletion");
          info("    [n] Cancel (skip instead)");

          const confirm = await prompt("  Proceed? (y/n): ");
          if (confirm.trim().toLowerCase() !== "y") {
            resolutions.push({ featureId: feature.itemId, action: "skip" });
            info("  → Deletion cancelled, skipping");
            break;
          }
        } else {
          info(
            `    Deleting ${preCheck.subtreeCount} item${preCheck.subtreeCount === 1 ? "" : "s"} (no external dependencies or sync references).`,
          );
        }

        resolutions.push({ featureId: feature.itemId, action: "delete" });
        info("  ✓ Marked for deletion");
        break;
      }

      case "3":
        resolutions.push({ featureId: feature.itemId, action: "skip" });
        info("  → Skipped");
        break;

      default:
        warn("  Invalid choice. Skipping.");
        resolutions.push({ featureId: feature.itemId, action: "skip" });
        break;
    }
  }

  return resolutions;
}

// ── Epic display ordering ────────────────────────────────────────────────────

interface EpicDisplayEntry {
  id: string;
  title: string;
  score?: number;
}

/**
 * Build an ordered list of epics for display, merging correlation scores
 * with the full epic list. Scored epics appear first (highest score first),
 * followed by any unscored epics in their original order.
 */
function buildEpicDisplayOrder(
  availableEpics: { id: string; title: string }[],
  correlation: CorrelationResult | undefined,
): EpicDisplayEntry[] {
  if (!correlation || correlation.candidates.length === 0) {
    return availableEpics.map((e) => ({ id: e.id, title: e.title }));
  }

  const scoreMap = new Map<string, number>();
  for (const c of correlation.candidates) {
    scoreMap.set(c.epicId, c.score);
  }

  const scored: EpicDisplayEntry[] = [];
  const unscored: EpicDisplayEntry[] = [];

  for (const epic of availableEpics) {
    const s = scoreMap.get(epic.id);
    if (s !== undefined) {
      scored.push({ id: epic.id, title: epic.title, score: s });
    } else {
      unscored.push({ id: epic.id, title: epic.title });
    }
  }

  // Sort scored epics by score descending
  scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  return [...scored, ...unscored];
}

// ── Apply resolutions ────────────────────────────────────────────────────────

/**
 * Apply epicless feature resolutions to the PRD document.
 *
 * Mutates `doc.items` in place:
 * - **correlate**: removes the feature from root and inserts it under the target epic
 * - **delete**: removes the feature (and children) from the tree entirely
 * - **skip**: no mutation
 *
 * @returns The number of mutations applied.
 */
export function applyEpiclessResolutions(
  doc: PRDDocument,
  resolutions: EpiclessResolution[],
): number {
  let mutated = 0;

  for (const resolution of resolutions) {
    if (resolution.action === "skip") continue;

    if (resolution.action === "correlate" && resolution.targetEpicId) {
      const feature = removeFromTree(doc.items, resolution.featureId);
      if (feature) {
        const inserted = insertChild(
          doc.items,
          resolution.targetEpicId,
          feature,
        );
        if (inserted) {
          mutated++;
        } else {
          // Insertion failed (shouldn't happen with valid epic target) — restore
          doc.items.push(feature);
        }
      }
    }

    if (resolution.action === "delete") {
      const result = removeFeature(doc.items, resolution.featureId);
      if (result.ok) {
        mutated++;
      }
    }
  }

  return mutated;
}

// ── Default readline prompt ──────────────────────────────────────────────────

async function defaultPrompt(question: string): Promise<string> {
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) =>
    rl.question(question, resolve),
  );
  rl.close();
  return answer;
}
