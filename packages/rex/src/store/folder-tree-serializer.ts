/**
 * PRD-to-folder-tree serializer.
 *
 * Converts an in-memory PRD item tree to a nested directory structure under
 * a configurable tree root (default: `.rex/prd_tree/`). Each epic, feature,
 * task, and branch subtask maps to one directory containing exactly one
 * `index.md`. Leaf subtasks (no children) are written as bare `<slug>.md`
 * files inside their parent folder.
 *
 * Contract (see docs/architecture/prd-folder-tree-schema.md):
 *   - Folder items: `<slug>/index.md` is the canonical content file
 *   - Leaf subtasks: `<slug>.md` at parent level — leaf only, frontmatter only
 *   - The `## Children` table inside `index.md` is informational; directory
 *     nesting is authoritative for parent-child relationships
 *   - Serialization is incremental: files with unchanged content are not rewritten
 *   - Stale entries (folders & .md files removed from the PRD) are deleted
 *   - Each file write is atomic (temp + rename)
 *   - Unknown PRDItem fields are preserved in frontmatter (round-trip fidelity)
 *
 * @module rex/store/folder-tree-serializer
 */

import { mkdir, readFile, writeFile, readdir, rm, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { PRDItem } from "../schema/index.js";

/**
 * Maximum characters in one path component.
 *
 * Kept at 40 after the id suffix was removed, for path length rather than
 * aesthetics: Windows APIs cap many paths at 260 characters, and the tree
 * nests four levels deep (epic / feature / task / leaf file). At 40 a fully
 * nested worst case stays under that ceiling with room for the repository
 * prefix; raising it would not.
 *
 * The readability win came from dropping the suffix, not from a larger cap —
 * titles previously shared these 40 characters with `-<shortId>`, so they now
 * get roughly seven more before truncation.
 */
export const MAX_SLUG_LENGTH = 40;
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

/**
 * Guard options for the stale-entry cleanup.
 *
 * Serialization deletes every on-disk item absent from the in-memory tree, so
 * a save from a stale snapshot silently destroys items it never loaded. These
 * options let the caller prove its snapshot's age; without them the serializer
 * keeps its legacy delete-freely behavior (for migration internals and tests —
 * production writes go through the stores, which always pass `loadedAt`).
 */
export interface SerializeOptions {
  /**
   * When the document being saved was loaded from this tree (epoch ms).
   * A deletion candidate whose on-disk state is newer than this was written
   * by someone else after the snapshot was taken — the save is stale, and it
   * fails loudly (naming the items) instead of deleting. Pass `0` for "this
   * writer never loaded the tree": every deletion is then refused unless
   * `allowBulkDelete` is set.
   */
  loadedAt?: number;
  /**
   * Explicit intent to delete without staleness proof — a deliberate
   * whole-tree rewrite (migration, restore). Skips the guard entirely.
   */
  allowBulkDelete?: boolean;
}

/** One on-disk entry the serializer wants to remove. */
interface StaleEntry {
  path: string;
  isDir: boolean;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Serialize `items` (a list of epic PRDItems with nested children) to the
 * folder tree at `treeRoot`. Creates missing directories, writes changed
 * files atomically, and removes stale entries.
 *
 * Never throws on I/O errors for individual files — errors propagate to the
 * caller. Call sites should wrap in try/catch if partial failure tolerance
 * is needed.
 */
export async function serializeFolderTree(
  items: PRDItem[],
  treeRoot: string,
  options: SerializeOptions = {},
): Promise<SerializeResult> {
  const result: SerializeResult = {
    filesWritten: 0,
    filesSkipped: 0,
    directoriesCreated: 0,
    directoriesRemoved: 0,
  };

  await ensureDir(treeRoot, result);
  // Deletions are collected during the walk and applied only after the guard
  // passes, so a stale save aborts with nothing deleted — file writes are
  // additive and idempotent, deletions are the destructive part.
  const staleEntries: StaleEntry[] = [];
  await writeSiblings(items, treeRoot, result, staleEntries);

  await guardStaleEntries(staleEntries, options);

  for (const entry of staleEntries) {
    await rm(entry.path, { recursive: entry.isDir, force: true });
    if (entry.isDir) result.directoriesRemoved++;
  }

  return result;
}

/**
 * Refuse deletions a stale snapshot cannot vouch for.
 *
 * With `loadedAt`, a candidate whose newest on-disk mtime (recursive — a fresh
 * child inside an old folder counts) is later than the load was written after
 * the snapshot was taken; deleting it would destroy another writer's work.
 * With no options at all the legacy delete-freely behavior is kept.
 */
async function guardStaleEntries(staleEntries: StaleEntry[], options: SerializeOptions): Promise<void> {
  if (staleEntries.length === 0 || options.allowBulkDelete || options.loadedAt === undefined) return;

  // stat().mtimeMs carries fractional milliseconds while Date.now() is an
  // integer, so a file written in the same millisecond as the load can read
  // as fractionally "newer" than it. Tolerate that granularity — a write the
  // load genuinely raced within 2ms is indistinguishable from one it saw.
  const MTIME_TOLERANCE_MS = 2;

  const violations: string[] = [];
  for (const entry of staleEntries) {
    if ((await newestMtime(entry.path)) > options.loadedAt + MTIME_TOLERANCE_MS) {
      violations.push(await describeEntry(entry));
    }
  }
  if (violations.length === 0) return;

  throw new Error(
    `Stale-save guard: this save would delete ${violations.length} item${violations.length === 1 ? "" : "s"} ` +
      `written after the document being saved was loaded — the snapshot is stale, and saving it would ` +
      `destroy another writer's work:\n` +
      violations.map((v) => `  - ${v}`).join("\n") +
      `\nReload the document (or run the mutation inside store.withTransaction) and retry. ` +
      `A deliberate whole-tree rewrite can pass allowBulkDelete.`,
  );
}

/** Newest mtime under `path` (the entry itself and, for directories, everything inside). */
async function newestMtime(path: string): Promise<number> {
  let newest = 0;
  try {
    const info = await stat(path);
    newest = info.mtimeMs;
    if (!info.isDirectory()) return newest;
    for (const entry of await readdir(path)) {
      const childNewest = await newestMtime(join(path, entry));
      if (childNewest > newest) newest = childNewest;
    }
  } catch {
    // Vanished mid-scan — nothing left to protect.
  }
  return newest;
}

/** Human-readable identity for a doomed entry: title and id from its frontmatter, else its path. */
async function describeEntry(entry: StaleEntry): Promise<string> {
  const contentFile = entry.isDir ? join(entry.path, "index.md") : entry.path;
  try {
    const raw = await readFile(contentFile, "utf8");
    const title = /^title:\s*"?(.*?)"?\s*$/m.exec(raw)?.[1];
    const id = /^id:\s*"?([^"\n]+?)"?\s*$/m.exec(raw)?.[1];
    if (title || id) return `${title ?? "(untitled)"} [${id ?? "?"}] (${entry.path})`;
  } catch {
    // No readable frontmatter — the path still identifies it.
  }
  return entry.path;
}

/**
 * Recursively serialize a list of sibling items into `parentDir`.
 *
 * The schema rule is uniform across levels: an item with children is a
 * folder containing `index.md` (frontmatter + `## Children` table); an
 * item with no children is a bare `<slug>.md` file at `parentDir`. A
 * folder is never created just to hold a single `index.md` — that would
 * collapse to the bare-file form.
 *
 * Cleans up stale subdirectories and stale `.md` files at `parentDir`
 * before returning. The owner's own `index.md` (when this directory is
 * itself a folder item) is never touched at this level — it is written by
 * the caller before the recursion that produced these siblings.
 */
async function writeSiblings(
  items: PRDItem[],
  parentDir: string,
  result: SerializeResult,
  staleEntries: StaleEntry[],
): Promise<void> {
  const positionalSlugs = resolvePositionalSiblingSlugs(items);
  const folderSlugs = new Set<string>();
  const leafFiles = new Set<string>();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const itemSlug = positionalSlugs[i];
    const children = item.children ?? [];

    // Leaf item (any level): bare `<slug>.md` at parentDir. It carries
    // only its own frontmatter — no children listing, no parent metadata.
    if (children.length === 0) {
      const leafFilename = `${itemSlug}.md`;
      const leafPath = join(parentDir, leafFilename);
      const itemContent = renderItemIndexMd(item, [], new Map());
      await writeIfChanged(leafPath, itemContent, result);
      leafFiles.add(leafFilename);
      continue;
    }

    // Branch item: own folder with `index.md` listing children.
    folderSlugs.add(itemSlug);
    const itemDir = join(parentDir, itemSlug);
    await ensureDir(itemDir, result);

    const childSlugs = resolveSiblingSlugs(children);
    const itemContent = renderItemIndexMd(item, children, childSlugs);
    const itemPath = join(itemDir, "index.md");
    await writeIfChanged(itemPath, itemContent, result);

    // Recurse into the item's directory; cleanup happens inside writeSiblings.
    await writeSiblings(children, itemDir, result, staleEntries);
  }

  await collectStaleEntries(parentDir, folderSlugs, leafFiles, staleEntries);
}

/**
 * Derive a deterministic, readable directory slug for one item.
 *
 * Title only: the id lives in front matter and no longer appears in the path.
 * Paths are read by people constantly and diverge across branches rarely, so
 * the tree reads as prose — `authentication/oauth2-integration/handle-the-
 * callback.md` — and each level adds its own specificity rather than repeating
 * an id.
 *
 * The `-{id6}` suffix this replaces existed for a real reason: two same-titled
 * items created on divergent branches land on identical paths, and a git merge
 * can silently unify two distinct items. That hazard has not gone away; it is
 * now caught after the fact instead of prevented by the path. `rex validate`
 * runs the raw-tree duplicate-id scan, which reports one id appearing at two
 * paths — the signature of exactly that merge. A collision-only suffix was not
 * an option: each branch sees no local collision, so neither would add one.
 *
 * `id` is retained in the signature: callers pass it, and it still
 * disambiguates the final fallback when a title normalises to nothing.
 */
export function slugify(title: string, id: string): string {
  const slug = truncateAtWordBoundary(normalizeTitleSlug(title), MAX_SLUG_LENGTH);
  // A title of only punctuation normalises away; fall back to the id so the
  // item still gets a stable, unique-ish path rather than an empty one.
  return slug || shortId(id);
}

/** One tree path that disagrees with the slug the current rule would produce. */
export interface SlugMismatch {
  /** Item id, from the in-memory document. */
  id: string;
  /** Item title, for a readable message. */
  title: string;
  /** Directory containing the entry, relative to the tree root. */
  parentDir: string;
  /** Slug the current rule produces. */
  expected: string;
  /** Slug actually on disk. */
  found: string;
}

/**
 * Find tree paths whose slug is not what {@link slugify} would produce.
 *
 * The point is to notice a *foreign writer*. The id-qualified rule landed
 * 2026-08-26; an older rex build — a stale `dist/`, a globally installed
 * earlier version, an MCP server spawned from either — re-serializes the whole
 * tree to the suffix-less form on its first write. That rewrite is invisible to
 * every other check: the renames are lossless, the item fields are untouched,
 * and `validate` never looks at the paths items live in. So an 800-file rewrite
 * reads as a clean tree and lands in whatever branch is open.
 *
 * An item whose expected file is simply missing is *not* reported here. That is
 * a different fault with its own reporting, and folding it in would make this
 * finding noisy enough to ignore.
 */
export async function findNonConformingSlugs(
  items: PRDItem[],
  treeRoot: string,
): Promise<SlugMismatch[]> {
  const mismatches: SlugMismatch[] = [];

  async function walk(siblings: PRDItem[], dir: string, relDir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return; // Directory absent — nothing to compare against.
    }
    const present = new Set(entries);

    const expectedBySlug = resolveSiblingSlugs(siblings);

    for (const item of siblings) {
      const children = item.children ?? [];
      // Sibling-aware: a legitimately disambiguated collision is conforming,
      // and comparing against bare `slugify` reported those as foreign.
      const expected = expectedBySlug.get(item.id) ?? slugify(item.title, item.id);
      // Items with children are directories; leaves are bare `<slug>.md`.
      const expectedEntry = children.length > 0 ? expected : `${expected}.md`;

      if (!present.has(expectedEntry)) {
        // Look for the same item under a different slug before concluding
        // anything: only a *rival* entry proves a foreign convention, whereas
        // nothing at all just means the file is missing.
        const found = await locateById(dir, entries, item.id, children.length > 0);
        if (found) {
          mismatches.push({
            id: item.id,
            title: item.title,
            parentDir: relDir || ".",
            expected: expectedEntry,
            found,
          });
        }
      }

      if (children.length > 0) {
        const actualDir = present.has(expected)
          ? expected
          : (await locateById(dir, entries, item.id, true)) ?? expected;
        await walk(children, join(dir, actualDir), join(relDir, actualDir));
      }
    }
  }

  await walk(items, treeRoot, "");
  return mismatches;
}

/** Entry in `dir` whose front-matter id is `id`, or undefined. */
async function locateById(
  dir: string,
  entries: readonly string[],
  id: string,
  wantDirectory: boolean,
): Promise<string | undefined> {
  for (const entry of entries) {
    if (entry === "tree-meta.json") continue;
    const candidate = wantDirectory ? join(dir, entry, "index.md") : join(dir, entry);
    if (!wantDirectory && !entry.endsWith(".md")) continue;
    if (!wantDirectory && entry === "index.md") continue;
    try {
      const raw = await readFile(candidate, "utf8");
      if (new RegExp(`^id:\\s*"?${escapeForRegExp(id)}"?\\s*$`, "m").test(raw)) return entry;
    } catch {
      // Not readable or not the shape we are looking for.
    }
  }
  return undefined;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Convert a title into the slug it would use before ID-based uniqueness rules.
 * This is deterministic for a title alone and never returns an empty string.
 */
export function slugifyTitle(title: string): string {
  return truncateAtWordBoundary(normalizeTitleSlug(title), MAX_SLUG_LENGTH);
}

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
  // Keyed by POSITION, not id. `resolveSiblingSlugs` returns a Map keyed by id,
  // so two siblings sharing an id — a data invariant violation `validate`
  // reports separately — collapse to one entry there. This is the writing path,
  // where that collapse means one item overwrites the other and is lost, so it
  // keeps its own array-shaped pass. The disambiguation rule is the same one.
  const wanted = items.map((item) => slugify(item.title, item.id));
  const counts = new Map<string, number>();
  for (const slug of wanted) counts.set(slug, (counts.get(slug) ?? 0) + 1);

  const used = new Set<string>();
  return items.map((item, i) => {
    const base = wanted[i];
    let slug = (counts.get(base) ?? 0) > 1 ? `${base}-${shortId(item.id)}` : base;
    let n = 2;
    while (used.has(slug)) slug = `${base}-${shortId(item.id)}-${n++}`;
    used.add(slug);
    return slug;
  });
}

/**
 * Resolve final directory slugs for sibling items.
 *
 * Every slug is id-qualified by `slugify`, so distinct sibling ids can never
 * collide; the map form is kept for callers that key by item id.
 *
 * @public — used by folder-tree-mutations for rendering
 */
export function resolveSiblingSlugs(items: PRDItem[]): Map<string, string> {
  const wanted = items.map((item) => slugify(item.title, item.id));

  // Title-only slugs can genuinely collide: two siblings whose titles normalise
  // to the same string want the same path, and the second write would clobber
  // the first. Only the colliding entries take a `-<shortId>` suffix, so the
  // common case stays readable and the exceptional case stays lossless.
  //
  // This is a *local* guarantee and is not the cross-branch protection the
  // unconditional suffix used to provide — two branches each see one item and
  // no collision. That case is caught after merging by the duplicate-id scan
  // in `rex validate`.
  const counts = new Map<string, number>();
  for (const slug of wanted) counts.set(slug, (counts.get(slug) ?? 0) + 1);

  const resolved = new Map<string, string>();
  const used = new Set<string>();
  items.forEach((item, i) => {
    const base = wanted[i];
    let slug = (counts.get(base) ?? 0) > 1 ? `${base}-${shortId(item.id)}` : base;
    // Belt and braces: identical (title, id) pairs — a data invariant violation
    // `validate` reports separately — still get distinct directories.
    let n = 2;
    while (used.has(slug)) slug = `${base}-${shortId(item.id)}-${n++}`;
    used.add(slug);
    resolved.set(item.id, slug);
  });
  return resolved;
}

function normalizeTitleSlug(title: string): string {
  const body = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return body || EMPTY_TITLE_SLUG;
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
 * Render the index.md (or leaf `.md`) content for any item.
 *
 * The output is `<frontmatter>` + (optional) `## Children` table linking to
 * each child's storage path. Leaf subtask children link to `./<slug>.md`;
 * folder children link to `./<slug>/index.md`. For leaf items pass an empty
 * `children` array — no Children table will be emitted.
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
      // Leaf children (no own children, any level) live as bare `<slug>.md`
      // at this level; branch children get their own folder.
      const isLeaf = (child.children?.length ?? 0) === 0;
      const link = isLeaf ? `./${slug}.md` : `./${slug}/index.md`;
      lines.push(`| [${child.title}](${link}) | ${child.status} |`);
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
 * from folder-tree frontmatter because they are not item content. The
 * `__parent*` fields are legacy single-child-compaction shims that the
 * current serializer never emits; they are filtered here as defense-in-depth
 * so an in-memory item carrying stale shims (e.g. just-loaded from a legacy
 * tree) round-trips clean.
 */
const STORAGE_FIELDS = new Set([
  "children", "branch", "sourceFile", "requirements",
  "activeIntervals", "mergedProposals",
  "tokenUsage", "duration", "loeRationale", "loeConfidence",
]);

/**
 * Emit YAML frontmatter lines for `item` into `lines`.
 * Known fields are emitted in ORDERED_FIELDS order; unknown extra fields
 * (not in ORDERED_FIELDS and not in STORAGE_FIELDS, and not `__parent*`
 * legacy shims) are emitted alphabetically after the known set to ensure
 * round-trip fidelity for future extensions.
 */
function emitFrontmatter(lines: string[], item: PRDItem): void {
  const emitted = new Set<string>();

  for (const key of ORDERED_FIELDS) {
    const value = (item as Record<string, unknown>)[key];
    if (value === undefined || value === null) continue;
    emitYamlField(lines, key, value);
    emitted.add(key);
  }

  // Emit unknown extra fields alphabetically (round-trip fidelity), but
  // never re-emit `__parent*` legacy shims — see STORAGE_FIELDS comment.
  const extraKeys = Object.keys(item)
    .filter((k) => !emitted.has(k) && !STORAGE_FIELDS.has(k) && !k.startsWith("__parent"))
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

// ── Stale-entry cleanup ──────────────────────────────────────────────────────

/**
 * Collect stale subdirectories and stale `.md` files in `dir`.
 *
 * - Subdirectories whose names are not in `expectedSubdirs` are stale.
 * - Plain `.md` files whose names are not in `expectedFiles` are stale,
 *   except `index.md` (the owning folder item's content file is written by
 *   the caller in a separate step).
 * - Dotfiles, dotdirs, and non-md files are left untouched so adjacent
 *   tooling output (caches, lockfiles, hand-managed README files) survives.
 *
 * Nothing is deleted here: the entries are appended to `staleEntries`, and
 * `serializeFolderTree` deletes them only after the stale-save guard passes —
 * a save that would destroy another writer's items must abort with nothing
 * deleted, not part-way through.
 */
async function collectStaleEntries(
  dir: string,
  expectedSubdirs: Set<string>,
  expectedFiles: Set<string>,
  staleEntries: StaleEntry[],
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    if (entry === "index.md") continue;

    const entryPath = join(dir, entry);
    let isDir: boolean;
    try {
      isDir = (await stat(entryPath)).isDirectory();
    } catch {
      continue;
    }

    if (isDir) {
      if (expectedSubdirs.has(entry)) continue;
      staleEntries.push({ path: entryPath, isDir: true });
      continue;
    }

    if (entry.endsWith(".md") && !expectedFiles.has(entry)) {
      staleEntries.push({ path: entryPath, isDir: false });
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
