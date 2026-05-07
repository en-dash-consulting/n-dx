/**
 * Migration pass for flattening single-child wrapper directories in the PRD folder tree.
 *
 * When the serializer detects a feature/task with exactly one child, it skips creating
 * a parent directory and instead embeds parent metadata in the child using __parent* fields.
 * This migration pass performs the inverse operation on existing PRD trees that don't yet
 * have this optimization applied.
 *
 * For each directory D with exactly one child subdirectory and an index.md:
 *   1. Check if child already has __parent* fields (idempotent check)
 *   2. If not optimized yet:
 *      - Extract parent metadata from D's index.md
 *      - Embed parent metadata into child's .md file(s)
 *      - Move child to D's parent directory
 *      - Delete the now-empty D
 *
 * The migration is idempotent: running it twice on the same tree produces no changes.
 *
 * @module core/compact-single-children
 */

import { readdir, readFile, writeFile, rm, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter, type ParseWarning } from "../store/folder-tree-parser.js";
import { emitYamlField } from "../store/folder-tree-serializer.js";

/**
 * Parent fields that are structural (not item content) and must not be
 * embedded as `__parent*` ancestor fields. `children` is reconstructed from
 * directory nesting; storage/routing fields belong to the runtime, not the
 * tree.
 */
const STRUCTURAL_PARENT_FIELDS = new Set<string>([
  "children",
  "branch",
  "sourceFile",
  "requirements",
  "activeIntervals",
  "mergedProposals",
  "tokenUsage",
  "duration",
  "loeRationale",
  "loeConfidence",
]);

/**
 * Result of running the single-child compaction migration.
 */
export interface CompactionResult {
  /** Number of directories that were compacted. */
  compactedCount: number;
  /** Errors encountered during compaction. */
  errors: Array<{ path: string; error: string }>;
}

/**
 * Scan the folder tree and compact all single-child directories.
 * Returns a summary of how many were compacted.
 */
export async function compactSingleChildren(treeRoot: string): Promise<CompactionResult> {
  const result: CompactionResult = {
    compactedCount: 0,
    errors: [],
  };

  const rootExists = await stat(treeRoot)
    .then((s) => s.isDirectory())
    .catch(() => false);

  if (!rootExists) {
    return result; // Tree doesn't exist - nothing to compact
  }

  try {
    await compactDirRecursive(treeRoot, result);
  } catch (err) {
    result.errors.push({
      path: treeRoot,
      error: `Failed to scan tree: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return result;
}

/**
 * Recursively compact a directory and its children.
 * Returns true if the directory was compacted (and should not be recursed into further).
 */
async function compactDirRecursive(dir: string, result: CompactionResult): Promise<boolean> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return false;
  }

  // Separate subdirectories from files
  const subdirs: string[] = [];
  const files = new Set(entries);

  for (const entry of entries) {
    const entryPath = join(dir, entry);
    const isDir = await stat(entryPath)
      .then((s) => s.isDirectory())
      .catch(() => false);

    if (isDir) {
      subdirs.push(entry);
      files.delete(entry);
    }
  }

  // Check if this directory is a single-child wrapper.
  // Single-child case: exactly one subdirectory and an index.md file, AND the
  // wrapper's level is feature-or-lower. Epics are deliberately preserved as
  // top-level directories — the runtime serializer mirrors this rule (see
  // `isFeatureOrLower` in folder-tree-serializer.ts) and removing the epic
  // directory would lose its addressability and break parser depth checks.
  if (subdirs.length === 1 && files.has("index.md")) {
    const childName = subdirs[0];
    const childPath = join(dir, childName);
    const wrapperLevel = await readItemLevel(join(dir, "index.md"));

    if (wrapperLevel && wrapperLevel !== "epic" && !(await isAlreadyOptimized(childPath))) {
      try {
        await compactWrapper(dir, childName, result);
        result.compactedCount++;
        // Return true to indicate this directory was compacted
        // Don't recurse further - the child is now at the parent level
        return true;
      } catch (err) {
        result.errors.push({
          path: dir,
          error: `Failed to compact: ${err instanceof Error ? err.message : String(err)}`,
        });
        // Continue processing other directories on error
      }
    }
  }

  // Recurse into subdirectories (only if this directory wasn't compacted)
  for (const subdir of subdirs) {
    const subdirPath = join(dir, subdir);
    await compactDirRecursive(subdirPath, result);
  }

  return false;
}

/**
 * Read the `level` field from an item's index.md frontmatter. Returns null
 * when the file is missing, malformed, or has no level field.
 */
async function readItemLevel(indexPath: string): Promise<string | null> {
  try {
    const content = await readFile(indexPath, "utf-8");
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return null;
    const levelMatch = fmMatch[1].match(/^level:\s*"?([^"\n]+)"?/m);
    return levelMatch ? levelMatch[1].trim() : null;
  } catch {
    return null;
  }
}

/**
 * Check if a directory's item already has __parent* fields (is already optimized).
 * Returns true if any .md file in the directory contains __parent fields.
 */
async function isAlreadyOptimized(dir: string): Promise<boolean> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;

    try {
      const content = await readFile(join(dir, entry), "utf-8");
      // Check if frontmatter contains __parent fields
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (frontmatterMatch) {
        const frontmatter = frontmatterMatch[1];
        if (frontmatter.includes("__parent")) {
          return true;
        }
      }
    } catch {
      // Continue checking other files
    }
  }

  return false;
}

/**
 * Compact a single-child wrapper directory.
 *
 * 1. Extract parent metadata from wrapper's index.md
 * 2. Embed parent metadata into child's .md file(s)
 * 3. Move child directory to wrapper's parent directory
 * 4. Delete the wrapper directory
 */
async function compactWrapper(
  wrapperDir: string,
  childName: string,
  result: CompactionResult,
): Promise<void> {
  // Read parent metadata from wrapper's index.md
  const parentIndexPath = join(wrapperDir, "index.md");
  let parentContent: string;
  try {
    parentContent = await readFile(parentIndexPath, "utf-8");
  } catch {
    // No index.md found - skip this directory
    return;
  }

  // Parse the parent's frontmatter once via the canonical YAML parser.
  // This handles block scalars, inline JSON flow mappings, empty arrays,
  // nested mappings, and any future field shapes — line-based parsing
  // could not.
  const parseWarnings: ParseWarning[] = [];
  const parentFm = parseFrontmatter(parentContent, parentIndexPath, parseWarnings);
  if (!parentFm) {
    // No parsable frontmatter — might be malformed, skip
    return;
  }

  const childPath = join(wrapperDir, childName);

  // Get child's .md files
  let childEntries: string[];
  try {
    childEntries = await readdir(childPath);
  } catch {
    return;
  }

  // Embed parent metadata into each .md file in the child directory
  for (const entry of childEntries) {
    if (!entry.endsWith(".md")) continue;

    const childFilePath = join(childPath, entry);
    try {
      let childContent = await readFile(childFilePath, "utf-8");
      // Embed parent fields if not already present
      childContent = embedParentFieldsInMarkdown(childContent, parentFm);
      await writeFile(childFilePath, childContent, "utf-8");
    } catch (err) {
      result.errors.push({
        path: childFilePath,
        error: `Failed to embed parent metadata: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Move child directory to grandparent (wrapper's parent)
  const grandparentDir = wrapperDir.split("/").slice(0, -1).join("/");
  const newChildPath = join(grandparentDir, childName);

  try {
    // Move child to grandparent
    await rename(childPath, newChildPath);
  } catch (err) {
    result.errors.push({
      path: childPath,
      error: `Failed to move child directory: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  // Delete the wrapper directory
  try {
    await rm(wrapperDir, { recursive: true, force: true });
  } catch (err) {
    result.errors.push({
      path: wrapperDir,
      error: `Failed to delete wrapper directory: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

/**
 * Embed parent metadata fields into a child's markdown file.
 *
 * If the child already has any `__parent*` field, returns content unchanged
 * (idempotent — the child has already been flattened on a previous pass).
 *
 * Otherwise, appends a `__parent*`-prefixed copy of every value-bearing
 * field from the parsed parent frontmatter to the child's frontmatter,
 * driven by parsed YAML rather than line-level text manipulation:
 *
 *   - The parent's frontmatter is supplied pre-parsed as a `Record`, so
 *     block scalars, inline JSON flow mappings, empty arrays, and nested
 *     structures all round-trip correctly.
 *   - Each field is re-emitted via the same `emitYamlField` helper the
 *     serializer uses, so the appended lines match the encoding rules
 *     of the rest of the tree.
 *   - Keys already starting with `__parent` (an ancestor chain in a
 *     nested single-child case) get an additional `__parent` prefix to
 *     preserve the chain. Other keys are camelCased
 *     (`id` → `__parentId`, `description` → `__parentDescription`).
 *   - Structural fields (`children` and runtime/storage fields) are
 *     skipped — they aren't ancestor metadata.
 *
 * The child's existing frontmatter text is preserved verbatim; only the
 * new `__parent*` lines are appended before the closing `---`.
 */
function embedParentFieldsInMarkdown(
  childContent: string,
  parentFm: Record<string, unknown>,
): string {
  // Idempotent: any existing __parent* field means this file was already flattened.
  if (childContent.includes("__parent")) {
    return childContent;
  }

  // Locate the child's frontmatter block.
  const fmMatch = childContent.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    // No frontmatter - shouldn't happen, but return unchanged
    return childContent;
  }

  const childFm = fmMatch[1];
  const afterFm = childContent.substring(fmMatch.index! + fmMatch[0].length);

  // Re-emit each parent field with a __parent prefix, using the canonical
  // YAML emitter so arrays, objects, and scalars all encode correctly.
  const embeddedLines: string[] = [];
  for (const [key, value] of Object.entries(parentFm)) {
    if (value === undefined || value === null) continue;
    if (STRUCTURAL_PARENT_FIELDS.has(key)) continue;
    const prefixedKey = key.startsWith("__parent")
      ? `__parent${key}`                                       // ancestor chain: __parentId → __parent__parentId
      : `__parent${key.charAt(0).toUpperCase()}${key.slice(1)}`; // id → __parentId
    emitYamlField(embeddedLines, prefixedKey, value);
  }

  if (embeddedLines.length === 0) {
    return childContent;
  }

  // Insert embedded lines at the end of child's frontmatter (before the closing ---)
  const updatedFm = `${childFm}${childFm.endsWith("\n") ? "" : "\n"}${embeddedLines.join("\n")}\n`;
  return `---\n${updatedFm}---${afterFm}`;
}
