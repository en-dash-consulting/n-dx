/**
 * PRD-to-folder-tree serializer.
 *
 * Converts an in-memory PRD item tree to a nested directory structure under
 * a configurable tree root (default: `.rex/tree/`). Each epic, feature, task,
 * and subtask maps to one directory containing one `index.md`.
 *
 * Contract (see docs/architecture/prd-folder-tree-schema.md):
 *   - Depth 1 dirs -> epics, depth 2 -> features, depth 3 -> tasks, depth 4 -> subtasks
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

const MAX_SLUG_LENGTH = 60;
const SHORT_ID_LENGTH = 6;
const EMPTY_TITLE_SLUG = "untitled";

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

  const rootSlugs = resolveSiblingSlugs(items);
  const expectedEpicSlugs = new Set<string>();
  for (const epic of items) {
    const epicSlug = requireSlug(rootSlugs, epic);
    expectedEpicSlugs.add(epicSlug);
    const epicDir = join(treeRoot, epicSlug);
    await ensureDir(epicDir, result);

    const features = (epic.children ?? []).filter(c => c.level === "feature");
    const featureSlugs = resolveSiblingSlugs(features);
    const content = renderItemIndexMd(epic, features, featureSlugs);
    await writeIfChanged(join(epicDir, "index.md"), content, result);

    const expectedFeatureSlugs = new Set<string>();
    for (const feature of features) {
      const featureSlug = requireSlug(featureSlugs, feature);
      expectedFeatureSlugs.add(featureSlug);
      const featureDir = join(epicDir, featureSlug);
      await ensureDir(featureDir, result);

      const tasks = (feature.children ?? []).filter(c => c.level === "task");
      const taskSlugs = resolveSiblingSlugs(tasks);
      const featureContent = renderItemIndexMd(feature, tasks, taskSlugs);
      await writeIfChanged(join(featureDir, "index.md"), featureContent, result);

      const expectedTaskSlugs = new Set<string>();
      for (const task of tasks) {
        const taskSlug = requireSlug(taskSlugs, task);
        expectedTaskSlugs.add(taskSlug);
        const taskDir = join(featureDir, taskSlug);
        await ensureDir(taskDir, result);

        const subtasks = (task.children ?? []).filter(c => c.level === "subtask");
        const subtaskSlugs = resolveSiblingSlugs(subtasks);
        const taskContent = renderItemIndexMd(task, subtasks, subtaskSlugs);
        await writeIfChanged(join(taskDir, "index.md"), taskContent, result);

        const expectedSubtaskSlugs = new Set<string>();
        for (const subtask of subtasks) {
          const subtaskSlug = requireSlug(subtaskSlugs, subtask);
          expectedSubtaskSlugs.add(subtaskSlug);
          const subtaskDir = join(taskDir, subtaskSlug);
          await ensureDir(subtaskDir, result);

          const subtaskContent = renderItemIndexMd(subtask, [], new Map());
          await writeIfChanged(join(subtaskDir, "index.md"), subtaskContent, result);
        }

        await removeStaleSubdirs(taskDir, expectedSubtaskSlugs, result);
      }

      await removeStaleSubdirs(featureDir, expectedTaskSlugs, result);
    }

    await removeStaleSubdirs(epicDir, expectedFeatureSlugs, result);
  }

  await removeStaleSubdirs(treeRoot, expectedEpicSlugs, result);

  return result;
}

/**
 * Derive a deterministic, title-first directory slug for one item.
 *
 * Normal titles produce the same slug regardless of ID. Titles whose normalized
 * slug exceeds 60 characters reserve room for `-{id6}` and append the first
 * six safe ID characters. Sibling collision suffixes are applied by
 * `resolveSiblingSlugs`, because collision detection requires parent context.
 */
export function slugify(title: string, id: string): string {
  const body = normalizeTitleSlug(title);
  if (!requiresLongSuffix(title, body)) return body;
  return appendShortIdSuffix(body, id);
}

/**
 * Convert a title into the slug it would use before ID-based uniqueness rules.
 * This is deterministic for a title alone and never returns an empty string.
 */
export function slugifyTitle(title: string): string {
  return truncateAtWordBoundary(normalizeTitleSlug(title), MAX_SLUG_LENGTH);
}

/**
 * Resolve final directory slugs for sibling items.
 *
 * If two siblings normalize to the same unsuffixed slug, every colliding item
 * gets a short ID suffix. This keeps results deterministic regardless of item
 * order and avoids giving the first item a privileged unsuffixed path.
 */
export function resolveSiblingSlugs(items: PRDItem[]): Map<string, string> {
  const unsuffixedById = new Map<string, string>();
  const counts = new Map<string, number>();

  for (const item of items) {
    const unsuffixed = slugifyTitle(item.title);
    unsuffixedById.set(item.id, unsuffixed);
    counts.set(unsuffixed, (counts.get(unsuffixed) ?? 0) + 1);
  }

  const resolved = new Map<string, string>();
  for (const item of items) {
    const normalized = normalizeTitleSlug(item.title);
    const unsuffixed = requireMapValue(unsuffixedById, item.id);
    const collides = (counts.get(unsuffixed) ?? 0) > 1;
    resolved.set(item.id, requiresLongSuffix(item.title, normalized) || collides
      ? appendShortIdSuffix(normalized, item.id)
      : unsuffixed);
  }

  return resolved;
}

function normalizeTitleSlug(title: string): string {
  const body = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return body || EMPTY_TITLE_SLUG;
}

function requiresLongSuffix(title: string, normalizedSlug: string): boolean {
  return Array.from(title).length > MAX_SLUG_LENGTH || normalizedSlug.length > MAX_SLUG_LENGTH;
}

function appendShortIdSuffix(slug: string, id: string): string {
  const suffix = shortId(id);
  const prefixLimit = MAX_SLUG_LENGTH - suffix.length - 1;
  const prefix = truncateAtWordBoundary(slug, prefixLimit);
  return prefix ? `${prefix}-${suffix}` : suffix;
}

function shortId(id: string): string {
  const safe = id.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, SHORT_ID_LENGTH);
  return safe || "item";
}

function truncateAtWordBoundary(slug: string, maxLength: number): string {
  if (slug.length <= maxLength) return slug;

  const candidate = slug.slice(0, maxLength).replace(/-+$/g, "");
  const lastHyphen = candidate.lastIndexOf("-");
  if (lastHyphen > 0) return candidate.slice(0, lastHyphen);
  return candidate;
}

function requireSlug(slugs: Map<string, string>, item: PRDItem): string {
  return requireMapValue(slugs, item.id);
}

function requireMapValue(map: Map<string, string>, key: string): string {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`Missing slug for item "${key}"`);
  }
  return value;
}

// ── Rendering ─────────────────────────────────────────────────────────────────

/**
 * Render the index.md for any item.
 * Includes a `## Children` section if `children` is non-empty.
 */
function renderItemIndexMd(
  item: PRDItem,
  children: PRDItem[],
  childSlugs: Map<string, string>,
): string {
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
      const slug = requireSlug(childSlugs, child);
      lines.push(`| [${child.title}](./${slug}/index.md) | ${child.status} |`);
    }
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
  "id", "level", "title", "status", "priority", "tags", "blockedBy", "source",
  "startedAt", "completedAt", "endedAt",
  "resolutionType", "resolutionDetail", "failureReason",
  "acceptanceCriteria", "loe", "description",
];

/**
 * PRDItem fields that are storage/routing metadata — intentionally excluded
 * from folder-tree frontmatter because they are not item content.
 */
const STORAGE_FIELDS = new Set([
  "children", "branch", "sourceFile", "requirements",
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
