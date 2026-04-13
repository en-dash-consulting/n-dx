/**
 * Post-write structure health warning.
 *
 * Called after CLI commands that modify the PRD (add, analyze, plan).
 * Prints warnings to stderr when structural thresholds are crossed.
 * Non-blocking — the command still succeeds.
 *
 * @module cli/commands/health-warning
 */

import type { PRDStore } from "../../store/index.js";
import type { StructureHealthThresholds } from "../../schema/index.js";
import { checkStructureHealth } from "../../core/health.js";

/**
 * Check PRD structure health and print warnings to stderr.
 * Safe to call after any write — catches and ignores errors silently.
 */
export async function warnOnStructureDegradation(
  store: PRDStore,
  /** Pass true to suppress output (e.g., when --format=json). */
  quiet = false,
): Promise<void> {
  if (quiet) return;
  try {
    const doc = await store.loadDocument();
    const config = await store.loadConfig();
    const thresholds: StructureHealthThresholds | undefined =
      (config as Record<string, unknown>).structureHealth as StructureHealthThresholds | undefined;
    const result = checkStructureHealth(doc.items, thresholds);

    if (!result.healthy) {
      process.stderr.write("\n");
      process.stderr.write("Structure warnings:\n");
      for (const w of result.warnings.slice(0, 5)) {
        process.stderr.write(`  ⚠ ${w.message}\n`);
      }
      if (result.warnings.length > 5) {
        process.stderr.write(`  ... and ${result.warnings.length - 5} more\n`);
      }
      process.stderr.write("  Run 'ndx reshape' or 'ndx reorganize' to fix.\n");
    }
  } catch {
    // Non-fatal — don't break the command if health check fails
  }
}
