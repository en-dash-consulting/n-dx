/**
 * Dual-read PRD loader: one model from either storage version.
 *
 * - **v2** — when `<rexDir>/product/` exists. Its root `index.md` frontmatter
 *   carries the title and the `schema` stamp. `product/` and `changes/` are
 *   read as node trees, each node's intent merged with its folder's
 *   `state.yaml` row.
 * - **v1** — otherwise. `<rexDir>/prd_tree/` is parsed by the v1 parser and
 *   each item's `level` mapped to a v2 `type` (see {@link V1_LEVEL_TYPES}).
 *
 * Either way the result is a {@link V2Tree}. Wired to nothing yet: the v2
 * store consumes it when it lands.
 *
 * ## v2 layout read here
 *
 * ```
 * product/index.md          root header (title, schema)
 * product/state.yaml        state for leaf nodes at the root
 * product/<slug>/index.md   a folder node: intent frontmatter + Markdown body
 * product/<slug>/state.yaml state for the folder node and its leaf files
 * product/<slug>/<leaf>.md  a leaf node
 * changes/…                 the same shape, with no root header
 * ```
 *
 * Children are read in slug order. A node whose intent fails validation is
 * skipped with its subtree and reported in `warnings`, as are state rows that
 * match no node. A malformed `state.yaml` throws: reading its nodes as
 * pending would misreport their status.
 *
 * ## Schema skew
 *
 * A stamp this build cannot read is refused with {@link SchemaSkewError},
 * naming the tree's version, the newest this build understands, and the fix.
 * `NDX_IGNORE_SCHEMA_SKEW=1` or `--ignore-schema-skew` (see
 * {@link ignoreSchemaSkewRequested}) reads it anyway for inspection: a warning
 * goes to stderr and the model is marked read-only, so
 * {@link assertPrdModelWritable} refuses every write.
 *
 * @module rex/store/prd-model-reader
 */

import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { ItemLevel, PRDItem } from "../schema/index.js";
import { SCHEMA_VERSION, isCompatibleSchema } from "../schema/index.js";
import { NodeIntentSchema, RootHeaderSchema, SCHEMA_VERSION_V2, isV2Schema, type NodeType, type StateFile } from "../schema/v2.js";
import type { RuleNode, V2Tree } from "../schema/v2-rules.js";
import { parseFolderTree, parseFrontmatter, type ParseWarning } from "./folder-tree-parser.js";
import { PRD_TREE_DIRNAME, TREE_META_FILENAME } from "./paths.js";
import { STATE_FILE_NAME, loadStateFile } from "./state-writer.js";
import { parseTreeMeta } from "./tree-meta.js";

export const PRODUCT_DIRNAME = "product";
export const CHANGES_DIRNAME = "changes";

/** Environment variable that turns on read-only inspection of a skewed tree. */
export const IGNORE_SCHEMA_SKEW_ENV = "NDX_IGNORE_SCHEMA_SKEW";
/** Command-line flag equivalent of {@link IGNORE_SCHEMA_SKEW_ENV}. */
export const IGNORE_SCHEMA_SKEW_FLAG = "--ignore-schema-skew";

/** Newest schema this build reads. */
export const NEWEST_SCHEMA = SCHEMA_VERSION_V2;

/**
 * How a v1 level reads as a v2 type. A v1 tree has no product layer (placing
 * items there is the migration's job), so every item lands in `changes`:
 * epics and features read as changes, nested as they are stored. The original
 * `level` is kept on the node.
 */
export const V1_LEVEL_TYPES: Readonly<Record<ItemLevel, NodeType>> = {
  epic: "change",
  feature: "change",
  task: "task",
  subtask: "subtask",
};

export interface PrdModel {
  /** Which storage was read. */
  layout: "v1" | "v2";
  /** The stamp the tree was written at. */
  schema: string;
  title: string;
  tree: V2Tree;
  warnings: ParseWarning[];
  /** Set when the tree was read past a schema refusal; every write must be refused. */
  readOnly?: SchemaSkewError;
}

export interface LoadPrdModelOptions {
  /** Read a skewed tree for inspection. Defaults to {@link IGNORE_SCHEMA_SKEW_ENV} in `env`. */
  ignoreSchemaSkew?: boolean;
  env?: NodeJS.ProcessEnv;
  /** Where the skew warning goes. Defaults to stderr. */
  warn?: (message: string) => void;
}

// ── Schema skew ──────────────────────────────────────────────────

const STAMP = /^rex\/v(\d+)(?:\.\d+)*$/;

/** The major version of a `rex/vN[.m]` stamp, or undefined when it is not one. */
export function schemaMajor(stamp: string | undefined): number | undefined {
  const match = stamp === undefined ? null : STAMP.exec(stamp);
  return match ? Number(match[1]) : undefined;
}

/** A tree whose schema stamp this build cannot read. */
export class SchemaSkewError extends Error {
  readonly found: string | undefined;
  readonly newest = NEWEST_SCHEMA;
  /** The file that carries the stamp. */
  readonly source: string;

  /** Which versions disagree, without the fix: "PRD schema is rex/v3 (<file>), this ndx understands up to rex/v2". */
  readonly summary: string;

  constructor(found: string | undefined, source: string) {
    const summary = `PRD schema is ${found ?? "missing"} (${source}), this ndx understands up to ${NEWEST_SCHEMA}`;
    super(
      `${summary}: ${skewFix(found)}. ` +
        `To inspect it read-only, set ${IGNORE_SCHEMA_SKEW_ENV}=1 or pass ${IGNORE_SCHEMA_SKEW_FLAG}.`,
    );
    this.name = "SchemaSkewError";
    this.found = found;
    this.source = source;
    this.summary = summary;
  }
}

function skewFix(found: string | undefined): string {
  if (found === undefined) return `stamp it with schema: "${NEWEST_SCHEMA}"`;
  const major = schemaMajor(found);
  return major !== undefined && major > (schemaMajor(NEWEST_SCHEMA) ?? 0)
    ? "upgrade ndx (or run ndx migrate on the other side)"
    : `rewrite it as ${NEWEST_SCHEMA} with ndx migrate`;
}

/** Whether the read-only override is on, from the command line or the environment. */
export function ignoreSchemaSkewRequested(argv: readonly string[] = [], env: NodeJS.ProcessEnv = process.env): boolean {
  return argv.includes(IGNORE_SCHEMA_SKEW_FLAG) || env[IGNORE_SCHEMA_SKEW_ENV] === "1";
}

/** Throw unless writes to `model` are allowed. Every write path calls this first. */
export function assertPrdModelWritable(model: PrdModel): void {
  if (model.readOnly) {
    throw new Error(
      `Writes are refused: ${model.readOnly.summary}, and it was read for inspection only (${IGNORE_SCHEMA_SKEW_ENV}). ` +
        `To write it, ${skewFix(model.readOnly.found)}.`,
    );
  }
}

// ── Entry point ──────────────────────────────────────────────────

/** Load the PRD under `rexDir` as one model, from whichever layout it uses. */
export async function loadPrdModel(rexDir: string, options: LoadPrdModelOptions = {}): Promise<PrdModel> {
  const ignore = options.ignoreSchemaSkew ?? ignoreSchemaSkewRequested([], options.env ?? process.env);
  const productDir = join(rexDir, PRODUCT_DIRNAME);
  const v2 = await isDirectory(productDir);
  const header = v2 ? await readV2Header(productDir) : await readV1Header(rexDir);

  let readOnly: SchemaSkewError | undefined;
  if (!(v2 ? isV2Schema(header.schema) : isCompatibleSchema(header.schema))) {
    readOnly = new SchemaSkewError(header.schema, header.source);
    if (!ignore) throw readOnly;
    (options.warn ?? ((m) => process.stderr.write(m + "\n")))(
      `Warning: ${readOnly.summary}. Reading it for inspection only (${IGNORE_SCHEMA_SKEW_ENV} / ${IGNORE_SCHEMA_SKEW_FLAG}); every write is refused.`,
    );
  }

  const warnings: ParseWarning[] = [...header.warnings];
  const tree = v2
    ? {
        product: await readLayer(productDir, warnings, readOnly !== undefined),
        changes: await readLayer(join(rexDir, CHANGES_DIRNAME), warnings, readOnly !== undefined),
      }
    : await readV1Tree(join(rexDir, PRD_TREE_DIRNAME), warnings);
  return {
    layout: v2 ? "v2" : "v1",
    schema: header.schema ?? (v2 ? NEWEST_SCHEMA : SCHEMA_VERSION),
    title: header.title,
    tree,
    warnings,
    ...(readOnly ? { readOnly } : {}),
  };
}

interface Header {
  title: string;
  schema: string | undefined;
  source: string;
  warnings: ParseWarning[];
}

async function readV2Header(productDir: string): Promise<Header> {
  const source = join(productDir, "index.md");
  const warnings: ParseWarning[] = [];
  const text = await readIfExists(source);
  const fm = text === null ? null : parseFrontmatter(text, source, warnings);
  if (text === null) warnings.push({ path: source, message: "Missing root index.md" });
  const schema = typeof fm?.schema === "string" ? fm.schema : undefined;
  const parsed = RootHeaderSchema.safeParse(fm ?? {});
  if (!parsed.success && isV2Schema(schema)) {
    warnings.push({ path: source, message: `Invalid root header: ${issues(parsed.error.issues)}` });
  }
  return { title: typeof fm?.title === "string" ? fm.title : "PRD", schema, source, warnings };
}

async function readV1Header(rexDir: string): Promise<Header> {
  const source = join(rexDir, TREE_META_FILENAME);
  const text = await readIfExists(source);
  const meta = text === null ? {} : parseTreeMeta(text);
  // A tree older than the marker reads as v1, as the v1 store does.
  return { title: meta.title ?? "PRD", schema: meta.schema ?? SCHEMA_VERSION, source, warnings: [] };
}

// ── v1 ───────────────────────────────────────────────────────────

async function readV1Tree(treeRoot: string, warnings: ParseWarning[]): Promise<V2Tree> {
  const parsed = await parseFolderTree(treeRoot);
  warnings.push(...parsed.warnings);
  const toNode = (item: PRDItem): RuleNode => {
    const { children, ...fields } = item;
    const file = parsed.itemFiles.get(item.id);
    // Legacy `## Subtask:` sections have no file of their own, so no name to freeze.
    const slug = file ? (basename(file) === "index.md" ? basename(dirname(file)) : basename(file, ".md")) : item.id;
    const node = { ...fields, type: V1_LEVEL_TYPES[item.level], slug } as RuleNode;
    if (children?.length) node.children = children.map(toNode);
    return node;
  };
  return { product: [], changes: parsed.items.map(toNode) };
}

// ── v2 ───────────────────────────────────────────────────────────

async function readLayer(layerDir: string, warnings: ParseWarning[], ignoreStamp: boolean): Promise<RuleNode[]> {
  if (!(await isDirectory(layerDir))) return [];
  const folder = await readFolder(layerDir, warnings, ignoreStamp);
  warnOrphanRows(layerDir, folder, warnings);
  return folder.children;
}

/** A folder's `state.yaml`, its child nodes, and the state rows those children claimed. */
interface FolderRead {
  state: StateFile;
  children: RuleNode[];
  claimed: Set<string>;
}

/** The nodes stored directly in `dir`: subfolders with an `index.md`, and leaf `.md` files, in slug order. */
async function readFolder(dir: string, warnings: ParseWarning[], ignoreStamp: boolean): Promise<FolderRead> {
  const state = await loadStateFile(dir, { ignoreSchemaStamp: ignoreStamp });
  const claimed = new Set<string>();
  const named: Array<{ name: string; node: RuleNode }> = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const node = await readFolderNode(join(dir, entry.name), warnings, ignoreStamp);
      if (node) named.push({ name: entry.name, node });
    } else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "index.md") {
      const name = entry.name.slice(0, -".md".length);
      const node = await readNode(join(dir, entry.name), name, state, warnings);
      if (node) {
        claimed.add(node.id);
        named.push({ name, node });
      }
    }
  }
  named.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { state, children: named.map(({ node }) => node), claimed };
}

async function readFolderNode(dir: string, warnings: ParseWarning[], ignoreStamp: boolean): Promise<RuleNode | null> {
  const indexPath = join(dir, "index.md");
  if ((await readIfExists(indexPath)) === null) {
    warnings.push({ path: dir, message: "Folder has no index.md; skipped with its contents" });
    return null;
  }
  const folder = await readFolder(dir, warnings, ignoreStamp);
  const node = await readNode(indexPath, basename(dir), folder.state, warnings);
  if (!node) return null;
  folder.claimed.add(node.id);
  warnOrphanRows(dir, folder, warnings);
  if (folder.children.length) node.children = folder.children;
  return node;
}

function warnOrphanRows(dir: string, folder: FolderRead, warnings: ParseWarning[]): void {
  for (const id of Object.keys(folder.state.items)) {
    if (!folder.claimed.has(id)) {
      warnings.push({ path: join(dir, STATE_FILE_NAME), message: `State row "${id}" matches no node in this folder` });
    }
  }
}

/** One node: validated intent from `path`, merged with its row in `state`. */
async function readNode(
  path: string,
  name: string,
  state: StateFile,
  warnings: ParseWarning[],
): Promise<RuleNode | null> {
  const text = (await readIfExists(path)) ?? "";
  const fm = parseFrontmatter(text, path, warnings);
  if (!fm) return null;
  dropNonObjectRun(fm, path, warnings);
  const body = bodyOf(text);
  const intent = NodeIntentSchema.safeParse(body ? { ...fm, body } : fm);
  if (!intent.success) {
    warnings.push({ path, message: `Invalid node intent, skipped: ${issues(intent.error.issues)}` });
    return null;
  }
  if (intent.data.slug !== name) {
    warnings.push({ path, message: `Frontmatter slug "${intent.data.slug}" differs from the stored name "${name}"` });
  }
  // State is tool-written and authoritative for its fields; an absent row reads as pending.
  return { status: "pending", ...intent.data, ...state.items[intent.data.id] } as RuleNode;
}

/**
 * Remove a `run` that is not a plain object before intent validation, as the
 * v1 parser does: a hand-edited `run:` with no value (null) or `run: heavy`
 * would otherwise fail the whole node and hide it with its subtree. Null is
 * dropped silently; anything else warns. An object, even an invalid one, is
 * kept for the `run-settings` rule to report.
 */
function dropNonObjectRun(fm: Record<string, unknown>, path: string, warnings: ParseWarning[]): void {
  const run = fm.run;
  if (run === undefined || (typeof run === "object" && run !== null && !Array.isArray(run))) return;
  delete fm.run;
  if (run !== null) warnings.push({ path, message: `Ignoring run on item id=${String(fm.id)}: expected an object` });
}

// ── Shared ───────────────────────────────────────────────────────

/** Markdown below the frontmatter, without the blank line after `---`. */
function bodyOf(text: string): string | undefined {
  const match = /^\s*---\r?\n[\s\S]*?\r?\n---[^\S\r\n]*(?:\r?\n|$)/.exec(text);
  const body = match ? text.slice(match[0].length).replace(/^(?:\r?\n)+/, "").trimEnd() : "";
  return body === "" ? undefined : body;
}

function issues(list: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string {
  return list.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    await readdir(path);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw err;
  }
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EISDIR") return null;
    throw err;
  }
}
