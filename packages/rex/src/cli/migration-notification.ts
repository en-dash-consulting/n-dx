/**
 * User-facing notifications for legacy `.rex/prd.json` migration.
 *
 * When a legacy prd.json file is detected and migrated to folder-tree format,
 * users see a clear, colored CLI banner (respecting NO_COLOR and --quiet flags)
 * and a structured log entry in the execution log for dashboard display.
 *
 * @module rex/cli/migration-notification
 */

import { bold, yellow, dim, isColorEnabled } from "@n-dx/llm-client";
import { isQuiet } from "./output.js";
import { PRD_TREE_DIRNAME } from "../store/index.js";
import type { LegacyPrdMigrationResult } from "../store/ensure-legacy-prd-migrated.js";
import type { LogEntry } from "../schema/v1.js";

/**
 * Format a colored, multi-line CLI banner describing the prd.json migration.
 *
 * The banner includes:
 * - "prd.json detected and migrated" heading
 * - Backup file path (yellow)
 * - Folder-tree location (.rex/prd_tree)
 * - Suggestion to inspect with rex status
 *
 * @param backupPath - Path to the timestamped backup file
 * @param itemCount - Number of items migrated
 * @param folderTreePath - Path to the new folder-tree root
 */
export function formatMigrationBanner(
  backupPath: string,
  itemCount: number,
  folderTreePath: string = `.rex/${PRD_TREE_DIRNAME}`,
): string {
  const lines: string[] = [];

  // Header
  lines.push("");
  lines.push(bold("✓ Legacy PRD migration completed"));

  // Details
  lines.push(`  ${itemCount} item(s) migrated from prd.json to folder-tree format`);
  lines.push(`  Backup saved to: ${yellow(backupPath)}`);
  lines.push(`  New location: ${dim(folderTreePath)}`);

  // Suggestion
  lines.push(`  ${dim("Run: rex status")} to inspect the PRD structure`);
  lines.push("");

  return lines.join("\n");
}

/**
 * Determine if migration banner should be emitted to stdout/stderr.
 *
 * The banner is suppressed when:
 * - --quiet flag is set
 * - --format=json is set (script-friendly mode)
 * - NO_COLOR env var is set or process is not a TTY
 *
 * A structured log entry is always written to execution-log.jsonl
 * regardless of this setting.
 *
 * @param flags - CLI flags from command invocation
 */
export function shouldEmitMigrationBanner(flags: Record<string, string>): boolean {
  // Suppress in quiet mode or JSON output mode
  if (flags.quiet === "true" || flags.format === "json") {
    return false;
  }

  // Suppress if colors are disabled (NO_COLOR or non-TTY)
  if (!isColorEnabled()) {
    return false;
  }

  // Suppress if in global quiet mode (set by CLI)
  if (isQuiet()) {
    return false;
  }

  return true;
}

/**
 * Emit migration notification to stderr and execution log.
 *
 * The banner is printed to stderr (if `shouldEmitMigrationBanner()` returns true)
 * and a structured log entry is always appended to the execution log.
 *
 * @param result - Migration result from `ensureLegacyPrdMigrated()`
 * @param flags - CLI flags from command invocation
 * @param appendLogFn - Function to append log entries (for testing)
 */
export async function emitMigrationNotification(
  result: LegacyPrdMigrationResult,
  flags: Record<string, string>,
  appendLogFn: (entry: LogEntry) => Promise<void>,
): Promise<void> {
  // Skip if migration didn't happen
  if (!result.migrated) {
    return;
  }

  // Emit colored banner to stderr (unless suppressed)
  if (shouldEmitMigrationBanner(flags)) {
    const backupPath = result.backupPath ?? "(unknown)";
    const itemCount = result.itemCount ?? 0;
    const banner = formatMigrationBanner(backupPath, itemCount);
    console.error(banner);
  }

  // Always log to execution log (even in quiet/json mode)
  const logEntry = getMigrationLogEntry(result);
  try {
    await appendLogFn(logEntry);
  } catch {
    // Best-effort logging; don't fail the command if log write fails
  }
}

/**
 * Create a structured log entry for the migration event.
 *
 * The entry includes migration metadata in the detail field as JSON:
 * - backupPath: path to the timestamped backup
 * - itemCount: number of items migrated
 * - migrated: always true (these entries only exist for successful migrations)
 *
 * @param result - Migration result from `ensureLegacyPrdMigrated()`
 */
export function getMigrationLogEntry(result: LegacyPrdMigrationResult): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    event: "legacy_prd_migration",
    detail: JSON.stringify({
      migrated: true,
      backupPath: result.backupPath ?? "(unknown)",
      itemCount: result.itemCount ?? 0,
    }),
  };
}

/**
 * Generate a one-time MCP warning message for the first tool call
 * that triggered a migration.
 *
 * Used to include a `warning` field in MCP tool responses when a migration
 * has just occurred, alerting the user to check the backup.
 *
 * @param result - Migration result from `ensureLegacyPrdMigrated()`
 */
export function getMigrationMcpWarning(result: LegacyPrdMigrationResult): string | undefined {
  if (!result.migrated) {
    return undefined;
  }

  const backupPath = result.backupPath ?? "(unknown)";
  const itemCount = result.itemCount ?? 0;
  return `prd.json detected and migrated to folder-tree format. Backup: ${backupPath} (${itemCount} items)`;
}
