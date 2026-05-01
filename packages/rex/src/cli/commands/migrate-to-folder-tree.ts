import { join } from "node:path";
import { readdir, readFile, stat, unlink } from "node:fs/promises";
import { info, warn } from "../output.js";
import { serializeFolderTree, parseFolderTree } from "../../store/index.js";
import { parseDocument } from "../../store/markdown-parser.js";
import { validateDocument } from "../../schema/validate.js";
import { SCHEMA_VERSION } from "../../schema/index.js";
import { walkTree } from "../../core/tree.js";
import { CLIError } from "../errors.js";
import { REX_DIR } from "./constants.js";
import { FOLDER_TREE_SUBDIR } from "./folder-tree-sync.js";
import type { PRDDocument, PRDItem } from "../../schema/index.js";
import type { PromptFn } from "./validate-interactive.js";

/**
 * Options for interactive behaviors in the migration command.
 * @internal Exposed for testability — production callers may inject a prompt.
 */
export interface MigrateOptions {
  /** Injectable prompt function for interactive confirmation. */
  prompt?: PromptFn;
}

const PRD_MD_BRANCH_RE = /^prd_(.+)_(\d{4}-\d{2}-\d{2})\.md$/;
const PRD_MARKDOWN_FILENAME = "prd.md";

/**
 * One-shot migration from prd.md to the folder-tree format.
 *
 * Reads the current PRD from prd.md (or branch-scoped variants, or prd.json as
 * a fallback), serializes it to the folder tree at `.rex/prd_tree/`, and prints a
 * summary showing item counts per PRD level.
 *
 * After a successful first migration, offers to delete prd.md and any
 * branch-scoped prd_{branch}_{date}.md files.
 *
 * Idempotent: re-running on an already-migrated project (even after prd.md has
 * been deleted) is a no-op with an informational message.
 */
export async function cmdMigrateToFolderTree(
  dir: string,
  flags?: Record<string, string>,
  options?: MigrateOptions,
): Promise<void> {
  const rexDir = join(dir, REX_DIR);
  const treeRoot = join(rexDir, FOLDER_TREE_SUBDIR);

  const { doc, fromTree } = await loadSourceDocument(rexDir, treeRoot);

  // If we loaded from tree and it's a re-run, be idempotent
  if (fromTree) {
    info(
      `Folder tree already up to date at .rex/${FOLDER_TREE_SUBDIR}/`,
    );
    return;
  }

  const levelCounts = countItemsByLevel(doc.items);
  const result = await serializeFolderTree(doc.items, treeRoot);

  const { directoriesCreated, filesWritten, filesSkipped, directoriesRemoved } = result;
  const isNoOp = directoriesCreated === 0 && filesWritten === 0 && directoriesRemoved === 0;

  if (isNoOp) {
    info(
      `Folder tree already up to date at .rex/${FOLDER_TREE_SUBDIR}/` +
        (filesSkipped > 0 ? ` (${filesSkipped} file${filesSkipped === 1 ? "" : "s"} unchanged)` : ""),
    );
    return;
  }

  info(`Migrated .rex/${PRD_MARKDOWN_FILENAME} → .rex/${FOLDER_TREE_SUBDIR}/`);

  // Item count summary per level
  const levelSummary = buildLevelSummary(levelCounts);
  if (levelSummary) {
    info(`  ${levelSummary}`);
  }

  // Change summary (folders/files)
  const parts: string[] = [];
  if (directoriesCreated > 0) {
    parts.push(`${directoriesCreated} folder${directoriesCreated === 1 ? "" : "s"} created`);
  }
  if (filesWritten > 0) {
    parts.push(`${filesWritten} item file${filesWritten === 1 ? "" : "s"} written`);
  }
  if (directoriesRemoved > 0) {
    parts.push(`${directoriesRemoved} stale folder${directoriesRemoved === 1 ? "" : "s"} removed`);
  }
  if (parts.length > 0) {
    info(`  ${parts.join(", ")}`);
  }

  // Offer to delete prd.md and branch-scoped files
  const autoYes = flags?.yes === "true";
  const effectivePrompt = autoYes ? (() => Promise.resolve("y")) : options?.prompt;
  await offerDeletePrdFiles(rexDir, effectivePrompt);
}

// ── Source loading ────────────────────────────────────────────────────────────

/**
 * Load a PRD document for migration, trying sources in priority order:
 * 1. prd.md (primary Markdown) + any branch-scoped prd_*_*.md files
 * 2. Existing .rex/prd_tree/ folder tree (idempotent re-run after prd.md deletion)
 * 3. prd.json (legacy JSON fallback)
 */
async function loadSourceDocument(rexDir: string, treeRoot: string): Promise<{ doc: PRDDocument; fromTree: boolean }> {
  const primaryDoc = await tryReadMarkdown(join(rexDir, PRD_MARKDOWN_FILENAME));

  if (primaryDoc !== null) {
    const branchFiles = await discoverBranchMdFiles(rexDir);
    const allItems = [...primaryDoc.items];
    for (const file of branchFiles) {
      const branchDoc = await tryReadMarkdown(join(rexDir, file));
      if (branchDoc) allItems.push(...branchDoc.items);
    }
    return { doc: { ...primaryDoc, items: allItems }, fromTree: false };
  }

  // Tree exists → idempotent re-run after prd.md was deleted
  if (await directoryExists(treeRoot)) {
    const { items } = await parseFolderTree(treeRoot);
    const title = await readTreeTitle(rexDir);
    return { doc: { schema: SCHEMA_VERSION, title, items }, fromTree: true };
  }

  // Legacy prd.json fallback
  try {
    const raw = await readFile(join(rexDir, "prd.json"), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    const validated = validateDocument(parsed);
    if (validated.ok) return { doc: validated.data as PRDDocument, fromTree: false };
  } catch {
    // Not found or invalid
  }

  throw new CLIError(
    "No PRD source found.",
    `Expected .rex/prd.md, .rex/${FOLDER_TREE_SUBDIR}/, or .rex/prd.json.`,
  );
}

async function readTreeTitle(rexDir: string): Promise<string> {
  try {
    const raw = await readFile(join(rexDir, "tree-meta.json"), "utf-8");
    const meta = JSON.parse(raw) as Record<string, unknown>;
    if (typeof meta["title"] === "string") return meta["title"];
  } catch { /* ignore */ }
  return "PRD";
}

async function tryReadMarkdown(filePath: string): Promise<PRDDocument | null> {
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
  const parsed = parseDocument(content);
  return parsed.ok ? parsed.data : null;
}

async function discoverBranchMdFiles(rexDir: string): Promise<string[]> {
  try {
    const entries = await readdir(rexDir);
    return entries.filter(name => PRD_MD_BRANCH_RE.test(name)).sort();
  } catch {
    return [];
  }
}

async function directoryExists(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

// ── Item counts ───────────────────────────────────────────────────────────────

interface LevelCounts {
  epic: number;
  feature: number;
  task: number;
  subtask: number;
}

function countItemsByLevel(items: PRDItem[]): LevelCounts {
  const counts: LevelCounts = { epic: 0, feature: 0, task: 0, subtask: 0 };
  for (const { item } of walkTree(items)) {
    if (item.level in counts) {
      (counts as unknown as Record<string, number>)[item.level]++;
    }
  }
  return counts;
}

function buildLevelSummary(counts: LevelCounts): string {
  const parts: string[] = [];
  for (const level of ["epic", "feature", "task", "subtask"] as const) {
    const n = counts[level];
    if (n > 0) parts.push(`${n} ${level}${n === 1 ? "" : "s"}`);
  }
  return parts.join(", ");
}

// ── Delete prompt ─────────────────────────────────────────────────────────────

async function findPrdMarkdownFiles(rexDir: string): Promise<string[]> {
  const files: string[] = [];
  try {
    await stat(join(rexDir, PRD_MARKDOWN_FILENAME));
    files.push(PRD_MARKDOWN_FILENAME);
  } catch { /* not found */ }
  const branchFiles = await discoverBranchMdFiles(rexDir);
  files.push(...branchFiles);
  return files;
}

async function offerDeletePrdFiles(rexDir: string, prompt?: PromptFn): Promise<void> {
  const prdFiles = await findPrdMarkdownFiles(rexDir);
  if (prdFiles.length === 0) return;

  const effectivePrompt = prompt ?? defaultPrompt;
  const count = prdFiles.length;
  const label =
    count === 1
      ? `prd.md`
      : `prd.md and ${count - 1} branch file${count - 1 === 1 ? "" : "s"}`;

  const answer = await effectivePrompt(`Delete ${label}? [y/N] `);
  if (answer.trim().toLowerCase() !== "y" && answer.trim().toLowerCase() !== "yes") return;

  for (const file of prdFiles) {
    try {
      await unlink(join(rexDir, file));
      info(`  Deleted .rex/${file}`);
    } catch {
      warn(`  Could not delete .rex/${file}`);
    }
  }
}

async function defaultPrompt(question: string): Promise<string> {
  const readline = await import("node:readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
  rl.close();
  return answer;
}
