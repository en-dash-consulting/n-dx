/**
 * PRD-to-folder-tree serializer.
 *
 * Converts an in-memory PRD item tree to a nested directory structure under
 * a configurable tree root (default: `.rex/prd_tree/`). Each epic, feature, task,
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
import { titleToFilename } from "./title-to-filename.js";
import { generateIndexMd } from "./folder-tree-index-generator.js";

const MAX_SLUG_LENGTH = 40;
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
  await serializeChildren(items, treeRoot, result);

  return result;
}

/**
 * Recursively serialize a list of sibling items into `parentDir`.
 *
 * Each item gets its own directory, regardless of level. Children are
 * serialized one level deeper, also regardless of level. This preserves
 * skip-level placements that are legal under {@link LEVEL_HIERARCHY}
 * (e.g. a task placed directly under an epic without an intermediate
 * feature) without dropping or re-typing data.
 *
 * Single-child optimization: When an item has exactly one child, the child's
 * file is written directly to the parent's directory (not in a subdirectory),
 * and the parent's metadata is embedded in the child's frontmatter using
 * `__parent*` fields. The parent's own .md file is not created.
 *
 * The directory contains:
 *   - `<title>.md` — the item's primary markdown (with full frontmatter)
 *   - `index.md`   — human-readable summary (Progress / Subtask sections)
 * and one subdirectory per child, recursively (unless single-child optimization applies).
 *
 * Stale sibling directories under `parentDir` (items removed from the
 * source tree) are deleted via {@link removeStaleSubdirs}.
 */
async function serializeChildren(
  items: PRDItem[],
  parentDir: string,
  result: SerializeResult,
): Promise<void> {
  // Position-keyed slugs survive duplicate-id inputs: id-keyed lookups would
  // collapse two same-id items into one slot. The public id-keyed
  // `resolveSiblingSlugs` API is unchanged for external callers — only this
  // internal serialization path uses positional slugs.
  const positionalSlugs = resolvePositionalSiblingSlugs(items);
  const expectedSlugs = new Set<string>();
  let hadSingleChildOptimization = false;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const itemSlug = positionalSlugs[i];
    const children = item.children ?? [];
    const childSlugs = resolveSiblingSlugs(children);

    // Single-child optimization: if this item is a feature (or lower level)
    // and has exactly one child, embed parent metadata in the child and serialize
    // the child directly to parentDir instead of creating a directory for the parent.
    // Epics are not optimized to preserve the expected folder structure.
    const isFeatureOrLower = item.level !== "epic";
    if (isFeatureOrLower && children.length === 1) {
      const singleChild = children[0];
      embedParentMetadata(singleChild, item);
      // Serialize the child directly to parentDir (skipping parent's directory)
      // The recursive call will create subdirectories and track them in its own cleanup
      await serializeChildren([singleChild], parentDir, result);
      hadSingleChildOptimization = true;
      // Do NOT add itemSlug to expectedSlugs (parent directory doesn't exist)
      // Note: we don't track the child's slug here because the recursive call
      // has already handled cleanup for its own level. Single-child optimization
      // creates only the leaf-most directory, which is handled correctly by the
      // deepest serializeChildren call.
      continue;
    }

    // Multi-child case: create directory for this item, then recurse into itemDir.
    expectedSlugs.add(itemSlug);
    const itemDir = join(parentDir, itemSlug);
    await ensureDir(itemDir, result);

    // Item file: <title>.md with full frontmatter and a Children link table.
    const itemContent = renderItemIndexMd(item, children, childSlugs);
    const itemFilename = titleToFilename(item.title);
    const itemPath = join(itemDir, itemFilename);
    await writeIfChanged(itemPath, itemContent, result);
    await removeOrphanedMarkdownFiles(itemDir, itemFilename);

    // index.md: human-readable summary (delegates to generateIndexMd, which
    // selectively renders Progress / Subtask sections based on item.level).
    // Only write index.md when the item has children — suppresses duplicate
    // frontmatter for leaf items and ensures index.md serves as a hub/summary only.
    if (children.length > 0) {
      const itemIndexContent = generateIndexMd(item, children, []);
      const itemIndexPath = join(itemDir, "index.md");
      await writeIfChanged(itemIndexPath, itemIndexContent, result);
    } else {
      // For leaf items (no children), remove any stale index.md
      const itemIndexPath = join(itemDir, "index.md");
      try {
        await rm(itemIndexPath, { force: true });
      } catch {
        // File may not exist — silently continue
      }
    }

    // Always recurse so stale child subdirectories are cleaned up even when
    // the item now has no children (e.g. after a move that empties this parent).
    await serializeChildren(children, itemDir, result);
  }

  // For single-child optimization: when some (or all) items at this level are single-child,
  // the recursive calls have already created subdirectories and cleaned up their own levels.
  // Only call removeStaleSubdirs if we created directories at this level, OR if we need
  // to clean up after removing items.
  const shouldCleanup = expectedSlugs.size > 0 || items.length === 0;
  if (shouldCleanup) {
    await removeStaleSubdirs(parentDir, expectedSlugs, result);
  }
}

/**
 * Embed parent metadata into a child item using `__parent*` fields.
 * These fields are preserved through serialization and can be used by the
 * parser to reconstruct the parent during single-child optimization round-trips.
 *
 * Called only when a parent has exactly one child and single-child optimization applies.
 *
 * Note: Does not embed the parent's own `__parent*` fields (which would be from
 * the parent's parent). Those are handled separately during recursive embedding.
 */
function embedParentMetadata(child: PRDItem, parent: PRDItem): void {
  const childRecord = child as Record<string, unknown>;

  // Embed all parent metadata using __parent prefix
  childRecord.__parentId = parent.id;
  childRecord.__parentTitle = parent.title;
  childRecord.__parentStatus = parent.status;
  childRecord.__parentLevel = parent.level;

  if (parent.description !== undefined) {
    childRecord.__parentDescription = parent.description;
  }
  if (parent.priority !== undefined) {
    childRecord.__parentPriority = parent.priority;
  }
  if (parent.tags !== undefined) {
    childRecord.__parentTags = parent.tags;
  }
  if (parent.blockedBy !== undefined) {
    childRecord.__parentBlockedBy = parent.blockedBy;
  }
  if (parent.source !== undefined) {
    childRecord.__parentSource = parent.source;
  }
  if (parent.startedAt !== undefined) {
    childRecord.__parentStartedAt = parent.startedAt;
  }
  if (parent.completedAt !== undefined) {
    childRecord.__parentCompletedAt = parent.completedAt;
  }
  if (parent.endedAt !== undefined) {
    childRecord.__parentEndedAt = parent.endedAt;
  }
  if (parent.resolutionType !== undefined) {
    childRecord.__parentResolutionType = parent.resolutionType;
  }
  if (parent.resolutionDetail !== undefined) {
    childRecord.__parentResolutionDetail = parent.resolutionDetail;
  }
  if (parent.failureReason !== undefined) {
    childRecord.__parentFailureReason = parent.failureReason;
  }
  if (parent.acceptanceCriteria !== undefined) {
    childRecord.__parentAcceptanceCriteria = parent.acceptanceCriteria;
  }
  if ((parent as Record<string, unknown>).loe !== undefined) {
    childRecord.__parentLoe = (parent as Record<string, unknown>).loe;
  }
  // Preserve any unknown fields from parent as well.
  // If the parent has __parent* fields (from its own parent), copy them with
  // an additional __parent prefix to preserve the ancestor chain.
  const knownParentFields = new Set([
    "id", "level", "title", "status", "description", "priority", "tags", "blockedBy",
    "source", "startedAt", "completedAt", "endedAt", "resolutionType",
    "resolutionDetail", "failureReason", "acceptanceCriteria", "loe", "children",
  ]);
  for (const [key, value] of Object.entries(parent)) {
    if (knownParentFields.has(key) || value === undefined || value === null) {
      continue;
    }
    if (key.startsWith("__parent")) {
      // Preserve ancestor fields with an additional __parent prefix
      // __parentId → __parent__parentId, __parentTitle → __parent__parentTitle, etc.
      childRecord[`__parent${key}`] = value;
    } else {
      // Add __parent prefix for other unknown fields
      childRecord[`__parent${key.charAt(0).toUpperCase()}${key.slice(1)}`] = value;
    }
  }
}

/**
 * Derive a deterministic, title-first directory slug for one item.
 *
 * Normal titles produce the same slug regardless of ID. Titles whose normalized
 * slug exceeds 40 characters reserve room for `-{id6}` and append the first
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
/**
 * Resolve final directory slugs by position so duplicate-id inputs survive.
 *
 * Returns an array aligned with `items`. When two siblings share an id (a
 * pre-existing PRD-data invariant violation that downstream `validate`
 * surfaces), each instance still gets its own directory — the migration is
 * lossless even on malformed input. Falls back to position suffixes for
 * remaining slug collisions after the title- and id-based suffix rules
 * already applied by the existing slug system.
 */
function resolvePositionalSiblingSlugs(items: PRDItem[]): string[] {
  const unsuffixed = items.map((item) => slugifyTitle(item.title));
  const titleCounts = new Map<string, number>();
  for (const slug of unsuffixed) {
    titleCounts.set(slug, (titleCounts.get(slug) ?? 0) + 1);
  }

  const initial = items.map((item, i) => {
    const normalized = normalizeTitleSlug(item.title);
    const titleCollides = (titleCounts.get(unsuffixed[i]) ?? 0) > 1;
    if (requiresLongSuffix(item.title, normalized) || titleCollides) {
      return appendShortIdSuffix(normalized, item.id);
    }
    return unsuffixed[i];
  });

  // Final dedup pass — for genuinely identical (title, id) pairs append a
  // position suffix so each item still gets its own directory.
  const finalCounts = new Map<string, number>();
  for (const slug of initial) {
    finalCounts.set(slug, (finalCounts.get(slug) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  return initial.map((slug) => {
    if ((finalCounts.get(slug) ?? 0) <= 1) return slug;
    const idx = seen.get(slug) ?? 0;
    seen.set(slug, idx + 1);
    return `${slug}-${idx + 1}`;
  });
}

/**
 * Resolve final directory slugs for sibling items.
 * If two siblings normalize to the same unsuffixed slug, every colliding item
 * gets a short ID suffix.
 *
 * @public — used by folder-tree-mutations for rendering
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
 *
 * @public — used by folder-tree-mutations for targeted rewrites
 */
export function renderItemIndexMd(
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
  "activeIntervals", "mergedProposals",
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

/**
 * Emit one YAML key-value line (or block) into `lines`.
 *
 * @public — used by core/compact-single-children to re-emit prefixed parent
 * fields with the same encoding rules as the rest of the serializer.
 */
export function emitYamlField(lines: string[], key: string, value: unknown): void {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`${key}: []`);
    } else {
      lines.push(`${key}:`);
      for (const item of value) {
        if (item !== null && typeof item === "object" && !Array.isArray(item)) {
          // Object items emit as inline JSON (valid YAML flow mapping).
          lines.push(`  - ${JSON.stringify(item)}`);
        } else {
          lines.push(`  - ${JSON.stringify(String(item))}`);
        }
      }
    }
  } else if (value !== null && typeof value === "object") {
    // Plain objects emit as inline JSON (valid YAML flow mapping).
    lines.push(`${key}: ${JSON.stringify(value)}`);
  } else {
    lines.push(`${key}: ${JSON.stringify(String(value))}`);
  }
}

// ── Orphaned file cleanup ─────────────────────────────────────────────────────

/**
 * Remove orphaned markdown files in a directory.
 *
 * When an item's title changes, the old markdown file is left behind.
 * This function scans the directory for any .md files other than the current
 * item filename and removes them. Non-throwing: silently continues on errors
 * (permissions, missing dir, etc.).
 *
 * @param dir - Directory to scan
 * @param currentFilename - The current item's markdown filename to keep
 */
async function removeOrphanedMarkdownFiles(dir: string, currentFilename: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    // Directory not readable or missing - nothing to clean
    return;
  }

  for (const entry of entries) {
    // Skip the current item file and non-markdown files
    if (entry === currentFilename || !entry.endsWith(".md")) {
      continue;
    }

    // Remove the orphaned markdown file
    try {
      const filePath = join(dir, entry);
      await rm(filePath, { force: true });
    } catch {
      // Silently continue on removal errors
    }
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
