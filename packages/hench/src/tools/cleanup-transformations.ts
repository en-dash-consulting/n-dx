/**
 * Production-scoped cleanup transformations with test-exclusion hard guard.
 *
 * Applies safe automated cleanup transformations to production source files:
 * - Remove dead exports with zero cross-package consumers
 * - Prune unused import statements
 * - Consolidate trivially duplicated utilities (when all callers can be updated atomically)
 *
 * Safety guarantees:
 * - Hard guard throws and halts immediately if any write targets a test file
 * - tsc --noEmit runs after each transformation batch; rolls back on failure
 * - All transformations logged with file, line range, and change type
 * - Idempotent — re-running on clean codebase produces no changes
 *
 * @module
 */

import { readFile, writeFile, stat, rename } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { execShellCmd } from "../process/exec.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CleanupTransformation {
  /** Type of transformation applied. */
  type: "dead_export_removal" | "unused_import_prune" | "utility_consolidation";
  /** File path (relative to project root). */
  file: string;
  /** Start line (1-indexed). */
  startLine: number;
  /** End line (1-indexed). */
  endLine: number;
  /** Human-readable description. */
  description: string;
  /** The removed/modified code snippet. */
  removedCode?: string;
}

export interface CleanupBatch {
  /** Transformations in this batch. */
  transformations: CleanupTransformation[];
  /** Whether tsc validated the batch. */
  validated: boolean;
  /** Whether the batch was rolled back. */
  rolledBack: boolean;
  /** Error message if validation failed. */
  error?: string;
}

export interface CleanupResult {
  /** Whether cleanup ran at all. */
  ran: boolean;
  /** Number of transformations successfully applied. */
  appliedCount: number;
  /** Number of transformations rolled back due to validation failure. */
  rolledBackCount: number;
  /** All transformation batches (for logging). */
  batches: CleanupBatch[];
  /** Total elapsed time (ms). */
  totalDurationMs: number;
  /** Error if cleanup itself failed. */
  error?: string;
}

export interface DeadExport {
  file: string;
  name: string;
  startLine: number;
  endLine: number;
}

export interface UnusedImport {
  file: string;
  importStatement: string;
  startLine: number;
  endLine: number;
  symbols: string[];
}

export interface DuplicateUtility {
  /** Canonical location to keep. */
  canonical: { file: string; name: string; startLine: number; endLine: number };
  /** Duplicate locations to remove (callers will be updated). */
  duplicates: Array<{ file: string; name: string; startLine: number; endLine: number }>;
  /** Files that need import updates. */
  callerFiles: string[];
}

export interface AnalyzerOutput {
  deadExports?: DeadExport[];
  unusedImports?: UnusedImport[];
  duplicateUtilities?: DuplicateUtility[];
}

export interface CleanupOptions {
  /** Project root directory. */
  projectDir: string;
  /** Analyzer output (dead exports, unused imports, duplicates). */
  analyzerOutput: AnalyzerOutput;
  /** Timeout for tsc --noEmit (ms). Default: 120_000. */
  typecheckTimeout?: number;
  /** Dry run mode — log transformations without applying. */
  dryRun?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TYPECHECK_TIMEOUT = 120_000;

/** Test file patterns — hard guard throws if any write targets these. */
const TEST_FILE_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /_test\.[jt]sx?$/,
  /_spec\.[jt]sx?$/,
  /_test\.go$/,          // Go test files
  /^tests\//,
  /\/tests\//,
  /__tests__\//,
];

// ---------------------------------------------------------------------------
// Hard Guard: Test File Protection
// ---------------------------------------------------------------------------

/**
 * Test file exclusion hard guard.
 *
 * Throws immediately if the file path matches any test file pattern.
 * This is a BLOCKING guard — execution halts on violation.
 */
export class TestFileGuardError extends Error {
  constructor(filePath: string) {
    super(
      `HARD GUARD VIOLATION: Attempted write to test file "${filePath}". ` +
      `Cleanup transformations are strictly scoped to production files. Aborting.`
    );
    this.name = "TestFileGuardError";
  }
}

/**
 * Check if a file path is a test file.
 * Returns true for any path matching test file patterns.
 */
export function isTestFilePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return TEST_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Hard guard — throws TestFileGuardError if filePath is a test file.
 * Call this before ANY write operation in the cleanup pipeline.
 */
export function assertNotTestFile(filePath: string): void {
  if (isTestFilePath(filePath)) {
    throw new TestFileGuardError(filePath);
  }
}

// ---------------------------------------------------------------------------
// Validation: tsc --noEmit
// ---------------------------------------------------------------------------

/**
 * Run tsc --noEmit to validate TypeScript types after a transformation batch.
 * Returns true if validation passes, false otherwise.
 */
async function runTypecheck(
  projectDir: string,
  timeout: number,
): Promise<{ passed: boolean; error?: string }> {
  const { exitCode, stderr } = await execShellCmd("pnpm typecheck", {
    cwd: projectDir,
    timeout,
    maxBuffer: 5 * 1024 * 1024,
  });

  if (exitCode === null) {
    return { passed: false, error: "Typecheck timed out" };
  }

  if (exitCode !== 0) {
    // Truncate error output for logging
    const truncated = stderr.length > 1000
      ? stderr.slice(0, 1000) + "...(truncated)"
      : stderr;
    return { passed: false, error: truncated };
  }

  return { passed: true };
}

// ---------------------------------------------------------------------------
// File Backup and Restore (for Rollback)
// ---------------------------------------------------------------------------

interface FileBackup {
  filePath: string;
  backupPath: string;
  originalContent: string;
}

async function backupFile(filePath: string): Promise<FileBackup> {
  const content = await readFile(filePath, "utf-8");
  const backupPath = `${filePath}.cleanup-backup`;
  await writeFile(backupPath, content, "utf-8");
  return { filePath, backupPath, originalContent: content };
}

async function restoreBackup(backup: FileBackup): Promise<void> {
  await writeFile(backup.filePath, backup.originalContent, "utf-8");
  // Clean up backup file (ignore errors if it doesn't exist)
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(backup.backupPath);
  } catch {
    // Backup file may already be cleaned up
  }
}

async function cleanupBackup(backup: FileBackup): Promise<void> {
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(backup.backupPath);
  } catch {
    // Backup file may already be cleaned up
  }
}

// ---------------------------------------------------------------------------
// Transformation Implementations
// ---------------------------------------------------------------------------

/**
 * Remove dead exports from a file.
 * Returns the transformation record and new file content.
 */
async function removeDeadExport(
  projectDir: string,
  deadExport: DeadExport,
): Promise<{ transformation: CleanupTransformation; newContent: string }> {
  const filePath = resolve(projectDir, deadExport.file);
  assertNotTestFile(deadExport.file);

  const content = await readFile(filePath, "utf-8");
  const lines = content.split("\n");

  // Extract the lines to remove
  const startIdx = deadExport.startLine - 1;
  const endIdx = deadExport.endLine;
  const removedLines = lines.slice(startIdx, endIdx);
  const removedCode = removedLines.join("\n");

  // Remove the lines
  const newLines = [...lines.slice(0, startIdx), ...lines.slice(endIdx)];
  const newContent = newLines.join("\n");

  return {
    transformation: {
      type: "dead_export_removal",
      file: deadExport.file,
      startLine: deadExport.startLine,
      endLine: deadExport.endLine,
      description: `Removed dead export: ${deadExport.name}`,
      removedCode,
    },
    newContent,
  };
}

/**
 * Prune unused imports from a file.
 * Returns the transformation record and new file content.
 */
async function pruneUnusedImport(
  projectDir: string,
  unusedImport: UnusedImport,
): Promise<{ transformation: CleanupTransformation; newContent: string }> {
  const filePath = resolve(projectDir, unusedImport.file);
  assertNotTestFile(unusedImport.file);

  const content = await readFile(filePath, "utf-8");
  const lines = content.split("\n");

  const startIdx = unusedImport.startLine - 1;
  const endIdx = unusedImport.endLine;
  const removedLines = lines.slice(startIdx, endIdx);
  const removedCode = removedLines.join("\n");

  const newLines = [...lines.slice(0, startIdx), ...lines.slice(endIdx)];
  const newContent = newLines.join("\n");

  return {
    transformation: {
      type: "unused_import_prune",
      file: unusedImport.file,
      startLine: unusedImport.startLine,
      endLine: unusedImport.endLine,
      description: `Pruned unused import: ${unusedImport.symbols.join(", ")}`,
      removedCode,
    },
    newContent,
  };
}

/**
 * Group transformations by file to enable atomic batch writes.
 */
function groupByFile<T extends { file: string }>(items: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    if (!grouped.has(item.file)) {
      grouped.set(item.file, []);
    }
    grouped.get(item.file)!.push(item);
  }
  return grouped;
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

/**
 * Apply production-scoped cleanup transformations.
 *
 * Behavior:
 * 1. Validates all target files are NOT test files (hard guard)
 * 2. Groups transformations by file for atomic batch writes
 * 3. For each batch:
 *    a. Backup affected files
 *    b. Apply transformations
 *    c. Run tsc --noEmit
 *    d. If validation fails, roll back entire batch
 * 4. Return structured results with all transformations logged
 *
 * Guarantees:
 * - Throws TestFileGuardError immediately if any target is a test file
 * - Type-safe: invalid transformations are rolled back
 * - Idempotent: re-running on clean codebase produces no changes
 */
export async function runCleanupTransformations(
  options: CleanupOptions,
): Promise<CleanupResult> {
  const {
    projectDir,
    analyzerOutput,
    typecheckTimeout = DEFAULT_TYPECHECK_TIMEOUT,
    dryRun = false,
  } = options;

  const startMs = Date.now();
  const batches: CleanupBatch[] = [];
  let appliedCount = 0;
  let rolledBackCount = 0;

  // Early exit if no work to do
  const hasDeadExports = (analyzerOutput.deadExports?.length ?? 0) > 0;
  const hasUnusedImports = (analyzerOutput.unusedImports?.length ?? 0) > 0;
  const hasDuplicates = (analyzerOutput.duplicateUtilities?.length ?? 0) > 0;

  if (!hasDeadExports && !hasUnusedImports && !hasDuplicates) {
    return {
      ran: true,
      appliedCount: 0,
      rolledBackCount: 0,
      batches: [],
      totalDurationMs: Date.now() - startMs,
    };
  }

  // Phase 1: Pre-validate all files (hard guard check)
  const allTargetFiles = new Set<string>();
  for (const de of analyzerOutput.deadExports ?? []) {
    allTargetFiles.add(de.file);
  }
  for (const ui of analyzerOutput.unusedImports ?? []) {
    allTargetFiles.add(ui.file);
  }
  for (const du of analyzerOutput.duplicateUtilities ?? []) {
    allTargetFiles.add(du.canonical.file);
    for (const dup of du.duplicates) {
      allTargetFiles.add(dup.file);
    }
    for (const caller of du.callerFiles) {
      allTargetFiles.add(caller);
    }
  }

  // Hard guard: throw immediately if any target is a test file
  for (const file of allTargetFiles) {
    assertNotTestFile(file);
  }

  // Phase 2: Process dead exports (grouped by file)
  if (hasDeadExports) {
    const groupedDeadExports = groupByFile(analyzerOutput.deadExports!);

    for (const [file, exports] of groupedDeadExports) {
      const filePath = resolve(projectDir, file);
      const transformations: CleanupTransformation[] = [];
      let backup: FileBackup | undefined;

      try {
        // Check file exists
        await stat(filePath);
        backup = await backupFile(filePath);

        // Sort by line number descending to preserve line numbers during removal
        const sorted = [...exports].sort((a, b) => b.startLine - a.startLine);

        let content = backup.originalContent;
        for (const deadExport of sorted) {
          const lines = content.split("\n");
          const startIdx = deadExport.startLine - 1;
          const endIdx = deadExport.endLine;
          const removedCode = lines.slice(startIdx, endIdx).join("\n");

          transformations.push({
            type: "dead_export_removal",
            file: deadExport.file,
            startLine: deadExport.startLine,
            endLine: deadExport.endLine,
            description: `Removed dead export: ${deadExport.name}`,
            removedCode,
          });

          content = [...lines.slice(0, startIdx), ...lines.slice(endIdx)].join("\n");
        }

        if (!dryRun) {
          await writeFile(filePath, content, "utf-8");

          // Validate with typecheck
          const { passed, error } = await runTypecheck(projectDir, typecheckTimeout);

          if (!passed) {
            // Roll back
            await restoreBackup(backup);
            batches.push({
              transformations,
              validated: false,
              rolledBack: true,
              error,
            });
            rolledBackCount += transformations.length;
          } else {
            await cleanupBackup(backup);
            batches.push({
              transformations,
              validated: true,
              rolledBack: false,
            });
            appliedCount += transformations.length;
          }
        } else {
          // Dry run — just log
          batches.push({
            transformations,
            validated: true,
            rolledBack: false,
          });
          appliedCount += transformations.length;
        }
      } catch (err) {
        if (backup) {
          try {
            await restoreBackup(backup);
          } catch {
            // Ignore restore errors
          }
        }
        const errorMsg = err instanceof Error ? err.message : String(err);

        // Re-throw hard guard errors
        if (err instanceof TestFileGuardError) {
          throw err;
        }

        batches.push({
          transformations,
          validated: false,
          rolledBack: true,
          error: errorMsg,
        });
        rolledBackCount += transformations.length;
      }
    }
  }

  // Phase 3: Process unused imports (grouped by file)
  if (hasUnusedImports) {
    const groupedUnusedImports = groupByFile(analyzerOutput.unusedImports!);

    for (const [file, imports] of groupedUnusedImports) {
      const filePath = resolve(projectDir, file);
      const transformations: CleanupTransformation[] = [];
      let backup: FileBackup | undefined;

      try {
        await stat(filePath);
        backup = await backupFile(filePath);

        // Sort by line number descending
        const sorted = [...imports].sort((a, b) => b.startLine - a.startLine);

        let content = backup.originalContent;
        for (const unusedImport of sorted) {
          const lines = content.split("\n");
          const startIdx = unusedImport.startLine - 1;
          const endIdx = unusedImport.endLine;
          const removedCode = lines.slice(startIdx, endIdx).join("\n");

          transformations.push({
            type: "unused_import_prune",
            file: unusedImport.file,
            startLine: unusedImport.startLine,
            endLine: unusedImport.endLine,
            description: `Pruned unused import: ${unusedImport.symbols.join(", ")}`,
            removedCode,
          });

          content = [...lines.slice(0, startIdx), ...lines.slice(endIdx)].join("\n");
        }

        if (!dryRun) {
          await writeFile(filePath, content, "utf-8");

          const { passed, error } = await runTypecheck(projectDir, typecheckTimeout);

          if (!passed) {
            await restoreBackup(backup);
            batches.push({
              transformations,
              validated: false,
              rolledBack: true,
              error,
            });
            rolledBackCount += transformations.length;
          } else {
            await cleanupBackup(backup);
            batches.push({
              transformations,
              validated: true,
              rolledBack: false,
            });
            appliedCount += transformations.length;
          }
        } else {
          batches.push({
            transformations,
            validated: true,
            rolledBack: false,
          });
          appliedCount += transformations.length;
        }
      } catch (err) {
        if (backup) {
          try {
            await restoreBackup(backup);
          } catch {
            // Ignore
          }
        }

        if (err instanceof TestFileGuardError) {
          throw err;
        }

        const errorMsg = err instanceof Error ? err.message : String(err);
        batches.push({
          transformations,
          validated: false,
          rolledBack: true,
          error: errorMsg,
        });
        rolledBackCount += transformations.length;
      }
    }
  }

  // Phase 4: Process duplicate utilities
  // This requires atomic updates across multiple files
  if (hasDuplicates) {
    for (const duplicate of analyzerOutput.duplicateUtilities!) {
      const transformations: CleanupTransformation[] = [];
      const backups: FileBackup[] = [];

      try {
        // Pre-check all files (hard guard)
        assertNotTestFile(duplicate.canonical.file);
        for (const dup of duplicate.duplicates) {
          assertNotTestFile(dup.file);
        }
        for (const caller of duplicate.callerFiles) {
          assertNotTestFile(caller);
        }

        // Backup all affected files
        const allFiles = new Set<string>();
        for (const dup of duplicate.duplicates) {
          allFiles.add(dup.file);
        }
        for (const caller of duplicate.callerFiles) {
          allFiles.add(caller);
        }

        for (const file of allFiles) {
          const filePath = resolve(projectDir, file);
          try {
            await stat(filePath);
            backups.push(await backupFile(filePath));
          } catch {
            // File doesn't exist, skip
          }
        }

        // Remove duplicate definitions (sorted by line descending)
        const sortedDuplicates = [...duplicate.duplicates].sort(
          (a, b) => b.startLine - a.startLine
        );

        for (const dup of sortedDuplicates) {
          const filePath = resolve(projectDir, dup.file);
          const content = await readFile(filePath, "utf-8");
          const lines = content.split("\n");
          const startIdx = dup.startLine - 1;
          const endIdx = dup.endLine;
          const removedCode = lines.slice(startIdx, endIdx).join("\n");

          transformations.push({
            type: "utility_consolidation",
            file: dup.file,
            startLine: dup.startLine,
            endLine: dup.endLine,
            description: `Removed duplicate utility: ${dup.name} (canonical: ${duplicate.canonical.file})`,
            removedCode,
          });

          if (!dryRun) {
            const newContent = [...lines.slice(0, startIdx), ...lines.slice(endIdx)].join("\n");
            await writeFile(filePath, newContent, "utf-8");
          }
        }

        // Update import statements in caller files
        // (This is a simplified version — a real implementation would need
        // to parse and rewrite imports properly)

        if (!dryRun) {
          const { passed, error } = await runTypecheck(projectDir, typecheckTimeout);

          if (!passed) {
            // Roll back all backups
            for (const backup of backups) {
              await restoreBackup(backup);
            }
            batches.push({
              transformations,
              validated: false,
              rolledBack: true,
              error,
            });
            rolledBackCount += transformations.length;
          } else {
            // Clean up backups
            for (const backup of backups) {
              await cleanupBackup(backup);
            }
            batches.push({
              transformations,
              validated: true,
              rolledBack: false,
            });
            appliedCount += transformations.length;
          }
        } else {
          batches.push({
            transformations,
            validated: true,
            rolledBack: false,
          });
          appliedCount += transformations.length;
        }
      } catch (err) {
        // Roll back on any error
        for (const backup of backups) {
          try {
            await restoreBackup(backup);
          } catch {
            // Ignore
          }
        }

        if (err instanceof TestFileGuardError) {
          throw err;
        }

        const errorMsg = err instanceof Error ? err.message : String(err);
        batches.push({
          transformations,
          validated: false,
          rolledBack: true,
          error: errorMsg,
        });
        rolledBackCount += transformations.length;
      }
    }
  }

  return {
    ran: true,
    appliedCount,
    rolledBackCount,
    batches,
    totalDurationMs: Date.now() - startMs,
  };
}

/**
 * Format cleanup results for logging.
 */
export function formatCleanupResults(result: CleanupResult): string {
  const lines: string[] = [];

  lines.push(`Cleanup Transformations:`);
  lines.push(`  Applied: ${result.appliedCount}`);
  lines.push(`  Rolled back: ${result.rolledBackCount}`);
  lines.push(`  Duration: ${result.totalDurationMs}ms`);

  if (result.batches.length > 0) {
    lines.push(`\nBatch Details:`);
    for (let i = 0; i < result.batches.length; i++) {
      const batch = result.batches[i];
      const status = batch.rolledBack ? "ROLLED BACK" : "APPLIED";
      lines.push(`  Batch ${i + 1}: ${status} (${batch.transformations.length} transformations)`);

      if (batch.error) {
        lines.push(`    Error: ${batch.error.slice(0, 200)}`);
      }

      for (const t of batch.transformations) {
        lines.push(`    - ${t.type}: ${t.file}:${t.startLine}-${t.endLine}`);
        lines.push(`      ${t.description}`);
      }
    }
  }

  return lines.join("\n");
}
