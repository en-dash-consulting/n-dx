/**
 * PRD-to-folder-tree serializer.
 *
 * Converts an in-memory PRD item tree to a nested directory structure under
 * a configurable tree root (default: `.rex/tree/`). Each epic, feature, and
 * task maps to one directory containing one `index.md`. Subtasks are encoded
 * as `## Subtask:` sections inside their parent task's `index.md`.
 *
 * Contract (see docs/architecture/prd-folder-tree-schema.md):
 *   - Depth 1 dirs → epics, depth 2 → features, depth 3 → tasks
 *   - Subtasks appear as sections, not directories
 *   - Non-leaf index.md files include a `## Children` table
 *   - Serialization is incremental: files with unchanged content are not rewritten
 *   - Stale directories (items removed from the PRD) are deleted
 *   - Each file write is atomic (temp + rename)
 *   - Unknown PRDItem fields are preserved in frontmatter (round-trip fidelity)
 *
 * @module rex/store/folder-tree-serializer
 */

import { mkdir, readFile, writeFile, readdir, rm, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { PRDItem } from "../schema/index.js";

// ── Public types ──────────────────────────────────────────────────────────────

/** Summary of what the serializer wrote. */
export interface SerializeResult {
  /** Files written (new or content-changed). */
  filesWritten: number;
  /** Files skipped (content identical to existing). */
  filesSkipped: number;
  /** Directories created. */
  directoriesCreated: number;
  /** Stale directories removed (items no longer in PRD). */
  directoriesRemoved: number;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Serialize `items` (a list of epic PRDItems with nested children) to the
 * folder tree at `treeRoot`. Creates missing directories, writes changed
 * files atomically, and removes stale directories.
 *
 * Never throws on I/O errors for individual files — errors propagate to the
 * caller. Call sites should wrap in try/catch if partial failure tolerance
 * is needed.
 */
export async function serializeFolderTree(
  items: PRDItem[],
  treeRoot: string,
): Promise<SerializeResult> {
  const result: SerializeResult = {
    filesWritten: 0,
    filesSkipped: 0,
    directoriesCreated: 0,
    directoriesRemoved: 0,
  };

  await ensureDir(treeRoot, result);

  // Compute expected epic slugs and write each epic subtree.
  const expectedEpicSlugs = new Set<string>();
  for (const epic of items) {
    const epicSlug = slugify(epic.title, epic.id);
    expectedEpicSlugs.add(epicSlug);
    const epicDir = join(treeRoot, epicSlug);
    await ensureDir(epicDir, result);

    const features = (epic.children ?? []).filter(c => c.level === "feature");
    const content = renderEpicOrFeatureIndexMd(epic, features);
    await writeIfChanged(join(epicDir, "index.md"), content, result);

    const expectedFeatureSlugs = new Set<string>();
    for (const feature of features) {
      const featureSlug = slugify(feature.title, feature.id);
      expectedFeatureSlugs.add(featureSlug);
      const featureDir = join(epicDir, featureSlug);
      await ensureDir(featureDir, result);

      const tasks = (feature.children ?? []).filter(c => c.level === "task");
      const featureContent = renderEpicOrFeatureIndexMd(feature, tasks);
      await writeIfChanged(join(featureDir, "index.md"), featureContent, result);

      const expectedTaskSlugs = new Set<string>();
      for (const task of tasks) {
        const taskSlug = slugify(task.title, task.id);
        expectedTaskSlugs.add(taskSlug);
        const taskDir = join(featureDir, taskSlug);
        await ensureDir(taskDir, result);

        const taskContent = renderTaskIndexMd(task);
        await writeIfChanged(join(taskDir, "index.md"), taskContent, result);
      }

      await removeStaleSubdirs(featureDir, expectedTaskSlugs, result);
    }

    await removeStaleSubdirs(epicDir, expectedFeatureSlugs, result);
  }

  await removeStaleSubdirs(treeRoot, expectedEpicSlugs, result);

  return result;
}

/**
 * Derive a deterministic directory slug from an item's title and ID.
 *
 * Algorithm (10 steps, see docs/architecture/prd-folder-tree-schema.md):
 *   1. NFKD normalize
 *   2. Strip combining characters
 *   3. Remove non-ASCII
 *   4. Lowercase
 *   5. Replace whitespace runs with a single hyphen
 *   6. Remove characters outside [a-z0-9-]
 *   7. Collapse consecutive hyphens
 *   8. Strip leading/trailing hyphens
 *   9. Truncate to ≤40 chars at a segment boundary
 *  10. Append `-{id8}` (first 8 hex chars of the UUID, hyphens removed)
 */
export function slugify(title: string, id: string): string {
  let body = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")   // step 2: combining chars
    .replace(/[^\x00-\x7F]/g, "")      // step 3: non-ASCII
    .toLowerCase()                      // step 4
    .replace(/\s+/g, "-")              // step 5
    .replace(/[^a-z0-9-]/g, "")        // step 6
    .replace(/-+/g, "-")               // step 7
    .replace(/^-|-$/g, "");            // step 8

  // Step 9: truncate to ≤40 chars at segment boundary
  if (body.length > 40) {
    const candidate = body.slice(0, 40);
    const lastHyphen = candidate.lastIndexOf("-");
    body = lastHyphen > 0 ? candidate.slice(0, lastHyphen) : candidate;
  }

  // Step 10: append id8
  const id8 = id.replace(/-/g, "").slice(0, 8);
  return body ? `${body}-${id8}` : id8;
}

// ── Rendering ─────────────────────────────────────────────────────────────────

/**
 * Render the index.md for an epic or feature item.
 * Includes a `## Children` section if `children` is non-empty.
 */
function renderEpicOrFeatureIndexMd(item: PRDItem, children: PRDItem[]): string {
  const lines: string[] = [];

  lines.push("---");
  emitFrontmatter(lines, item);
  lines.push("---");
  lines.push("");

  if (children.length > 0) {
    lines.push("## Children");
    lines.push("");
    lines.push("| Title | Status |");
    lines.push("|-------|--------|");
    for (const child of children) {
      const slug = slugify(child.title, child.id);
      lines.push(`| [${child.title}](./${slug}/index.md) | ${child.status} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Render the index.md for a task item.
 * Subtasks are encoded as `## Subtask:` sections; no `## Children` table.
 */
function renderTaskIndexMd(task: PRDItem): string {
  const lines: string[] = [];

  lines.push("---");
  emitFrontmatter(lines, task);
  lines.push("---");
  lines.push("");

  const subtasks = (task.children ?? []).filter(c => c.level === "subtask");
  for (const subtask of subtasks) {
    lines.push(`## Subtask: ${subtask.title}`);
    lines.push("");
    lines.push(`**ID:** \`${subtask.id}\``);
    lines.push(`**Status:** ${subtask.status}`);
    if (subtask.priority) lines.push(`**Priority:** ${subtask.priority}`);
    lines.push("");
    if (subtask.description) {
      lines.push(subtask.description);
      lines.push("");
    }
    if (subtask.acceptanceCriteria && subtask.acceptanceCriteria.length > 0) {
      lines.push("**Acceptance Criteria**");
      lines.push("");
      for (const ac of subtask.acceptanceCriteria) {
        lines.push(`- ${ac}`);
      }
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

// ── Frontmatter emission ──────────────────────────────────────────────────────

/**
 * Fields emitted in fixed order. Only fields with a value are written.
 * `children` is always omitted (handled structurally).
 */
const ORDERED_FIELDS: ReadonlyArray<string> = [
  "id", "level", "title", "status", "priority", "tags", "source",
  "startedAt", "completedAt", "endedAt",
  "resolutionType", "resolutionDetail", "failureReason",
  "acceptanceCriteria", "loe", "description",
];

/**
 * PRDItem fields that are storage/routing metadata — intentionally excluded
 * from folder-tree frontmatter because they are not item content.
 */
const STORAGE_FIELDS = new Set([
  "children", "branch", "sourceFile", "blockedBy", "requirements",
  "activeIntervals", "overrideMarker", "mergedProposals",
  "tokenUsage", "duration", "loeRationale", "loeConfidence",
]);

/**
 * Emit YAML frontmatter lines for `item` into `lines`.
 * Known fields are emitted in ORDERED_FIELDS order; unknown extra fields
 * (not in ORDERED_FIELDS and not in STORAGE_FIELDS) are emitted alphabetically
 * after the known set to ensure round-trip fidelity for future extensions.
 */
function emitFrontmatter(lines: string[], item: PRDItem): void {
  const emitted = new Set<string>();

  for (const key of ORDERED_FIELDS) {
    const value = (item as Record<string, unknown>)[key];
    if (value === undefined || value === null) continue;
    emitYamlField(lines, key, value);
    emitted.add(key);
  }

  // Emit unknown extra fields alphabetically (round-trip fidelity)
  const extraKeys = Object.keys(item)
    .filter(k => !emitted.has(k) && !STORAGE_FIELDS.has(k))
    .sort();
  for (const key of extraKeys) {
    const value = (item as Record<string, unknown>)[key];
    if (value === undefined || value === null) continue;
    emitYamlField(lines, key, value);
  }
}

/** Emit one YAML key-value line (or block) into `lines`. */
function emitYamlField(lines: string[], key: string, value: unknown): void {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`${key}: []`);
    } else {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${JSON.stringify(String(item))}`);
      }
    }
  } else {
    lines.push(`${key}: ${JSON.stringify(String(value))}`);
  }
}

// ── I/O helpers ───────────────────────────────────────────────────────────────

/** Create directory if it does not exist. Increments directoriesCreated. */
async function ensureDir(dir: string, result: SerializeResult): Promise<void> {
  try {
    await stat(dir);
  } catch {
    await mkdir(dir, { recursive: true });
    result.directoriesCreated++;
  }
}

/**
 * Write `content` to `filePath` atomically, but only if the existing content
 * differs. Uses a temp-file + rename strategy to prevent torn reads.
 */
async function writeIfChanged(
  filePath: string,
  content: string,
  result: SerializeResult,
): Promise<void> {
  try {
    const existing = await readFile(filePath, "utf8");
    if (existing === content) {
      result.filesSkipped++;
      return;
    }
  } catch {
    // File does not exist — proceed with write
  }

  const tmpPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmpPath, content, "utf8");
  await rename(tmpPath, filePath);
  result.filesWritten++;
}

/**
 * Remove subdirectories of `dir` whose names are not in `expectedSlugs`.
 * Increments directoriesRemoved for each removal.
 */
async function removeStaleSubdirs(
  dir: string,
  expectedSlugs: Set<string>,
  result: SerializeResult,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (expectedSlugs.has(entry)) continue;
    const entryPath = join(dir, entry);
    let isDir: boolean;
    try {
      isDir = (await stat(entryPath)).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    await rm(entryPath, { recursive: true, force: true });
    result.directoriesRemoved++;
  }
}
