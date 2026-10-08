/**
 * Bundle envelope v2: both layers of a v2 tree in one transport file.
 *
 * Envelope v1 (`../core/prd-bundle.ts`) carries a v1 item list. Envelope v2
 * carries what a v2 tree holds: the root header, the `product` layer and the
 * `changes` layer, each node as the v2 reader loads it (intent merged with
 * its `state.yaml` row, children nested). The same carve-out applies: a
 * bundle is written outside the rex directory and never read as storage.
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
import { ItemStateSchema, NodeIntentSchema, SCHEMA_VERSION_V2, isV2Schema, type Layer } from "../schema/v2.js";
import { checkV2Rules, type RuleNode, type V2Tree } from "../schema/v2-rules.js";
import { withLock } from "./file-lock.js";
import { resolveSiblingSlugs } from "./folder-tree-serializer.js";
import { prdLockPath } from "./paths.js";
import type { ParseWarning } from "./folder-tree-parser.js";
import { PRODUCT_DIRNAME, V1_LEVEL_TYPES, loadPrdModel, type PrdModel } from "./prd-model-reader.js";
import { writePrdModel } from "./prd-model-writer.js";

/** Envelope version that carries both v2 layers. */
export const BUNDLE_VERSION_V2 = 2;

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
  product: RuleNode[];
  changes: RuleNode[];
}

/** A parsed bundle of either envelope. */
export type ParsedBundle =
  | { version: 1; bundle: PRDBundle }
  | { version: typeof BUNDLE_VERSION_V2; bundle: PRDBundleV2 };

const LAYERS: readonly Layer[] = ["product", "changes"];

/** Root header keys the writer stamps itself; a bundle neither carries nor applies them. */
const STAMPED_HEADER_KEYS: ReadonlySet<string> = new Set(["title", "schema", "slugRule"]);

const STATE_KEYS: ReadonlySet<string> = new Set(Object.keys(ItemStateSchema.shape));

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
}

/** Snapshot a loaded v2 model into an envelope v2 bundle. The nodes are deep-cloned. */
export function buildBundleV2(model: PrdModel, options: BuildBundleV2Options = {}): PRDBundleV2 {
  const provenance: BundleProvenance = {};
  if (options.branch) provenance.branch = options.branch;
  if (options.commit) provenance.commit = options.commit;
  const header = carriedHeader(model.header);

  return {
    bundle: BUNDLE_KIND,
    bundleVersion: BUNDLE_VERSION_V2,
    schema: model.schema,
    title: model.title,
    ...(header ? { header } : {}),
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    ...(Object.keys(provenance).length > 0 ? { exportedFrom: provenance } : {}),
    product: structuredClone(model.tree.product),
    changes: structuredClone(model.tree.changes),
  };
}

export interface V2Export {
  bundle: PRDBundleV2;
  /** Nodes the reader skipped (invalid intent), which the bundle therefore lacks. */
  warnings: ParseWarning[];
}

/** Read the v2 tree under the PRD lock and build its bundle. */
export async function exportV2Bundle(rexDir: string, options: BuildBundleV2Options = {}): Promise<V2Export> {
  const model = await withLock(prdLockPath(rexDir), () => loadPrdModel(rexDir));
  return { bundle: buildBundleV2(model, options), warnings: model.warnings };
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

  const tree: V2Tree = { product: candidate.product as RuleNode[], changes: candidate.changes as RuleNode[] };
  for (const layer of LAYERS) assertValidNodes(tree[layer]);
  assertUniqueIds(tree);
  assertLegalStructure(tree);

  const parsed: PRDBundleV2 = {
    bundle: BUNDLE_KIND,
    bundleVersion: BUNDLE_VERSION_V2,
    schema,
    title,
    exportedAt,
    product: tree.product,
    changes: tree.changes,
  };
  const header = carriedHeader(candidate.header as Record<string, unknown> | undefined);
  if (header) parsed.header = header;
  if (isRecord(candidate.exportedFrom)) {
    const { branch, commit } = candidate.exportedFrom;
    const provenance: BundleProvenance = {};
    if (typeof branch === "string") provenance.branch = branch;
    if (typeof commit === "string") provenance.commit = commit;
    if (Object.keys(provenance).length > 0) parsed.exportedFrom = provenance;
  }
  return parsed;
}

/** Hold each node's intent and state to the schemas the tree's own files are held to. */
function assertValidNodes(nodes: unknown[]): void {
  for (const node of nodes) {
    if (!isRecord(node)) throw new BundleError("Bundle contains a node that is not an object.");
    const label = `"${String(node.title)}" (${String(node.id)})`;
    if (node.children !== undefined && !Array.isArray(node.children)) {
      throw new BundleError(`Bundle node ${label} has a "children" that is not an array.`);
    }
    const intent: Record<string, unknown> = {};
    const state: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key !== "children") (STATE_KEYS.has(key) ? state : intent)[key] = value;
    }
    for (const result of [NodeIntentSchema.safeParse(intent), ItemStateSchema.safeParse(state)]) {
      if (!result.success) {
        const issues = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
        throw new BundleError(`Bundle contains an invalid node ${label}: ${issues}. Nothing was written.`);
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

/** A parsed bundle as a v2 tree, and which layers it carries. */
function incomingTree(parsed: ParsedBundle): { tree: V2Tree; carried: readonly Layer[] } {
  return parsed.version === 1
    ? { tree: { product: [], changes: v1ItemsToNodes(parsed.bundle.items) }, carried: ["changes"] }
    : { tree: { product: parsed.bundle.product, changes: parsed.bundle.changes }, carried: LAYERS };
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
    const { tree, carried } = incomingTree(parsed);
    const wasEmpty = countNodes(model.tree.product) + countNodes(model.tree.changes) === 0;
    const outcome = mergeV2Tree(model.tree, tree, mode, carried);
    const adopt = wasEmpty || (mode === "replace" && carried.length === LAYERS.length);
    const next: PrdModel = { ...model, tree: outcome.tree };
    if (adopt) {
      next.title = parsed.bundle.title;
      if (parsed.version === BUNDLE_VERSION_V2) next.header = parsed.bundle.header;
    }
    await writePrdModel(rexDir, next, { removed: outcome.removed });
    return outcome;
  });
}
