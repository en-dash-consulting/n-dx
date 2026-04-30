/**
 * File classification for change detection and validation.
 *
 * Categorizes file paths into code/test/docs/config/metadata based on extension
 * and naming patterns. Used throughout hench for determining task completion
 * validity and change classification in run summaries.
 *
 * @module hench/store/file-classifier
 */

import type { ToolCallRecord } from "../schema/index.js";

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

/** File category for classification purposes. */
export type FileCategory = "code" | "test" | "docs" | "config" | "metadata";

// ---------------------------------------------------------------------------
// Classification logic
// ---------------------------------------------------------------------------

/**
 * Classify a file path into a category based on its extension and name.
 *
 * Classification precedence (first match wins):
 * 1. PRD metadata files (.rex/) → "metadata"
 * 2. Test files (.test.ts, .spec.js, __tests__/, tests/) → "test"
 * 3. Documentation (.md, .txt, .rst) → "docs"
 * 4. Config files (.json, .yaml, .toml, .ini, .env, .config.js) → "config"
 * 5. Everything else → "code" (includes .ts, .js, .tsx, .jsx, .py, .go, etc.)
 *
 * @param filePath File path to classify
 * @returns The category for this file
 */
export function classifyFile(filePath: string): FileCategory {
  // PRD metadata files
  if (filePath.endsWith("prd.json") || filePath.includes(".rex/")) return "metadata";

  // Test files
  if (/\.test\.[jt]sx?$/.test(filePath) || /\.spec\.[jt]sx?$/.test(filePath) ||
      filePath.includes("__tests__/") || filePath.includes("/tests/") || filePath.startsWith("tests/")) return "test";

  // Docs
  if (/\.md$/i.test(filePath) || /\.mdx$/i.test(filePath) ||
      /\.txt$/i.test(filePath) || /\.rst$/i.test(filePath)) return "docs";

  // Config files
  if (/\.json$/i.test(filePath) || /\.ya?ml$/i.test(filePath) ||
      /\.toml$/i.test(filePath) || /\.ini$/i.test(filePath) ||
      /\.env/i.test(filePath) || /\.config\.[jt]s$/i.test(filePath)) return "config";

  // Code (everything else — .ts, .js, .tsx, .jsx, .py, .go, etc.)
  return "code";
}

/**
 * Extract modified file paths from tool call records and classify them.
 *
 * Scans tool calls for write_file operations (which contain file paths in
 * input.path) and rex_update/rex_add operations (which modify PRD metadata).
 * Each path is classified and returned grouped by category.
 *
 * @param toolCalls Array of tool call records from the run
 * @returns Map of FileCategory → array of file paths in that category
 */
export function classifyChangedFiles(toolCalls: ToolCallRecord[]): Map<FileCategory, string[]> {
  const changedFiles = new Set<string>();

  for (const call of toolCalls) {
    if (call.tool === "write_file") {
      const path = call.input.path as string | undefined;
      if (path) changedFiles.add(path);
    }
    // Also detect rex status updates as metadata changes
    if (call.tool === "rex_update" || call.tool === "rex_add") {
      changedFiles.add("prd.json");
    }
  }

  const classified = new Map<FileCategory, string[]>();
  for (const file of changedFiles) {
    const category = classifyFile(file);
    const existing = classified.get(category) ?? [];
    existing.push(file);
    classified.set(category, existing);
  }

  return classified;
}

/**
 * Extract all code-classified files from a classification map.
 *
 * @param classified Map from classifyChangedFiles()
 * @returns Array of file paths classified as "code"
 */
export function getCodeFiles(classified: Map<FileCategory, string[]>): string[] {
  return classified.get("code") ?? [];
}

/**
 * Check if any files in the classification are code files.
 *
 * @param classified Map from classifyChangedFiles()
 * @returns true if there is at least one "code" classified file
 */
export function hasCodeFiles(classified: Map<FileCategory, string[]>): boolean {
  const codeFiles = classified.get("code");
  return codeFiles !== undefined && codeFiles.length > 0;
}
