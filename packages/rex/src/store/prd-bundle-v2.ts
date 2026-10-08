/**
 * Bundle envelope v2: both layers of a v2 tree in one transport file.
 *
 * Envelope v1 (`../core/prd-bundle.ts`) carries a v1 item list. Envelope v2
 * carries what a v2 tree holds: the root header, the `product` layer and the
 * `changes` layer. Each node is its intent fields with its `state.yaml` row
 * apart under `state`, children nested ({@link BundleNodeV2}). Keeping the
 * row apart is what lets a state key this build does not declare (a retired
 * field, or one a newer rex wrote) land back in `state.yaml` rather than in
 * frontmatter. For the same reason a `state.yaml`'s own top-level keys other
 * than `schema` and `items` travel in `folderState` ({@link BundleFolderStateV2})
 * and are written back to the same folder's file. The root header is checked
 * against the schema `product/index.md` is read with. The same carve-out
 * applies: a bundle is written outside the rex directory and never read as
 * storage.
 *
 * Which envelope is used follows the tree, not a flag:
 *
 * | Source tree | Export writes | Destination tree | v1 bundle            | v2 bundle |
 * |-------------|---------------|------------------|----------------------|-----------|
 * | v1          | envelope v1   | v1               | imports              | refused   |
 * | v2          | envelope v2   | v2               | imports into changes | imports   |
 *
 * A v1 bundle reads into a v2 tree the way the dual-read loader reads a v1
 * tree: every item lands in the change layer, its `level` mapped to a `type`
 * by {@link V1_LEVEL_TYPES}. A v1 bundle has no product layer, so its silence
 * about one is not a request to delete it: `--replace` with a v1 bundle
 * replaces the change layer only. A v2 bundle cannot be written into a v1 tree
 * (it may hold product nodes, which v1 has nowhere to put).
 *
 * Every check in {@link parseAnyBundle} runs before the tree is opened, and
 * the merged tree goes through `writePrdModel`, which validates everything
 * before its first write, so a rejected import leaves the tree untouched.
 *
 * @module rex/store/prd-bundle-v2
 */

import { statSync } from "node:fs";
import { join } from "node:path";
import {
  BUNDLE_KIND,
  BundleError,
  parseBundle,
  type BundleCollision,
  type BundleProvenance,
  type ImportMode,
  type PRDBundle,
} from "../core/prd-bundle.js";
import { ITEM_BOOKKEEPING_FIELDS } from "../core/sync.js";
import type { PRDItem } from "../schema/index.js";
import {
  ItemStateSchema,
  NodeIntentSchema,
  RootHeaderSchema,
  SCHEMA_VERSION_V2,
  isV2Schema,
  type ItemState,
  type Layer,
  type NodeType,
} from "../schema/v2.js";
import { checkV2Rules, type RuleNode, type V2Tree } from "../schema/v2-rules.js";
import { withLock } from "./file-lock.js";
import { resolveSiblingSlugs } from "./folder-tree-serializer.js";
import { prdLockPath } from "./paths.js";
import type { ParseWarning } from "./folder-tree-parser.js";
import { PRODUCT_DIRNAME, V1_LEVEL_TYPES, loadPrdModel, type FolderStateKeys, type PrdModel } from "./prd-model-reader.js";
import { writePrdModel } from "./prd-model-writer.js";

/** Envelope version that carries both v2 layers. */
export const BUNDLE_VERSION_V2 = 2;

/**
 * One node in envelope v2: intent fields at the top, the node's `state.yaml`
 * row under `state` (omitted when empty), children nested. A declared state
 * field outside `state`, or an intent field inside it, is refused on parse.
 */
export interface BundleNodeV2 {
  id: string;
  type: NodeType;
  title: string;
  slug: string;
  state?: ItemState;
  children?: BundleNodeV2[];
  [key: string]: unknown;
}

/**
 * Each folder's `state.yaml` top-level keys other than `schema` and `items`
 * (keys a newer rex added), so they land back in the same folder's file. A
 * layer root's go under `layers`, a folder node's under `nodes` by its id.
 * Kept beside the nodes rather than on them, so no node field is reserved.
 */
export interface BundleFolderStateV2 {
  layers?: Partial<Record<Layer, Record<string, unknown>>>;
  nodes?: Record<string, Record<string, unknown>>;
}

export interface PRDBundleV2 {
  bundle: typeof BUNDLE_KIND;
  bundleVersion: typeof BUNDLE_VERSION_V2;
  /** The tree's v2 stamp, as of export. */
  schema: string;
  title: string;
  /** Root `product/index.md` fields other than title and the stamps, and its `body`. */
  header?: Record<string, unknown>;
  exportedAt: string;
  exportedFrom?: BundleProvenance;
  product: BundleNodeV2[];
  changes: BundleNodeV2[];
  /** Omitted when no `state.yaml` has such keys. */
  folderState?: BundleFolderStateV2;
}

/** A parsed bundle of either envelope. */
export type ParsedBundle =
  | { version: 1; bundle: PRDBundle }
  | { version: typeof BUNDLE_VERSION_V2; bundle: PRDBundleV2 };

const LAYERS: readonly Layer[] = ["product", "changes"];

/** Root header keys the writer stamps itself; a bundle neither carries nor applies them. */
const STAMPED_HEADER_KEYS: ReadonlySet<string> = new Set(["title", "schema", "slugRule"]);

const STATE_KEYS: ReadonlySet<string> = new Set(Object.keys(ItemStateSchema.shape));

/** Keys a node's `state` block may not hold: intent any node type declares, and the envelope's own. */
const NOT_STATE_KEYS: ReadonlySet<string> = new Set([
  ...NodeIntentSchema.options.flatMap((schema) => Object.keys(schema.shape)),
  "body",
  "children",
  "state",
]);

/** Whether `rexDir` holds a v2 tree, by the rule the dual-read loader uses: `product/` exists. */
export function hasV2Tree(rexDir: string): boolean {
  try {
    return statSync(join(rexDir, PRODUCT_DIRNAME)).isDirectory();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw err;
  }
}

/** Count every node, children included. */
export function countNodes(nodes: readonly RuleNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countNodes(node.children ?? []), 0);
}

// ── Export ───────────────────────────────────────────────────────

export interface BuildBundleV2Options {
  /** Override the export timestamp (tests, reproducible fixtures). */
  exportedAt?: string;
  branch?: string;
  commit?: string;
  /**
   * Each node's `state.yaml` row, by id (`LoadPrdModelOptions.stateRows`).
   * Without it only declared state fields go under `state`, and an
   * undeclared one is carried as intent.
   */
  stateRows?: ReadonlyMap<string, ItemState>;
  /** Each `state.yaml`'s extra top-level keys (`LoadPrdModelOptions.folderState`). Without it none are carried. */
  folderState?: FolderStateKeys;
}

/** Snapshot a loaded v2 model into an envelope v2 bundle. The nodes are deep-cloned. */
export function buildBundleV2(model: PrdModel, options: BuildBundleV2Options = {}): PRDBundleV2 {
  const rows = options.stateRows ?? new Map<string, ItemState>();
  const provenance: BundleProvenance = {};
  if (options.branch) provenance.branch = options.branch;
  if (options.commit) provenance.commit = options.commit;
  const header = carriedHeader(model.header);
  const folderState = options.folderState ? carriedFolderState(options.folderState) : undefined;

  return {
    bundle: BUNDLE_KIND,
    bundleVersion: BUNDLE_VERSION_V2,
    schema: model.schema,
    title: model.title,
    ...(header ? { header } : {}),
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    ...(Object.keys(provenance).length > 0 ? { exportedFrom: provenance } : {}),
    product: toBundleNodes(model.tree.product, rows),
    changes: toBundleNodes(model.tree.changes, rows),
    ...(folderState ? { folderState } : {}),
  };
}

/** The reader's folder keys in envelope form, deep-cloned, or undefined when there are none. */
function carriedFolderState(keys: FolderStateKeys): BundleFolderStateV2 | undefined {
  const out: BundleFolderStateV2 = {};
  const layers = LAYERS.filter((layer) => keys.layers[layer] !== undefined);
  if (layers.length > 0) out.layers = Object.fromEntries(layers.map((layer) => [layer, structuredClone(keys.layers[layer])]));
  if (keys.nodes.size > 0) out.nodes = Object.fromEntries([...keys.nodes].map(([id, extra]) => [id, structuredClone(extra)]));
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Loaded nodes as envelope nodes: a field is state when it is declared state or its row holds it. */
function toBundleNodes(nodes: readonly RuleNode[], rows: ReadonlyMap<string, ItemState>): BundleNodeV2[] {
  return nodes.map((node) => {
    // The envelope's `state` block would overwrite it, losing the value without a word.
    if (Object.hasOwn(node, "state")) {
      throw new BundleError(
        `Node "${node.title}" (${node.id}) has a field named "state", which bundle envelope v2 reserves for the node's state.yaml row. ` +
          `Rename or remove the field, then export again. Nothing was written.`,
      );
    }
    const row = rows.get(node.id);
    const out: Record<string, unknown> = {};
    const state: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(structuredClone(node))) {
      if (key === "children") continue;
      if (STATE_KEYS.has(key) || (row !== undefined && Object.hasOwn(row, key))) state[key] = value;
      else out[key] = value;
    }
    if (Object.keys(state).length > 0) out.state = state;
    if (node.children?.length) out.children = toBundleNodes(node.children, rows);
    return out as BundleNodeV2;
  });
}

export interface V2Export {
  bundle: PRDBundleV2;
  /** Nodes the reader skipped (invalid intent), which the bundle therefore lacks. */
  warnings: ParseWarning[];
}

/** Read the v2 tree under the PRD lock and build its bundle. */
export async function exportV2Bundle(rexDir: string, options: BuildBundleV2Options = {}): Promise<V2Export> {
  const stateRows = new Map<string, ItemState>();
  const folderState: FolderStateKeys = { layers: {}, nodes: new Map() };
  const model = await withLock(prdLockPath(rexDir), () => loadPrdModel(rexDir, { stateRows, folderState }));
  return { bundle: buildBundleV2(model, { stateRows, folderState, ...options }), warnings: model.warnings };
}

function carriedHeader(header: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const kept = Object.entries(header ?? {}).filter(([key]) => !STAMPED_HEADER_KEYS.has(key));
  return kept.length > 0 ? Object.fromEntries(kept) : undefined;
}

// ── Parse ────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate an untrusted parsed-JSON payload as a bundle of either envelope.
 * Envelope 1 is handed to the v1 parser unchanged.
 *
 * @throws {BundleError} Before any write, if the payload is not a bundle, is
 *   newer than this rex reads, or fails validation.
 */
export function parseAnyBundle(raw: unknown): ParsedBundle {
  const version = isRecord(raw) && raw.bundle === BUNDLE_KIND ? raw.bundleVersion : undefined;
  if (version === BUNDLE_VERSION_V2) return { version: BUNDLE_VERSION_V2, bundle: parseBundleV2(raw as Record<string, unknown>) };
  if (typeof version === "number" && Number.isInteger(version) && version > BUNDLE_VERSION_V2) {
    throw new BundleError(
      `Bundle format version ${version} is newer than this rex supports (${BUNDLE_VERSION_V2}). ` +
        `Upgrade rex to import it. Nothing was written.`,
    );
  }
  return { version: 1, bundle: parseBundle(raw) };
}

function parseBundleV2(candidate: Record<string, unknown>): PRDBundleV2 {
  const schema = candidate.schema;
  if (typeof schema !== "string") throw new BundleError('Bundle is missing its "schema" version.');
  if (schema !== SCHEMA_VERSION_V2) {
    throw new BundleError(
      isV2Schema(schema)
        ? `Bundle schema "${schema}" is newer than this rex supports ("${SCHEMA_VERSION_V2}"). Upgrade rex to import it. Nothing was written.`
        : `Bundle has an incompatible PRD schema "${schema}", expected "${SCHEMA_VERSION_V2}". Nothing was written.`,
    );
  }
  const { title, exportedAt } = candidate;
  if (typeof title !== "string") throw new BundleError('Bundle is missing its "title".');
  if (typeof exportedAt !== "string") throw new BundleError('Bundle is missing its "exportedAt" timestamp.');
  for (const layer of LAYERS) {
    if (!Array.isArray(candidate[layer])) throw new BundleError(`Bundle is missing its "${layer}" array.`);
  }
  if (candidate.header !== undefined && !isRecord(candidate.header)) {
    throw new BundleError('Bundle "header" must be an object.');
  }
  const header = carriedHeader(candidate.header as Record<string, unknown> | undefined);
  assertValidHeader(header, title, schema);

  for (const layer of LAYERS) assertValidNodes(candidate[layer] as unknown[]);
  const product = candidate.product as BundleNodeV2[];
  const changes = candidate.changes as BundleNodeV2[];
  const { tree } = fromBundleNodes(product, changes);
  assertUniqueIds(tree);
  assertLegalStructure(tree);
  const folderState = parseFolderState(candidate.folderState, tree);

  const parsed: PRDBundleV2 = {
    bundle: BUNDLE_KIND,
    bundleVersion: BUNDLE_VERSION_V2,
    schema,
    title,
    exportedAt,
    product,
    changes,
  };
  if (header) parsed.header = header;
  if (folderState) parsed.folderState = folderState;
  if (isRecord(candidate.exportedFrom)) {
    const { branch, commit } = candidate.exportedFrom;
    const provenance: BundleProvenance = {};
    if (typeof branch === "string") provenance.branch = branch;
    if (typeof commit === "string") provenance.commit = commit;
    if (Object.keys(provenance).length > 0) parsed.exportedFrom = provenance;
  }
  return parsed;
}

function describeIssues(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string {
  return issues.map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`).join("; ");
}

/**
 * Hold the root header, as the writer would rebuild it from the envelope's
 * title and schema, to the schema the reader checks `product/index.md`
 * against. Unknown keys pass, as they do on disk.
 */
function assertValidHeader(header: Record<string, unknown> | undefined, title: string, schema: string): void {
  const { body, ...fields } = header ?? {};
  if (body !== undefined && typeof body !== "string") {
    throw new BundleError('Bundle "header" has a "body" that is not a string. Nothing was written.');
  }
  const result = RootHeaderSchema.safeParse({ ...fields, title, schema });
  if (!result.success) {
    throw new BundleError(`Bundle "header" is not a valid root header: ${describeIssues(result.error.issues)}. Nothing was written.`);
  }
}

/**
 * Validate the envelope's `folderState`: layer names, folder-node ids from
 * this bundle (a leaf keeps no `state.yaml`, so its keys would be lost), and
 * key sets without `schema` or `items`, which the file itself owns.
 */
function parseFolderState(raw: unknown, tree: V2Tree): BundleFolderStateV2 | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) throw new BundleError('Bundle "folderState" must be an object. Nothing was written.');
  const unknown = Object.keys(raw).filter((key) => key !== "layers" && key !== "nodes");
  if (unknown.length > 0) {
    throw new BundleError(`Bundle "folderState" has unknown keys: ${unknown.join(", ")}. Nothing was written.`);
  }
  const out: BundleFolderStateV2 = {};
  if (raw.layers !== undefined) {
    const layers = keyedRecords(raw.layers, "folderState.layers");
    const bad = Object.keys(layers).filter((key) => !(LAYERS as readonly string[]).includes(key));
    if (bad.length > 0) {
      throw new BundleError(`Bundle "folderState.layers" names no layer: ${bad.join(", ")}. Nothing was written.`);
    }
    out.layers = layers;
  }
  if (raw.nodes !== undefined) {
    const nodes = keyedRecords(raw.nodes, "folderState.nodes");
    const folders = folderNodeIds(tree);
    const bad = Object.keys(nodes).filter((id) => !folders.has(id));
    if (bad.length > 0) {
      throw new BundleError(
        `Bundle "folderState.nodes" names ids that are not folder nodes in this bundle: ${bad.join(", ")}. Nothing was written.`,
      );
    }
    out.nodes = nodes;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** An object of `state.yaml` top-level key sets, each checked. */
function keyedRecords(raw: unknown, where: string): Record<string, Record<string, unknown>> {
  if (!isRecord(raw)) throw new BundleError(`Bundle "${where}" must be an object. Nothing was written.`);
  for (const [key, extra] of Object.entries(raw)) {
    if (!isRecord(extra)) throw new BundleError(`Bundle "${where}.${key}" must be an object. Nothing was written.`);
    const owned = Object.keys(extra).filter((k) => k === "schema" || k === "items");
    if (owned.length > 0) {
      throw new BundleError(`Bundle "${where}.${key}" holds ${owned.join(" and ")}, which state.yaml owns. Nothing was written.`);
    }
  }
  return raw as Record<string, Record<string, unknown>>;
}

/** Ids of nodes the writer stores as folders (and so with a `state.yaml`): changes, and nodes with children. */
function folderNodeIds(tree: V2Tree): Set<string> {
  const ids = new Set<string>();
  const visit = (node: RuleNode): void => {
    if (node.type === "change" || (node.children?.length ?? 0) > 0) ids.add(node.id);
    node.children?.forEach(visit);
  };
  LAYERS.forEach((layer) => tree[layer].forEach(visit));
  return ids;
}

/**
 * Hold each node's intent and `state` block to the schemas the tree's own
 * files are held to, and each field to its side: a declared state field
 * outside `state` would otherwise be written as frontmatter, and an intent
 * field inside it into `state.yaml`.
 */
function assertValidNodes(nodes: unknown[]): void {
  for (const node of nodes) {
    if (!isRecord(node)) throw new BundleError("Bundle contains a node that is not an object.");
    const label = `"${String(node.title)}" (${String(node.id)})`;
    if (node.children !== undefined && !Array.isArray(node.children)) {
      throw new BundleError(`Bundle node ${label} has a "children" that is not an array.`);
    }
    if (node.state !== undefined && !isRecord(node.state)) {
      throw new BundleError(`Bundle node ${label} has a "state" that is not an object.`);
    }
    const state = (node.state ?? {}) as Record<string, unknown>;
    const intent = Object.fromEntries(Object.entries(node).filter(([key]) => key !== "children" && key !== "state"));
    const misplaced = [
      ...Object.keys(intent).filter((key) => STATE_KEYS.has(key)).map((key) => `state field "${key}" outside "state"`),
      ...Object.keys(state).filter((key) => NOT_STATE_KEYS.has(key)).map((key) => `field "${key}" inside "state"`),
    ];
    if (misplaced.length > 0) {
      throw new BundleError(`Bundle node ${label} has ${misplaced.join(", ")}. Nothing was written.`);
    }
    for (const result of [NodeIntentSchema.safeParse(intent), ItemStateSchema.safeParse(state)]) {
      if (!result.success) {
        throw new BundleError(`Bundle contains an invalid node ${label}: ${describeIssues(result.error.issues)}. Nothing was written.`);
      }
    }
    assertValidNodes((node.children as unknown[] | undefined) ?? []);
  }
}

/** Every id once across both layers. */
function assertUniqueIds(tree: V2Tree): void {
  const seen = new Map<string, string>();
  const visit = (node: RuleNode): void => {
    const first = seen.get(node.id);
    if (first !== undefined) {
      throw new BundleError(
        `Bundle contains the same item id twice: "${node.id}" (as "${first}" and "${node.title}"). Nothing was written.`,
      );
    }
    seen.set(node.id, node.title);
    node.children?.forEach(visit);
  };
  LAYERS.forEach((layer) => tree[layer].forEach(visit));
}

/** The structural v2 rules: nodes stay in their layer, capabilities nest one level. */
function assertLegalStructure(tree: V2Tree, only?: ReadonlySet<string>): void {
  const errors = checkV2Rules(tree, { now: new Date() }, ["layer-nesting", "capability-depth"]).filter(
    (f) => f.severity === "error" && (only === undefined || only.has(f.nodeId)),
  );
  if (errors.length > 0) {
    throw new BundleError(`Bundle nodes break the tree structure: ${errors.map((f) => f.message).join("; ")}. Nothing was written.`);
  }
}

// ── v1 items as v2 nodes ─────────────────────────────────────────

/**
 * v1 items as change-layer nodes, by the mapping the dual-read loader reads a
 * v1 tree with: `level` to `type` ({@link V1_LEVEL_TYPES}), `level` kept, and
 * each slug resolved among its siblings by the v1 slug rule (what the v1 tree
 * would have named the folder). Slugs are frozen from here on.
 */
export function v1ItemsToNodes(items: readonly PRDItem[]): RuleNode[] {
  const slugs = resolveSiblingSlugs([...items]);
  return items.map((item) => {
    const { children, ...fields } = item;
    const node = { ...fields, type: V1_LEVEL_TYPES[item.level], slug: slugs.get(item.id) } as RuleNode;
    if (children?.length) node.children = v1ItemsToNodes(children);
    return node;
  });
}

/** A bundle's tree as the v2 reader would load it, and the undeclared state keys of each node, by id. */
interface IncomingTree {
  tree: V2Tree;
  stateKeys: Map<string, Set<string>>;
}

/** Envelope nodes as loaded nodes: each `state` block merged over its intent, as the reader merges a row. */
function fromBundleNodes(product: readonly BundleNodeV2[], changes: readonly BundleNodeV2[]): IncomingTree {
  const stateKeys = new Map<string, Set<string>>();
  const convert = (nodes: readonly BundleNodeV2[]): RuleNode[] =>
    nodes.map((bundled) => {
      const { children, state, ...intent } = structuredClone(bundled);
      const undeclared = Object.keys(state ?? {}).filter((key) => !STATE_KEYS.has(key));
      if (undeclared.length > 0) stateKeys.set(bundled.id, new Set(undeclared));
      const node = { ...intent, ...state } as RuleNode;
      if (children?.length) node.children = convert(children);
      return node;
    });
  return { tree: { product: convert(product), changes: convert(changes) }, stateKeys };
}

/** A parsed bundle as a v2 tree, which layers it carries, and its undeclared state keys. */
function incomingTree(parsed: ParsedBundle): IncomingTree & { carried: readonly Layer[] } {
  return parsed.version === 1
    ? { tree: { product: [], changes: v1ItemsToNodes(parsed.bundle.items) }, stateKeys: new Map(), carried: ["changes"] }
    : { ...fromBundleNodes(parsed.bundle.product, parsed.bundle.changes), carried: LAYERS };
}

// ── Merge ────────────────────────────────────────────────────────

export interface V2MergeOutcome {
  tree: V2Tree;
  collisions: BundleCollision[];
  /** Nodes the bundle contributed. */
  added: number;
  /** Local nodes discarded; non-zero only in `replace` mode. */
  replaced: number;
  /** Ids of discarded nodes that the writer may delete. */
  removed: Set<string>;
}

/**
 * Apply `incoming` to `existing`, both v2 trees.
 *
 * `merge` mirrors the v1 rule: local nodes keep their content and place,
 * unseen ids are grafted under the matching parent (matched by id across both
 * layers), and a known id is reported as a collision. A grafted node whose
 * slug is already taken among its new siblings is refused. `replace` swaps
 * each layer in `carried` for the bundle's and keeps the others.
 *
 * @throws {BundleError} When the result would break the tree structure or
 *   hold an id twice. Nothing is written by this function.
 */
export function mergeV2Tree(existing: V2Tree, incoming: V2Tree, mode: ImportMode, carried: readonly Layer[] = LAYERS): V2MergeOutcome {
  if (mode === "replace") {
    const tree: V2Tree = { product: [], changes: [] };
    let added = 0;
    let replaced = 0;
    for (const layer of LAYERS) {
      const swap = carried.includes(layer);
      tree[layer] = structuredClone(swap ? incoming[layer] : existing[layer]);
      if (swap) {
        added += countNodes(incoming[layer]);
        replaced += countNodes(existing[layer]);
      }
    }
    assertUniqueIds(tree);
    const kept = idsOf(tree);
    const removed = new Set([...idsOf(existing)].filter((id) => !kept.has(id)));
    return { tree, collisions: [], added, replaced, removed };
  }

  const tree = structuredClone(existing);
  const byId = new Map<string, RuleNode>();
  const index = (node: RuleNode): void => {
    byId.set(node.id, node);
    node.children?.forEach(index);
  };
  LAYERS.forEach((layer) => tree[layer].forEach(index));

  const collisions: BundleCollision[] = [];
  const addedIds = new Set<string>();
  const graft = (siblings: readonly RuleNode[], target: RuleNode[]): void => {
    for (const node of siblings) {
      const local = byId.get(node.id);
      if (local) {
        collisions.push({ id: node.id, title: node.title, kind: sameContent(local, node) ? "identical" : "differing" });
        if (node.children?.length) graft(node.children, (local.children ??= []));
        continue;
      }
      const clash = target.find((sibling) => sibling.slug.toLowerCase() === node.slug.toLowerCase());
      if (clash) {
        throw new BundleError(
          `Bundle node "${node.title}" (${node.id}) would sit beside "${clash.title}" (${clash.id}), ` +
            `which already uses the slug "${clash.slug}". Nothing was written.`,
        );
      }
      const { children, ...fields } = structuredClone(node);
      const copy = fields as RuleNode;
      target.push(copy);
      byId.set(copy.id, copy);
      addedIds.add(copy.id);
      if (children?.length) graft(children, (copy.children = []));
    }
  };
  for (const layer of LAYERS) graft(incoming[layer], tree[layer]);

  assertLegalStructure(tree, addedIds);
  return { tree, collisions, added: addedIds.size, replaced: 0, removed: new Set() };
}

function idsOf(tree: V2Tree): Set<string> {
  const ids = new Set<string>();
  const visit = (node: RuleNode): void => {
    ids.add(node.id);
    node.children?.forEach(visit);
  };
  LAYERS.forEach((layer) => tree[layer].forEach(visit));
  return ids;
}

/** Same content, ignoring children and bookkeeping stamps (the v1 bundle's rule). */
function sameContent(a: RuleNode, b: RuleNode): boolean {
  return stableKey(a) === stableKey(b);
}

function stableKey(node: RuleNode): string {
  const entries = Object.entries(node)
    .filter(([key]) => key !== "children" && !ITEM_BOOKKEEPING_FIELDS.has(key))
    .sort(([l], [r]) => l.localeCompare(r));
  return JSON.stringify(entries, (_key, value) =>
    isRecord(value) ? Object.fromEntries(Object.entries(value).sort(([l], [r]) => l.localeCompare(r))) : value,
  );
}

// ── Import ───────────────────────────────────────────────────────

/** Nodes a `replace` of `parsed` would discard from the v2 tree under `rexDir`. Read without the lock: for a prompt only. */
export async function countReplaceable(rexDir: string, parsed: ParsedBundle): Promise<number> {
  const model = await loadPrdModel(rexDir);
  return incomingTree(parsed).carried.reduce((total, layer) => total + countNodes(model.tree[layer]), 0);
}

/**
 * Import a parsed bundle into the v2 tree under `rexDir`, holding the PRD
 * lock across the read, merge and write. The bundle's title (and, for a v2
 * bundle, its header) is adopted when the tree had no nodes, or when a
 * replace swapped every layer.
 */
export async function importBundleIntoV2(rexDir: string, parsed: ParsedBundle, mode: ImportMode): Promise<V2MergeOutcome> {
  return withLock(prdLockPath(rexDir), async () => {
    const model = await loadPrdModel(rexDir);
    const { tree, carried, stateKeys } = incomingTree(parsed);
    const wasEmpty = countNodes(model.tree.product) + countNodes(model.tree.changes) === 0;
    // A merge keeps a local node over the bundle's, and the local row on disk already says what is state.
    const local = mode === "merge" ? idsOf(model.tree) : new Set<string>();
    for (const id of local) stateKeys.delete(id);
    const outcome = mergeV2Tree(model.tree, tree, mode, carried);
    const adopt = wasEmpty || (mode === "replace" && carried.length === LAYERS.length);
    const next: PrdModel = { ...model, tree: outcome.tree };
    const folderState: FolderStateKeys = { layers: {}, nodes: new Map() };
    if (adopt) {
      next.title = parsed.bundle.title;
      if (parsed.version === BUNDLE_VERSION_V2) next.header = parsed.bundle.header;
    }
    if (parsed.version === BUNDLE_VERSION_V2) {
      const carried = parsed.bundle.folderState ?? {};
      // Layer roots follow the header's rule; a folder node's keys follow its node, so a local node keeps its own.
      if (adopt) folderState.layers = structuredClone(carried.layers ?? {});
      for (const [id, extra] of Object.entries(carried.nodes ?? {})) {
        if (!local.has(id)) folderState.nodes.set(id, structuredClone(extra));
      }
    }
    await writePrdModel(rexDir, next, { removed: outcome.removed, stateKeys, folderState });
    return outcome;
  });
}
