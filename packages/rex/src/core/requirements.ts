/**
 * Requirements collection, validation, and traceability.
 *
 * Requirements are first-class objects attached to PRD items. They flow
 * downward: a task inherits the requirements of its parent chain
 * (epic/feature). This module provides utilities to:
 *
 * 1. **Collect** — gather all applicable requirements for a given item
 *    by walking up the parent chain.
 * 2. **Validate** — check whether requirements are met (automated,
 *    metric, or flagged for manual review).
 * 3. **Trace** — map requirements back to their source items for
 *    audit and reporting.
 *
 * @module rex/core/requirements
 */

import type {
  PRDItem,
  Requirement,
  RequirementCategory,
  RequirementValidationType,
} from "../schema/index.js";
import { findItem, walkTree } from "./tree.js";

// ── Collection ────────────────────────────────────────────────────

/**
 * A requirement paired with the item it was defined on.
 * Used for traceability — knowing *where* a requirement came from.
 */
export interface TracedRequirement {
  /** The requirement definition. */
  requirement: Requirement;
  /** ID of the item that defined this requirement. */
  sourceItemId: string;
  /** Title of the source item (for display). */
  sourceItemTitle: string;
  /** Level of the source item. */
  sourceItemLevel: string;
}

/**
 * Collect all requirements that apply to a specific item.
 *
 * Requirements are **inherited**: a task picks up requirements from its
 * own definition plus all ancestor items (parent, grandparent, etc.).
 * This mirrors how non-functional requirements cascade from epics down
 * to individual tasks.
 *
 * Order: own requirements first, then parent's, then grandparent's, etc.
 */
export function collectRequirements(
  items: PRDItem[],
  itemId: string,
): TracedRequirement[] {
  const entry = findItem(items, itemId);
  if (!entry) return [];

  const traced: TracedRequirement[] = [];

  // Own requirements first
  if (entry.item.requirements?.length) {
    for (const req of entry.item.requirements) {
      traced.push({
        requirement: req,
        sourceItemId: entry.item.id,
        sourceItemTitle: entry.item.title,
        sourceItemLevel: entry.item.level,
      });
    }
  }

  // Walk up parent chain (immediate parent → root)
  for (const parent of [...entry.parents].reverse()) {
    if (parent.requirements?.length) {
      for (const req of parent.requirements) {
        traced.push({
          requirement: req,
          sourceItemId: parent.id,
          sourceItemTitle: parent.title,
          sourceItemLevel: parent.level,
        });
      }
    }
  }

  return traced;
}

/**
 * Collect requirements for an item filtered by category.
 */
export function collectRequirementsByCategory(
  items: PRDItem[],
  itemId: string,
  category: RequirementCategory,
): TracedRequirement[] {
  return collectRequirements(items, itemId).filter(
    (tr) => tr.requirement.category === category,
  );
}

/**
 * Collect requirements for an item filtered by validation type.
 */
export function collectRequirementsByValidationType(
  items: PRDItem[],
  itemId: string,
  validationType: RequirementValidationType,
): TracedRequirement[] {
  return collectRequirements(items, itemId).filter(
    (tr) => tr.requirement.validationType === validationType,
  );
}

// ── Validation ────────────────────────────────────────────────────

/**
 * Result of validating a single requirement.
 */
export interface RequirementValidationResult {
  /** The requirement that was validated. */
  requirementId: string;
  requirementTitle: string;
  /** Whether the requirement passed validation. */
  passed: boolean;
  /** Validation type used. */
  validationType: RequirementValidationType;
  /** Human-readable reason for pass/fail. */
  reason: string;
  /** For metric type: the measured value. */
  measuredValue?: number;
  /** For metric type: the required threshold. */
  threshold?: number;
  /** Source item that defined this requirement. */
  sourceItemId: string;
}

/**
 * Aggregate result of validating all requirements for an item.
 */
export interface RequirementsValidationSummary {
  /** ID of the item whose requirements were validated. */
  itemId: string;
  /** Whether all requirements passed. */
  allPassed: boolean;
  /** Total number of requirements checked. */
  total: number;
  /** Number that passed. */
  passed: number;
  /** Number that failed. */
  failed: number;
  /** Number requiring manual review. */
  manualReviewRequired: number;
  /** Individual results. */
  results: RequirementValidationResult[];
}

/**
 * Callback that runs a shell command and returns the result.
 *
 * The requirements module itself doesn't execute commands — that's
 * the caller's responsibility (keeps this module side-effect free).
 * Hench provides the actual executor that respects guard rails.
 */
export type CommandExecutor = (
  command: string,
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

/**
 * Validate all requirements for a given item.
 *
 * - `automated` requirements: runs the validationCommand; pass if exit code 0.
 * - `metric` requirements: runs the validationCommand; parses stdout for a
 *   number and compares against threshold.
 * - `manual` requirements: flagged as needing manual review (cannot auto-pass).
 *
 * Requirements without a validationCommand (except manual type) are
 * reported as needing attention.
 */
export async function validateRequirements(
  items: PRDItem[],
  itemId: string,
  executor?: CommandExecutor,
): Promise<RequirementsValidationSummary> {
  const traced = collectRequirements(items, itemId);
  const results: RequirementValidationResult[] = [];

  for (const tr of traced) {
    const req = tr.requirement;
    const base = {
      requirementId: req.id,
      requirementTitle: req.title,
      validationType: req.validationType,
      sourceItemId: tr.sourceItemId,
    };

    if (req.validationType === "manual") {
      results.push({
        ...base,
        passed: false,
        reason: `Manual review required: ${req.title}`,
      });
      continue;
    }

    if (!req.validationCommand) {
      results.push({
        ...base,
        passed: false,
        reason: `No validation command configured for ${req.validationType} requirement "${req.title}"`,
      });
      continue;
    }

    if (!executor) {
      results.push({
        ...base,
        passed: false,
        reason: `No command executor available to validate "${req.title}"`,
      });
      continue;
    }

    try {
      const { exitCode, stdout } = await executor(req.validationCommand);

      if (req.validationType === "metric") {
        const measured = parseMetricValue(stdout);
        const threshold = req.threshold ?? 0;

        if (measured === null) {
          results.push({
            ...base,
            passed: false,
            reason: `Could not parse metric value from command output for "${req.title}"`,
            threshold,
          });
        } else {
          const passed = measured >= threshold;
          results.push({
            ...base,
            passed,
            reason: passed
              ? `Metric ${measured} meets threshold ${threshold}`
              : `Metric ${measured} below threshold ${threshold}`,
            measuredValue: measured,
            threshold,
          });
        }
      } else {
        // automated
        results.push({
          ...base,
          passed: exitCode === 0,
          reason:
            exitCode === 0
              ? `Validation command passed`
              : `Validation command failed (exit code ${exitCode})`,
        });
      }
    } catch (err) {
      results.push({
        ...base,
        passed: false,
        reason: `Validation command error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed && r.validationType !== "manual").length;
  const manualReviewRequired = results.filter(
    (r) => !r.passed && r.validationType === "manual",
  ).length;

  return {
    itemId,
    allPassed: results.every((r) => r.passed),
    total: results.length,
    passed,
    failed,
    manualReviewRequired,
    results,
  };
}

/**
 * Validate only automated and metric requirements (skip manual).
 * This is the gate used by hench before task completion — manual
 * requirements don't block automated task completion.
 */
export async function validateAutomatedRequirements(
  items: PRDItem[],
  itemId: string,
  executor?: CommandExecutor,
): Promise<RequirementsValidationSummary> {
  const traced = collectRequirements(items, itemId).filter(
    (tr) => tr.requirement.validationType !== "manual",
  );

  // Rebuild item list with only the target item's non-manual requirements
  // We use the full validation flow but only on automated/metric requirements
  const fullSummary = await validateRequirements(items, itemId, executor);
  const automatedResults = fullSummary.results.filter(
    (r) => r.validationType !== "manual",
  );

  const passed = automatedResults.filter((r) => r.passed).length;
  const failed = automatedResults.filter((r) => !r.passed).length;

  return {
    itemId,
    allPassed: automatedResults.every((r) => r.passed),
    total: automatedResults.length,
    passed,
    failed,
    manualReviewRequired: 0,
    results: automatedResults,
  };
}

// ── Formatting ────────────────────────────────────────────────────

/**
 * Format a validation summary as a human-readable string.
 */
export function formatRequirementsValidation(
  summary: RequirementsValidationSummary,
): string {
  if (summary.total === 0) {
    return "No requirements to validate.";
  }

  const lines: string[] = [
    `Requirements validation: ${summary.passed}/${summary.total} passed`,
  ];

  if (summary.manualReviewRequired > 0) {
    lines.push(`Manual review needed: ${summary.manualReviewRequired}`);
  }

  for (const result of summary.results) {
    const icon = result.passed ? "\u2713" : "\u2717";
    lines.push(`  ${icon} [${result.validationType}] ${result.requirementTitle}: ${result.reason}`);
  }

  return lines.join("\n");
}

// ── Traceability ──────────────────────────────────────────────────

/**
 * Build a traceability matrix: for each requirement, list the items
 * it applies to. Useful for audit and coverage reports.
 */
export function buildTraceabilityMatrix(
  items: PRDItem[],
): Map<string, { requirement: Requirement; appliesTo: string[] }> {
  const matrix = new Map<string, { requirement: Requirement; appliesTo: string[] }>();

  for (const { item } of walkTree(items)) {
    if (!item.requirements?.length) continue;

    for (const req of item.requirements) {
      const existing = matrix.get(req.id);
      if (existing) {
        existing.appliesTo.push(item.id);
      } else {
        matrix.set(req.id, {
          requirement: req,
          appliesTo: [item.id],
        });
      }
    }
  }

  return matrix;
}

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Parse a numeric value from command output.
 * Looks for the last number in the output (supports decimals).
 */
function parseMetricValue(stdout: string): number | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  // Try to parse the entire output as a number first
  const direct = Number(trimmed);
  if (!isNaN(direct) && isFinite(direct)) return direct;

  // Fall back to extracting the last number from the output
  const matches = trimmed.match(/-?\d+(?:\.\d+)?/g);
  if (!matches || matches.length === 0) return null;

  const last = Number(matches[matches.length - 1]);
  return isNaN(last) ? null : last;
}
