/**
 * The v2 tree writer: a {@link PrdModel} to `<rexDir>/product/` and `<rexDir>/changes/`.
 *
 * The inverse of the v2 branch of `prd-model-reader.ts`. Writes the layout
 * that module documents:
 *
 * - **Frozen slugs.** A node's path comes from its `slug` field, written once
 *   at creation and never recomputed, so editing a title never moves a file.
 *   A node without a valid slug is refused, not given one.
 * - **No Children tables.** Structure is the directory tree; no `index.md`
 *   lists its children.
 * - **Intent and state apart.** Frontmatter and body go to the node's `.md`
 *   file; tool-written fields go to the folder's `state.yaml` through
 *   `saveStateFile`. `status: "pending"` is the default and is not stored.
 * - **Folders.** A change is always a folder (`<slug>/index.md`), so tasks can
 *   be added without moving it; any other node is a folder only while it has
 *   children, and a leaf `<slug>.md` otherwise.
 * - **Root header.** `product/index.md` carries the title, the `schema` stamp
 *   and the `slugRule` that new slugs are made under: the v1 `tree-meta.json`
 *   sidecar has no v2 counterpart and is never written.
 *
 * Output depends on content alone: frontmatter keys in a fixed order per type
 * (unknown keys after, by name), files rewritten only when their content
 * changes. A tree read and written back unchanged is byte-identical; a file
 * that differs only by CRLF line endings counts as unchanged and is left alone.
 *
 * ## Stale entries
 *
 * Files and folders left behind by a move or a leaf/folder flip are deleted.
 * A stale entry holding a node the model no longer has is deleted only when
 * its id is in `removed`; otherwise the write is refused before anything is
 * touched. That keeps a node the reader skipped (invalid intent) from being
 * erased by the next save. Dotfiles and non-Markdown files are left alone.
 *
 * Must run under the PRD lock, like every state write. Under it, the root
 * stamp is re-read from disk and a non-v2 tree is refused, so a caller holding
 * a model read before a newer ndx restamped the tree cannot write into it.
 * Wired to nothing yet:
 * the v2 store calls it when it lands.
 *
 * @module rex/store/prd-model-writer
 */

import { mkdir, readFile, readdir, rm, rmdir } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  AreaIntentSchema,
  CapabilityIntentSchema,
  ChangeIntentSchema,
  ConstraintIntentSchema,
  ItemStateSchema,
  NodeIntentSchema,
  SCHEMA_VERSION_V2,
  SubtaskIntentSchema,
  TaskIntentSchema,
  isV2Schema,
  type ItemState,
  type NodeType,
  type StateFile,
} from "../schema/v2.js";
import type { RuleNode } from "../schema/v2-rules.js";
import { atomicWrite } from "./atomic-write.js";
import { isLockHeld } from "./file-lock.js";
import { parseFrontmatter, type ParseWarning } from "./folder-tree-parser.js";
import { SLUG_RULE_VERSION, isWindowsSafeSegment } from "./folder-tree-serializer.js";
import { prdLockPath } from "./paths.js";
import { CHANGES_DIRNAME, PRODUCT_DIRNAME, assertPrdModelWritable, assertV2TreeWritable, type PrdModel } from "./prd-model-reader.js";
import { STATE_FILE_NAME, emptyStateFile, loadStateFile, sameTextOnDisk, saveStateFile, type ProductSpec } from "./state-writer.js";

export interface WritePrdModelOptions {
  /**
   * Ids of nodes the caller deliberately removed. A stale file or folder is
   * deleted only when every node in it is still in the model (it moved) or
   * listed here.
   */
  removed?: ReadonlySet<string>;
  /** Clock for `revisedAt` stamps. */
  now?: () => Date;
}

export interface WritePrdModelResult {
  /** Files written, relative to `rexDir`. */
  written: string[];
  /** Files and folders deleted, relative to `rexDir`. */
  removed: string[];
}

const INDEX_FILE = "index.md";

/** State fields: everything else on a node is intent. */
const STATE_KEYS: ReadonlySet<string> = new Set(Object.keys(ItemStateSchema.shape));

/** Leading and trailing intent keys; the type's own fields go between them. */
const HEAD_KEYS = ["id", "type", "title", "slug", "displayId", "aliases"] as const;
const TAIL_KEYS = ["tags", "source", "blockedBy", "hypotheses"] as const;
/** Stored structurally, never as a frontmatter key. */
const STRUCTURAL_KEYS: ReadonlySet<string> = new Set(["children", "body"]);

const TYPE_SCHEMAS = {
  area: AreaIntentSchema,
  capability: CapabilityIntentSchema,
  constraint: ConstraintIntentSchema,
  change: ChangeIntentSchema,
  task: TaskIntentSchema,
  subtask: SubtaskIntentSchema,
} as const;

/** Frontmatter key order for `type`: head, the type's own fields in schema order, tail. */
function intentKeyOrder(type: NodeType): readonly string[] {
  const fixed = new Set<string>([...HEAD_KEYS, ...TAIL_KEYS, ...STRUCTURAL_KEYS]);
  const own = Object.keys(TYPE_SCHEMAS[type].shape).filter((k) => !fixed.has(k));
  return [...HEAD_KEYS, ...own, ...TAIL_KEYS];
}

const ROOT_KEY_ORDER = ["title", "schema", "slugRule", "requirements", "stewards"] as const;

// ── Entry point ──────────────────────────────────────────────────

/** Write `model` as the v2 tree under `rexDir`. The PRD lock for `rexDir` must be held. */
export async function writePrdModel(
  rexDir: string,
  model: PrdModel,
  options: WritePrdModelOptions = {},
): Promise<WritePrdModelResult> {
  assertPrdModelWritable(model);
  if (!isLockHeld(prdLockPath(rexDir))) {
    throw new Error(`PRD writes must run inside store.withTransaction: the PRD lock for ${rexDir} is not held`);
  }
  // The model's own stamp is not enough: the tree may have been restamped since it was read.
  await assertV2TreeWritable(rexDir);
  const stamp = model.layout === "v2" && isV2Schema(model.schema) ? model.schema : SCHEMA_VERSION_V2;
  const plan: Plan = { files: new Map(), states: [], dirs: new Set(), stale: [] };

  const productDir = join(rexDir, PRODUCT_DIRNAME);
  const changesDir = join(rexDir, CHANGES_DIRNAME);
  const loaded = await loadAllStateFiles([productDir, changesDir]);
  plan.files.set(join(productDir, INDEX_FILE), renderRootHeader(model, stamp));
  await planFolder(productDir, model.tree.product, null, stamp, loaded, plan);
  if (model.tree.changes.length > 0 || (await listDir(changesDir)) !== null) {
    await planFolder(changesDir, model.tree.changes, null, stamp, loaded, plan);
  }
  await assertStaleRemovable(plan.stale, collectIds(model), options.removed ?? new Set());

  const result: WritePrdModelResult = { written: [], removed: [] };
  const rel = (path: string): string => relative(rexDir, path).split("\\").join("/");
  for (const dir of plan.dirs) await mkdir(dir, { recursive: true });
  for (const [path, text] of plan.files) {
    if (sameTextOnDisk(await readIfExists(path), text)) continue;
    await atomicWrite(path, text);
    result.written.push(rel(path));
  }
  for (const { dir, file, specs } of plan.states) {
    const path = join(dir, STATE_FILE_NAME);
    if (file === null) {
      if ((await readIfExists(path)) === null) continue;
      await rm(path);
      result.removed.push(rel(path));
    } else if (await saveStateFile(dir, file, { rexDir, specs, now: options.now })) {
      result.written.push(rel(path));
    }
  }
  for (const { path, isDir } of plan.stale) {
    for (const removed of await removeStale(path, isDir)) result.removed.push(rel(removed));
  }
  return result;
}

// ── Plan ─────────────────────────────────────────────────────────

interface Plan {
  /** Markdown files to write, by absolute path. */
  files: Map<string, string>;
  /** One per folder; `file: null` means the folder keeps no `state.yaml`. */
  states: Array<{ dir: string; file: StateFile | null; specs: Map<string, ProductSpec> }>;
  dirs: Set<string>;
  stale: Array<{ path: string; isDir: boolean }>;
}

/** Every `state.yaml` on disk, read before planning so a row can follow its node to another folder. */
interface LoadedState {
  /** By folder path. */
  files: Map<string, StateFile>;
  /** Every row, by node id, whichever folder holds it; the first found wins. */
  rows: Map<string, ItemState>;
}

async function loadAllStateFiles(roots: readonly string[]): Promise<LoadedState> {
  const loaded: LoadedState = { files: new Map(), rows: new Map() };
  const walk = async (dir: string): Promise<void> => {
    for (const entry of (await listDir(dir)) ?? []) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name));
      } else if (entry.isFile() && entry.name === STATE_FILE_NAME) {
        const file = await loadStateFile(dir);
        loaded.files.set(dir, file);
        for (const [id, row] of Object.entries(file.items)) if (!loaded.rows.has(id)) loaded.rows.set(id, row);
      }
    }
  };
  for (const root of roots) await walk(root);
  return loaded;
}

/**
 * Plan folder `dir`: `owner` (the folder node, or null for a layer root) and
 * `nodes`, its children. Everything is validated here, before any write.
 */
async function planFolder(
  dir: string,
  nodes: readonly RuleNode[],
  owner: RuleNode | null,
  stamp: string,
  loaded: LoadedState,
  plan: Plan,
): Promise<void> {
  plan.dirs.add(dir);
  const entries = (await listDir(dir)) ?? [];
  const existing = loaded.files.get(dir) ?? { ...emptyStateFile(), schema: stamp };
  const rows: Record<string, ItemState> = {};
  const specs = new Map<string, ProductSpec>();
  const keep = (node: RuleNode, intent: Record<string, unknown>): void => {
    // A node that moved here (or flipped leaf to folder) has its row in another folder's file.
    const row = splitState(node, existing.items[node.id] ?? loaded.rows.get(node.id), intent);
    if (Object.keys(row).length > 0) rows[node.id] = row;
    const spec = productSpec(node);
    if (spec) specs.set(node.id, spec);
  };

  if (owner) {
    const intent: Record<string, unknown> = {};
    keep(owner, intent);
    assertValidIntent(owner, intent, dir);
    plan.files.set(join(dir, INDEX_FILE), renderNode(owner, intent));
  }

  const expectedDirs = new Set<string>();
  const expectedFiles = new Set<string>([INDEX_FILE]);
  const seen = new Map<string, string>();
  for (const node of nodes) {
    const folder = isFolderNode(node);
    assertSlug(node, folder, dir);
    // Case-folded: on macOS and Windows "Foo" and "foo" are one path.
    const key = node.slug.toLowerCase();
    const clash = seen.get(key);
    if (clash !== undefined) {
      throw new Error(`Two nodes in ${dir} share the slug "${node.slug}" (ignoring case): ${clash} and ${node.id}`);
    }
    seen.set(key, node.id);
    if (folder) {
      expectedDirs.add(node.slug);
      await planFolder(join(dir, node.slug), node.children ?? [], node, stamp, loaded, plan);
    } else {
      const intent: Record<string, unknown> = {};
      keep(node, intent);
      const file = `${node.slug}.md`;
      expectedFiles.add(file);
      assertValidIntent(node, intent, dir);
      plan.files.set(join(dir, file), renderNode(node, intent));
    }
  }

  const extraTopKeys = Object.keys(existing).some((k) => k !== "schema" && k !== "items");
  if (Object.keys(rows).length === 0 && !extraTopKeys) {
    plan.states.push({ dir, file: null, specs });
  } else {
    // Reusing the loaded object keeps the original lines of keys this build does not know.
    existing.items = rows;
    plan.states.push({ dir, file: existing, specs });
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory() ? expectedDirs.has(entry.name) : !entry.name.endsWith(".md") || expectedFiles.has(entry.name)) continue;
    plan.stale.push({ path: join(dir, entry.name), isDir: entry.isDirectory() });
  }
}

/** A change is always a folder; other nodes only while they have children. */
function isFolderNode(node: RuleNode): boolean {
  return node.type === "change" || (node.children?.length ?? 0) > 0;
}

/** Runs in the planning pass, so a bad slug refuses the write before any file changes. */
function assertSlug(node: RuleNode, folder: boolean, dir: string): void {
  const slug = node.slug;
  const ok =
    typeof slug === "string" &&
    slug !== "" &&
    !slug.startsWith(".") &&
    !/[/\\\0]/.test(slug) &&
    // A leaf named "index" would overwrite its folder's index.md.
    (folder || slug.toLowerCase() !== "index");
  if (!ok) {
    throw new Error(`Node ${node.id} in ${dir} has no usable slug (${JSON.stringify(slug)}); slugs are set once at creation`);
  }
  if (!isWindowsSafeSegment(slug)) {
    throw new Error(
      `Node ${node.id} in ${dir} has slug ${JSON.stringify(slug)}, which Windows cannot create ` +
        `(a device name such as CON or NUL, a trailing dot or space, or one of < > : " | ? * or a control character)`,
    );
  }
}

/**
 * The row `node` stores in `state.yaml`: known state fields, plus any field
 * its row on disk already held, in whichever folder (a newer build's state stays state).
 * Everything else is copied to `intent`.
 */
function splitState(node: RuleNode, previous: ItemState | undefined, intent: Record<string, unknown>): ItemState {
  const row: ItemState = {};
  for (const [key, value] of Object.entries(node)) {
    if (value === undefined || key === "children") continue;
    if (STATE_KEYS.has(key) || (previous !== undefined && Object.hasOwn(previous, key))) {
      if (key === "status" && value === "pending") continue;
      row[key] = value;
    } else {
      intent[key] = value;
    }
  }
  return row;
}

/** Refuse intent the reader would skip, which would hide the node and its subtree. */
function assertValidIntent(node: RuleNode, intent: Record<string, unknown>, dir: string): void {
  const parsed = NodeIntentSchema.safeParse(intent);
  if (parsed.success) return;
  const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
  throw new Error(`Node ${node.id} in ${dir} has invalid intent: ${issues}`);
}

/** The spec `revisedAt` is reconciled against, for product nodes that have one. */
function productSpec(node: RuleNode): ProductSpec | undefined {
  if (node.type === "capability") return { statement: node.statement, criteria: node.criteria };
  if (node.type === "constraint") return { statement: node.statement };
  return undefined;
}

// ── Stale entries ────────────────────────────────────────────────

function collectIds(model: PrdModel): Set<string> {
  const ids = new Set<string>();
  const visit = (node: RuleNode): void => {
    ids.add(node.id);
    node.children?.forEach(visit);
  };
  [...model.tree.product, ...model.tree.changes].forEach(visit);
  return ids;
}

/** Refuse unless every node in every stale entry moved (is in `kept`) or was `removed`. */
async function assertStaleRemovable(
  stale: Plan["stale"],
  kept: ReadonlySet<string>,
  removed: ReadonlySet<string>,
): Promise<void> {
  for (const entry of stale) {
    for (const file of entry.isDir ? await markdownFilesUnder(entry.path) : [entry.path]) {
      const warnings: ParseWarning[] = [];
      const fm = parseFrontmatter((await readIfExists(file)) ?? "", file, warnings);
      const id = typeof fm?.id === "string" ? fm.id : undefined;
      if (id === undefined || !(kept.has(id) || removed.has(id))) {
        throw new Error(
          `Refusing to write the PRD: ${file} holds ${id ? `node ${id}` : "a node with no readable id"}, ` +
            `which is not in the model and was not removed. Fix or remove it by hand, or pass its id in removed.`,
        );
      }
    }
  }
}

/**
 * Delete a stale entry. A folder loses only its tree files (`.md`, `state.yaml`)
 * and is removed once empty, so anything else kept there survives and the
 * folder stays. Returns the paths deleted: the folder itself when it went,
 * else the files.
 */
async function removeStale(path: string, isDir: boolean): Promise<string[]> {
  if (!isDir) {
    await rm(path, { force: true });
    return [path];
  }
  const files = await removeTreeFiles(path);
  return (await removeIfEmpty(path)) ? [path] : files;
}

async function removeTreeFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of (await listDir(dir)) ?? []) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const files = await removeTreeFiles(path);
      out.push(...((await removeIfEmpty(path)) ? [path] : files));
    } else if (entry.name.endsWith(".md") || entry.name === STATE_FILE_NAME) {
      await rm(path, { force: true });
      out.push(path);
    }
  }
  return out;
}

async function removeIfEmpty(dir: string): Promise<boolean> {
  try {
    await rmdir(dir);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOTEMPTY" || code === "EEXIST") return false;
    throw err;
  }
}

async function markdownFilesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of (await listDir(dir)) ?? []) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await markdownFilesUnder(path)));
    else if (entry.name.endsWith(".md")) out.push(path);
  }
  return out;
}

// ── Render ───────────────────────────────────────────────────────

function renderRootHeader(model: PrdModel, stamp: string): string {
  const { body, ...header } = model.header ?? {};
  const fields: Record<string, unknown> = { ...header, title: model.title, schema: stamp, slugRule: SLUG_RULE_VERSION };
  return renderMarkdown(fields, ROOT_KEY_ORDER, typeof body === "string" ? body : undefined);
}

function renderNode(node: RuleNode, intent: Record<string, unknown>): string {
  const { body, ...fields } = intent;
  return renderMarkdown(fields, intentKeyOrder(node.type), typeof body === "string" ? body : undefined);
}

/** Frontmatter (`order` first, other keys by name) and an optional body after one blank line. */
function renderMarkdown(fields: Record<string, unknown>, order: readonly string[], body: string | undefined): string {
  const known = new Set(order);
  const keys = [...order.filter((k) => k in fields), ...Object.keys(fields).filter((k) => !known.has(k)).sort()];
  const lines = ["---"];
  for (const key of keys) emitField(lines, key, fields[key]);
  lines.push("---");
  const trimmed = body?.trimEnd();
  if (trimmed) lines.push("", trimmed);
  return lines.join("\n") + "\n";
}

/**
 * One frontmatter field, in the subset `parseFrontmatter` reads back exactly:
 * a list of strings as a block list, any other array or object as one line
 * of JSON, strings JSON-quoted, booleans and plain numbers bare. Null,
 * undefined and an empty `run` block are not written.
 */
function emitField(lines: string[], key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (key === "run" && isEmptyObject(value)) return;
  if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string")) {
    lines.push(`${key}:`, ...value.map((v) => `  - ${JSON.stringify(v)}`));
  } else if (typeof value === "object") {
    lines.push(`${key}: ${JSON.stringify(value)}`);
  } else if (typeof value === "boolean" || (typeof value === "number" && /^-?(?:\d+|\d*\.\d+)$/.test(String(value)))) {
    lines.push(`${key}: ${value}`);
  } else {
    lines.push(`${key}: ${JSON.stringify(String(value))}`);
  }
}

function isEmptyObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;
}

// ── Shared ───────────────────────────────────────────────────────

async function listDir(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw err;
  }
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}
