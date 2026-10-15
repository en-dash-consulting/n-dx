/**
 * Migration v1 → v2, apply: a reviewed plan and the v1 tree to the v2 tree.
 *
 * {@link buildV2Tree} is pure. It reads the v1 tree as it is now, not as it
 * was planned, and takes each item's place from the plan entry with its id:
 *
 * - **Placed and held changes.** A change the plan placed amends or touches
 *   its capability or constraint. A held change lands in the Inbox
 *   (`needsPlacement`); a model's pick that was not accepted is noted in its
 *   body as a suggestion, never applied.
 * - **Items newer than the plan.** An item with no entry goes under its v1
 *   parent when that parent is change-layer work (a task, or a subtask under
 *   a task), and otherwise lands in the Inbox as its own change.
 * - **Moved items.** An item whose planned parent is gone, or can no longer
 *   hold its type, is re-fitted: change-layer work becomes a task or subtask
 *   of its new parent, and anything else lands in the Inbox as a change.
 * - **Delivery containers.** A dissolved release epic is no node: its children
 *   are placed or held like any change, its release is stamped as their
 *   `plannedRelease`, and the cut change lists every container by id.
 * - **Product nodes.** Areas keep their v1 epic names. A capability ships its
 *   drafted spec, unreviewed unless the plan recorded an approval of that
 *   exact draft. A capability or constraint starts met (`metAt` is the hash of
 *   the spec written, which for a capability the plan marks `met` is the
 *   plan's `metAt`) when its v1 item was completed or an applied change sits
 *   on it, and proposed otherwise: never revised.
 * - **The cut.** The first change, "Product map and change layer", is applied
 *   at the plan's `cutAt` and adds every capability and constraint, so the
 *   product layer's history starts with the migration.
 *
 * Every v1 id ends up as a node or a listed container: checked by count and
 * id ({@link everyV1Id}, through `fingerprintTree` and `isLossless`) before
 * anything is written and again on the tree read back.
 *
 * {@link applyV1ToV2} writes under one hold of the PRD lock. The v2 tree is
 * written to a staging folder inside the rex directory and read back; then
 * `changes/` and `product/` are renamed into place, and `prd_tree/` and
 * `tree-meta.json` are removed. The rename of `product/` is the switch: the
 * reader takes a rex directory with `product/` as v2. A crash before it
 * leaves the v1 tree; after it, the v2 tree, and the next apply removes the
 * v1 files the crash left. Apply on a v2 tree changes nothing else.
 *
 * @module migrations/v1-to-v2/apply
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { amendsHash, freeSlug } from "../../core/apply-amendments.js";
import { diffFingerprints, fingerprintTree, isLossless, type FingerprintDiff } from "../../core/slug-migration.js";
import type { PRDItem } from "../../schema/v1.js";
import { SCHEMA_VERSION_V2, type Amendment, type NodeType } from "../../schema/v2.js";
import { nodeSpec, specHash, type RuleNode, type V2Tree } from "../../schema/v2-rules.js";
import { withLock, type LockOptions } from "../../store/file-lock.js";
import { discoverPRDFiles } from "../../store/prd-discovery.js";
import { PRD_TREE_DIRNAME, TREE_META_FILENAME, prdLockPath } from "../../store/paths.js";
import { CHANGES_DIRNAME, PRODUCT_DIRNAME, loadPrdModel, type PrdModel } from "../../store/prd-model-reader.js";
import { writePrdModel } from "../../store/prd-model-writer.js";
import type { PlanFile } from "../plan-file.js";
import type { V1ToV2Entry, V1ToV2Summary } from "./index.js";
import { countCorrupt, dropCorrupt, legacyLoeBucket, legacyLoeRationale, v2Slugs, type SlugEntry } from "./migration-plan-data.js";

export type V1ToV2Plan = PlanFile<V1ToV2Entry, V1ToV2Summary>;

export const CUT_CHANGE_TITLE = "Product map and change layer";
/** The staging folder inside the rex directory; removed when apply ends. */
export const STAGING_DIRNAME = ".migrate-v2";

/** v1 keys stored in `state.yaml`, not frontmatter, though v2 no longer declares them. */
const RETIRED_STATE_KEYS = ["commits"] as const;

// ── Build ────────────────────────────────────────────────────────

/** A v1 epic that became no node; its children were placed or held. */
export interface DeliveryContainer {
  id: string;
  title: string;
  /** The release its changes carry as `plannedRelease`; absent when the plan recorded none. */
  plannedRelease?: string;
}

export interface BuiltV2Tree {
  tree: V2Tree;
  /** Id of the cut change. */
  cut: string;
  containers: DeliveryContainer[];
  /** v1 ids with no plan entry: items made after the plan. */
  late: string[];
  /** v1 ids whose planned place no longer fits, re-fitted. */
  refitted: string[];
  /** Plan entries whose item is no longer in the tree. */
  gone: string[];
  /** Changes in the Inbox. */
  inbox: number;
  /** Undeclared keys stored in `state.yaml`, by node id (`WritePrdModelOptions.stateKeys`). */
  stateKeys: Map<string, Set<string>>;
}

type WorkType = "change" | "task" | "subtask";

interface Placed {
  item: PRDItem;
  entry?: V1ToV2Entry;
  type: NodeType;
  parent?: string;
  /** Lands in the Inbox. */
  held: boolean;
}

const PRODUCT_TYPES: ReadonlySet<string> = new Set(["area", "capability", "constraint"]);
const WORK_TYPES: ReadonlySet<string> = new Set(["change", "task", "subtask"]);

/** The type `type` takes under a parent of `parentType` (whose own parent is `grandType`), or undefined when it cannot sit there. */
function fit(type: NodeType, parentType: NodeType, grandType: NodeType | undefined): NodeType | undefined {
  if (WORK_TYPES.has(type)) {
    if (parentType === "change") return "task";
    if (parentType === "task" || parentType === "subtask") return "subtask";
    return undefined;
  }
  if (type === "capability") return parentType === "area" || (parentType === "capability" && grandType !== "capability") ? type : undefined;
  if (type === "constraint") return PRODUCT_TYPES.has(parentType) ? type : undefined;
  return undefined;
}

function flatten(items: readonly PRDItem[], parent: PRDItem | undefined, out: Array<{ item: PRDItem; parent?: PRDItem }>): typeof out {
  for (const item of items) {
    out.push({ item, ...(parent ? { parent } : {}) });
    flatten(item.children ?? [], item, out);
  }
  return out;
}

/** The v2 tree for `items`, the v1 tree as it is now, by `plan`. Pure. */
export function buildV2Tree(items: readonly PRDItem[], plan: V1ToV2Plan): BuiltV2Tree {
  const { entries } = plan;
  const cutAt = plan.header.cutAt;
  const flat = flatten(items, undefined, []);
  const present = new Set(flat.map(({ item }) => item.id));
  const entryOf = (id: string): V1ToV2Entry | undefined => (Object.hasOwn(entries, id) ? entries[id] : undefined);

  // 1. Where each item would sit: its plan entry, or for a newer item, its v1 parent's work.
  const containers: DeliveryContainer[] = [];
  const initial = new Map<string, Placed>();
  const late: string[] = [];
  for (const { item, parent } of flat) {
    const entry = entryOf(item.id);
    if (entry?.target === "release") {
      containers.push({ id: item.id, title: item.title, ...(entry.plannedRelease !== undefined ? { plannedRelease: entry.plannedRelease } : {}) });
      continue;
    }
    if (entry) {
      initial.set(item.id, { item, entry, type: entry.target, ...(entry.parent !== undefined ? { parent: entry.parent } : {}), held: false });
      continue;
    }
    late.push(item.id);
    const above = parent ? initial.get(parent.id) : undefined;
    initial.set(
      item.id,
      above && WORK_TYPES.has(above.type)
        ? { item, type: "task", parent: parent!.id, held: false }
        : { item, type: "change", held: true },
    );
  }

  // 2. Re-fit against the parents as they land: a gone or unfit parent sends the item to the Inbox.
  const placed = new Map<string, Placed>();
  const refitted: string[] = [];
  const resolving = new Set<string>();
  const settle = (id: string): Placed => {
    const done = placed.get(id);
    if (done) return done;
    const start = initial.get(id)!;
    resolving.add(id);
    let result: Placed;
    const parentId = start.parent;
    const parent = parentId !== undefined && initial.has(parentId) && !resolving.has(parentId) ? settle(parentId) : undefined;
    if (parentId === undefined) {
      result = start.type === "area" || start.type === "change" ? start : inboxOf(start);
    } else if (!parent) {
      result = inboxOf(start);
    } else {
      const grand = parent.parent !== undefined ? placed.get(parent.parent)?.type : undefined;
      const type = fit(start.type, parent.type, grand);
      result = type === undefined ? inboxOf(start) : { ...start, type };
    }
    if (result.type !== start.type || result.parent !== start.parent) {
      if (start.entry) refitted.push(id);
    }
    resolving.delete(id);
    placed.set(id, result);
    return result;
  };
  for (const id of initial.keys()) settle(id);

  // 3. Slugs, from the siblings each item now has.
  const slugEntries: SlugEntry[] = [...placed.values()].map((p) => ({
    id: p.item.id,
    title: p.item.title,
    target: p.type,
    ...(p.parent !== undefined ? { parent: p.parent } : {}),
  }));
  const slugs = v2Slugs(items, slugEntries);

  // 4. Nodes.
  const stateKeys = new Map<string, Set<string>>();
  const nodes = new Map<string, RuleNode>();
  for (const p of placed.values()) {
    const node = toNode(p, slugs.get(p.item.id) ?? p.item.id, cutAt);
    const retired = RETIRED_STATE_KEYS.filter((k) => node[k] !== undefined);
    if (retired.length > 0) stateKeys.set(node.id, new Set(retired));
    nodes.set(node.id, node);
  }
  repointDissolvedBlockers(nodes, containers, flat);
  const releaseOf = new Map(containers.filter((c) => c.plannedRelease !== undefined).map((c) => [c.id, c.plannedRelease!]));
  const parentById = new Map(flat.map(({ item, parent }) => [item.id, parent?.id]));
  const tree: V2Tree = { product: [], changes: [] };
  for (const p of placed.values()) {
    const node = nodes.get(p.item.id)!;
    if (p.type === "change") {
      const release = p.entry?.plannedRelease ?? releaseOf.get(parentById.get(p.item.id) ?? "");
      if (release !== undefined) node.plannedRelease = release;
      target(node, p, nodes);
    }
    if (p.parent === undefined) {
      tree[PRODUCT_TYPES.has(p.type) ? "product" : "changes"].push(node);
    } else {
      (nodes.get(p.parent)!.children ??= []).push(node);
    }
  }

  stampMet(tree, nodes);

  const cut = cutChange(tree, containers, plan);
  tree.changes.push(cut);

  return {
    tree,
    cut: cut.id,
    containers,
    late,
    refitted,
    gone: Object.keys(entries).filter((id) => !present.has(id)),
    inbox: tree.changes.filter((n) => n.needsPlacement === true).length,
    stateKeys,
  };
}

/**
 * A `blockedBy` ref to a dissolved container names no node, and selection reads an
 * unresolved ref as an open blocker. Replace it with the nodes the container split
 * into (its v1 children, through any nested container), so the ordering survives and
 * resolves; a node never blocks itself. A container completed in v1 already satisfied
 * the dependency, so its ref is dropped; a cancelled or deleted child never completes,
 * so it is never a blocker.
 */
function repointDissolvedBlockers(
  nodes: ReadonlyMap<string, RuleNode>,
  containers: readonly DeliveryContainer[],
  flat: ReadonlyArray<{ item: PRDItem; parent?: PRDItem }>,
): void {
  if (containers.length === 0) return;
  const dissolved = new Set(containers.map((c) => c.id));
  const statusOf = new Map(flat.map(({ item }) => [item.id, item.status]));
  const childrenOf = new Map<string, string[]>();
  for (const { item, parent } of flat) {
    if (parent && dissolved.has(parent.id)) childrenOf.set(parent.id, [...(childrenOf.get(parent.id) ?? []), item.id]);
  }
  const expand = (id: string, seen: Set<string>): string[] => {
    const status = statusOf.get(id);
    if (status === "cancelled" || status === "deleted") return [];
    if (nodes.has(id)) return [id];
    if (!dissolved.has(id) || seen.has(id) || status === "completed") return [];
    seen.add(id);
    return (childrenOf.get(id) ?? []).flatMap((child) => expand(child, seen));
  };
  for (const node of nodes.values()) {
    if (!node.blockedBy?.some((ref) => dissolved.has(ref))) continue;
    const refs = [...new Set(node.blockedBy.flatMap((ref) => (dissolved.has(ref) ? expand(ref, new Set()) : [ref])))].filter((ref) => ref !== node.id);
    if (refs.length > 0) node.blockedBy = refs;
    else delete node.blockedBy;
  }
}

/** The Inbox change an item becomes when its planned place no longer exists. */
function inboxOf(p: Placed): Placed {
  return { item: p.item, ...(p.entry ? { entry: p.entry } : {}), type: "change", held: true };
}

/** The v1 item's fields as a v2 node of `p.type`: intent and state together, as the reader loads them. */
function toNode(p: Placed, slug: string, cutAt: string): RuleNode {
  const { item, entry, type } = p;
  const {
    children: _children,
    level: _level,
    description,
    acceptanceCriteria,
    loe,
    loeRationale,
    recommendationMeta,
    log,
    ...rest
  } = item;
  const node: Record<string, unknown> = { ...rest, id: item.id, type, title: item.title, slug };

  const meta = recommendationMeta === undefined ? undefined : dropCorrupt(recommendationMeta);
  if (meta !== undefined) node.recommendationMeta = meta;
  const cleanLog = log === undefined ? undefined : dropCorrupt(log);
  if (cleanLog !== undefined) node.log = cleanLog;

  const bucket = legacyLoeBucket(item);
  if (bucket !== undefined) node.loeRationale = legacyLoeRationale(bucket, loeRationale);
  else {
    if (loe !== undefined) node.loe = loe;
    if (loeRationale !== undefined) node.loeRationale = loeRationale;
  }

  const criteria = acceptanceCriteria?.length ? acceptanceCriteria : undefined;
  switch (type) {
    case "area":
      if (description !== undefined) node.summary = description;
      if (criteria) node.acceptanceCriteria = criteria;
      break;
    case "capability": {
      // The spec is the draft (plan data never holds a second list); the v1 text stays in the body.
      const spec = entry?.spec;
      if (spec?.statement !== undefined) node.statement = spec.statement;
      if (spec?.criteria.length) node.criteria = spec.criteria.map((c) => ({ id: c.id, text: c.text }));
      if (spec?.requirements.length) node.requirements = spec.requirements;
      if (description !== undefined) node.body = description;
      const reviewed = entry?.data?.reviewedHash;
      if (reviewed !== undefined && reviewed === specHash(nodeSpec(node as RuleNode))) node.reviewedHash = reviewed;
      break;
    }
    case "constraint":
      if (description !== undefined) node.statement = description;
      if (criteria) node.acceptanceCriteria = criteria;
      break;
    case "change":
      if (description !== undefined) node.intent = description;
      if (criteria) node.acceptanceCriteria = criteria;
      if (item.status === "completed") {
        const done = item.completedAt;
        node.appliedAt = entry?.data?.appliedAt ?? (done !== undefined && !Number.isNaN(Date.parse(done)) ? done : cutAt);
      }
      if (entry?.data?.shippedIn) node.shippedIn = entry.data.shippedIn.version;
      break;
    default:
      if (description !== undefined) node.description = description;
      if (criteria) node.acceptanceCriteria = criteria;
  }
  return node as RuleNode;
}

/** A change's target: its plan placement while that node landed, else the Inbox. */
function target(node: RuleNode, p: Placed, nodes: ReadonlyMap<string, RuleNode>): void {
  const placement = p.held ? undefined : p.entry?.placement;
  const on = placement === undefined ? undefined : nodes.get(placement);
  if (!on || (on.type !== "capability" && on.type !== "constraint")) {
    node.needsPlacement = true;
    const suggestion = suggestionOf(p.entry, nodes);
    if (suggestion) node.body = node.body ? `${node.body}\n\n${suggestion}` : suggestion;
    return;
  }
  if (p.entry?.relation === "amends") {
    const amendment: Amendment = { target: on.id, delta: "modified", summary: node.title, base: specHash(nodeSpec(on)) };
    node.amends = [amendment];
  } else {
    node.touches = [on.id];
  }
}

/** A model's pick that was not accepted, as a note for whoever places the change. */
function suggestionOf(entry: V1ToV2Entry | undefined, nodes: ReadonlyMap<string, RuleNode>): string | undefined {
  const mp = entry?.modelPlacement;
  const pick = mp?.text?.pick ?? mp?.jev?.pick;
  if (!mp || pick == null) return undefined;
  const node = nodes.get(pick);
  const by = Object.entries(mp.models).map(([pass, model]) => `${pass} ${model}`).join(", ");
  return `Migration suggestion (${by}, not accepted): place on ${node ? `"${node.title}" (${pick})` : pick}.`;
}

/** Met when the v1 item was completed or an applied change sits on the node; otherwise proposed. */
function stampMet(tree: V2Tree, nodes: ReadonlyMap<string, RuleNode>): void {
  const builtOn = new Set<string>();
  const visit = (node: RuleNode): void => {
    if (node.type === "change" && node.appliedAt !== undefined) {
      for (const ref of [...(node.touches ?? []), ...(node.amends ?? []).map((a) => a.target)]) builtOn.add(ref);
    }
    node.children?.forEach(visit);
  };
  tree.changes.forEach(visit);
  for (const node of nodes.values()) {
    if (node.type !== "capability" && node.type !== "constraint") continue;
    if (node.status === "completed" || builtOn.has(node.id)) node.metAt = specHash(nodeSpec(node));
  }
}

/** A UUID-shaped id from the plan, so applying one plan to one tree gives one tree. */
function cutId(plan: V1ToV2Plan): string {
  const hex = createHash("sha256").update(`cut ${plan.header.source.digest} ${plan.header.cutAt}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex[16]!, 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** The cut: an applied change that adds every capability and constraint, and names the containers that became no node. */
function cutChange(tree: V2Tree, containers: readonly DeliveryContainer[], plan: V1ToV2Plan): RuleNode {
  const id = cutId(plan);
  const at = plan.header.cutAt;
  const amends: Amendment[] = [];
  const visit = (node: RuleNode, under: RuleNode | undefined): void => {
    if (node.type === "capability" || node.type === "constraint") {
      // Keys in AmendmentSchema order, the order the reader returns them, so a re-save rewrites nothing.
      amends.push({
        target: node.id,
        delta: "added",
        summary: "Defined at the migration cut",
        ...(under ? { under: under.id } : {}),
        title: node.title,
        ...(node.type === "constraint" ? { type: "constraint" as const } : {}),
      });
    }
    node.children?.forEach((child) => visit(child, node));
  };
  tree.product.forEach((node) => visit(node, undefined));

  const lines = [
    `Moved the PRD from the v1 folder tree to the product and change layers, by plan ${plan.header.source.digest.slice(0, 12)} cut at ${at}.`,
  ];
  if (containers.length > 0) {
    lines.push("", "Delivery containers that became no node (their changes were placed or held):", "");
    for (const c of containers) lines.push(`- ${c.title} (${c.id})${c.plannedRelease !== undefined ? `: plannedRelease ${c.plannedRelease}` : ""}`);
  }
  return {
    id,
    type: "change",
    title: CUT_CHANGE_TITLE,
    slug: freeSlug(CUT_CHANGE_TITLE, id, tree.changes),
    intent: "Define the product capabilities: the product layer starts here, as built at the cut.",
    ...(amends.length > 0 ? { amends } : { spike: true }),
    body: lines.join("\n"),
    status: "completed",
    startedAt: at,
    completedAt: at,
    appliedAt: at,
    ...(amends.length > 0 ? { appliedAmendsHash: amendsHash(amends) } : {}),
  } as RuleNode;
}

// ── Check ────────────────────────────────────────────────────────

function idsOf(nodes: readonly RuleNode[], out: Set<string>): Set<string> {
  for (const node of nodes) {
    out.add(node.id);
    idsOf(node.children ?? [], out);
  }
  return out;
}

/**
 * Every v1 id in `tree` as a node, or in `containers`: a diff of the two id
 * sets through `fingerprintTree` and `diffFingerprints`. The cut is the only
 * node with no v1 id; `isLossless` holds when nothing is lost or gained.
 */
export function everyV1Id(items: readonly PRDItem[], tree: V2Tree, containers: readonly DeliveryContainer[], cut: string): FingerprintDiff {
  const ids = (list: Iterable<string>): Map<string, string> => new Map([...list].map((id) => [id, id]));
  const before = ids(fingerprintTree([...items]).keys());
  const landed = idsOf([...tree.product, ...tree.changes], new Set());
  landed.delete(cut);
  for (const c of containers) landed.add(c.id);
  return diffFingerprints(before, ids(landed));
}

/**
 * Refuse a v1 tree that holds an id more than once. The id check compares id
 * sets, and the tree is built by id, so a repeated id would lose an item
 * without either noticing.
 */
export function assertUniqueV1Ids(items: readonly PRDItem[]): void {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const { item } of flatten(items, undefined, [])) {
    if (seen.has(item.id)) repeated.add(item.id);
    seen.add(item.id);
  }
  if (repeated.size === 0) return;
  const ids = [...repeated];
  throw new MigrationApplyError(
    `The v1 tree holds ${ids.length} id${ids.length === 1 ? "" : "s"} more than once (${ids.slice(0, 5).join(", ")}${ids.length > 5 ? ", …" : ""}): ` +
      "give each item its own id, then apply again. Nothing was written.",
  );
}

function assertEveryV1Id(diff: FingerprintDiff, v1Count: number, where: string): void {
  if (isLossless(diff)) return;
  const parts = [
    diff.lost.length > 0 ? `missing ${diff.lost.length} (${diff.lost.slice(0, 5).join(", ")}${diff.lost.length > 5 ? ", …" : ""})` : "",
    diff.gained.length > 0 ? `unexpected ${diff.gained.length} (${diff.gained.slice(0, 5).join(", ")}${diff.gained.length > 5 ? ", …" : ""})` : "",
  ].filter(Boolean);
  throw new MigrationApplyError(`Not every v1 id is in the ${where}, of ${v1Count} items: ${parts.join("; ")}. Nothing was written.`);
}

// ── Apply ────────────────────────────────────────────────────────

export class MigrationApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationApplyError";
  }
}

/** Refuse a plan this apply must not write: another migration's, or one whose model pass stopped. */
export function assertApplicable(plan: PlanFile): asserts plan is V1ToV2Plan {
  if (plan.header.migration !== "v1-to-v2") {
    throw new MigrationApplyError(`The plan is for migration ${plan.header.migration}, not v1-to-v2.`);
  }
  const stopped = plan.header.passes.filter((p) => p.incomplete);
  if (stopped.length > 0) {
    throw new MigrationApplyError(
      `The plan is incomplete: ${stopped.map((p) => `the ${p.name} pass stopped (${p.incomplete!.error})`).join("; ")}. Plan again before applying. Nothing was written.`,
    );
  }
}

/**
 * Legacy PRD sources beside the tree: `prd.md`, `prd.json` and branch-scoped
 * `prd_<branch>_<date>.json` — the files `FileAdapter.loadLegacyDocument`
 * reads once the tree is gone, and a v1 save then turns into a new
 * `prd_tree/` beside the v2 tree. A `prd.json.migrated` marker does not make
 * `prd.json` safe: that read ignores it. So apply refuses while any is present.
 */
async function legacySources(rexDir: string): Promise<string[]> {
  const found = [join(rexDir, "prd.md"), join(rexDir, "prd.json")];
  found.push(...(await discoverPRDFiles(rexDir)).map((name) => join(rexDir, name)));
  return found.filter((path) => existsSync(path));
}

async function assertNoLegacySources(rexDir: string): Promise<void> {
  const found = await legacySources(rexDir);
  if (found.length === 0) return;
  const them = found.length > 1 ? "them" : "it";
  throw new MigrationApplyError(
    `Legacy PRD source${found.length > 1 ? "s" : ""} beside the tree: ${found.join(", ")}. Applying would leave ${them} to be migrated back into a new prd_tree/ next to the v2 tree. Move or delete ${them}, after checking nothing is missing from the tree, then apply again. Nothing was written.`,
  );
}

export interface ApplyV1ToV2Options {
  /** Reads the v1 tree; called under the PRD lock. */
  load: () => Promise<{ title: string; items: PRDItem[] }>;
  lock?: LockOptions;
}

export type ApplyV1ToV2Result =
  | { status: "already-v2"; removed: string[] }
  | { status: "applied"; built: Omit<BuiltV2Tree, "tree" | "stateKeys">; nodes: number; v1Items: number; files: number };

interface Prepared {
  v1: { title: string; items: PRDItem[] };
  built: BuiltV2Tree;
  v1Items: number;
}

/** The refusals, the build and the id check shared by apply and its rehearsal; writes nothing. */
async function prepare(plan: PlanFile | undefined, options: Pick<ApplyV1ToV2Options, "load">): Promise<Prepared> {
  if (!plan) throw new MigrationApplyError("No migration plan to apply.");
  assertApplicable(plan);
  const v1 = await options.load();
  assertUniqueV1Ids(v1.items);
  const built = buildV2Tree(v1.items, plan);
  const v1Items = fingerprintTree(v1.items).size;
  assertEveryV1Id(everyV1Id(v1.items, built.tree, built.containers, built.cut), v1Items, "v2 tree");
  return { v1, built, v1Items };
}

/**
 * Write the built model into `dir` and read it back, refusing what apply refuses:
 * a writer error, a skipped warning on read-back, or a v1 id the read-back lost.
 * `dir` must exist; the caller owns it and cleans up.
 */
async function writeAndVerify(dir: string, prepared: Prepared, lock: LockOptions | undefined): Promise<{ files: number; nodes: number }> {
  const { v1, built, v1Items } = prepared;
  const model: PrdModel = { layout: "v2", schema: SCHEMA_VERSION_V2, title: v1.title, tree: built.tree, warnings: [] };
  const written = await withLock(prdLockPath(dir), () => writePrdModel(dir, model, { stateKeys: built.stateKeys }), lock);
  const back = await loadPrdModel(dir, { ignoreSchemaSkew: false });
  const skipped = back.warnings.filter((w) => w.skipped);
  if (skipped.length > 0) {
    throw new MigrationApplyError(`The written v2 tree does not read back: ${skipped.map((w) => `${w.path}: ${w.message}`).join("; ")}. Nothing was written.`);
  }
  assertEveryV1Id(everyV1Id(v1.items, back.tree, built.containers, built.cut), v1Items, "v2 tree read back");
  return { files: written.written.length, nodes: idsOf([...back.tree.product, ...back.tree.changes], new Set()).size };
}

// ── Rehearsal ────────────────────────────────────────────────────

export type V1Kind = "epic" | "feature" | "task" | "subtask";
export const V1_KINDS: readonly V1Kind[] = ["epic", "feature", "task", "subtask"];

/** What the v1 items of one kind become. The `become` counts add up to `total`. */
export interface KindTally {
  total: number;
  /** By v2 type; `release` is a delivery container that becomes no node. */
  become: Record<NodeType | "release", number>;
  /** Changes held for the Inbox (also counted under `change`). */
  held: number;
  /** Metadata values dropped: corrupt `[object Object]` strings in `recommendationMeta`. */
  droppedMeta: number;
  /** Log values dropped, likewise. */
  droppedLog: number;
}

const emptyTally = (): KindTally => ({
  total: 0,
  become: { area: 0, capability: 0, constraint: 0, change: 0, task: 0, subtask: 0, release: 0 },
  held: 0,
  droppedMeta: 0,
  droppedLog: 0,
});

/** Per v1 kind, what its items become in `built`. Pure; the cut change has no v1 item and is not counted. */
export function tallyV1ToV2(items: readonly PRDItem[], built: Pick<BuiltV2Tree, "tree" | "containers">): Record<V1Kind, KindTally> {
  const nodes = new Map<string, RuleNode>();
  const index = (list: readonly RuleNode[]): void => {
    for (const node of list) {
      nodes.set(node.id, node);
      index(node.children ?? []);
    }
  };
  index([...built.tree.product, ...built.tree.changes]);
  const containers = new Set(built.containers.map((c) => c.id));

  const out = Object.fromEntries(V1_KINDS.map((k) => [k, emptyTally()])) as Record<V1Kind, KindTally>;
  for (const { item } of flatten(items, undefined, [])) {
    const tally = out[item.level as V1Kind];
    tally.total++;
    tally.droppedMeta += countCorrupt(item.recommendationMeta);
    tally.droppedLog += countCorrupt(item.log);
    if (containers.has(item.id)) {
      tally.become.release++;
      continue;
    }
    const node = nodes.get(item.id)!;
    tally.become[node.type]++;
    if (node.needsPlacement === true) tally.held++;
  }
  return out;
}

export type RehearseV1ToV2Result =
  | { status: "already-v2"; removed: string[] }
  | { status: "rehearsed"; built: Omit<BuiltV2Tree, "tree" | "stateKeys">; kinds: Record<V1Kind, KindTally>; nodes: number; files: number; v1Items: number };

/**
 * {@link applyV1ToV2} without the swap: the same refusals, id check, write and
 * read-back, the write going to an OS temp directory that is removed afterwards.
 * Writes nothing under `rexDir` and does not take its PRD lock.
 * On a v2 tree, `removed` lists the v1 files apply would remove.
 */
export async function rehearseV1ToV2(rexDir: string, plan: PlanFile | undefined, options: Pick<ApplyV1ToV2Options, "load">): Promise<RehearseV1ToV2Result> {
  if (existsSync(join(rexDir, PRODUCT_DIRNAME))) {
    return { status: "already-v2", removed: [join(rexDir, PRD_TREE_DIRNAME), join(rexDir, TREE_META_FILENAME)].filter((path) => existsSync(path)) };
  }
  if (!existsSync(join(rexDir, PRD_TREE_DIRNAME))) throw new MigrationApplyError(`No PRD folder tree at ${join(rexDir, PRD_TREE_DIRNAME)}: nothing to apply.`);
  await assertNoLegacySources(rexDir);
  const prepared = await prepare(plan, options);
  const { v1, built, v1Items } = prepared;
  const scratch = await mkdtemp(join(tmpdir(), "rex-migrate-rehearsal-"));
  let verified: { files: number; nodes: number };
  try {
    verified = await writeAndVerify(scratch, prepared, undefined);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  const { tree: _tree, stateKeys: _keys, ...summary } = built;
  return { status: "rehearsed", built: summary, kinds: tallyV1ToV2(v1.items, built), ...verified, v1Items };
}

/**
 * Apply `plan` to the v1 tree under `rexDir`, holding the PRD lock throughout.
 * A tree already v2 is left as is, apart from v1 files an interrupted apply
 * left beside it.
 */
export async function applyV1ToV2(rexDir: string, plan: PlanFile | undefined, options: ApplyV1ToV2Options): Promise<ApplyV1ToV2Result> {
  const staging = join(rexDir, STAGING_DIRNAME);
  const productDir = join(rexDir, PRODUCT_DIRNAME);
  const changesDir = join(rexDir, CHANGES_DIRNAME);
  const v1Files = [join(rexDir, PRD_TREE_DIRNAME), join(rexDir, TREE_META_FILENAME)];

  return withLock(
    prdLockPath(rexDir),
    async () => {
      await rm(staging, { recursive: true, force: true });
      if (existsSync(productDir)) {
        const removed = v1Files.filter((path) => existsSync(path));
        for (const path of removed) await rm(path, { recursive: true, force: true });
        return { status: "already-v2", removed };
      }
      if (!existsSync(v1Files[0]!)) throw new MigrationApplyError(`No PRD folder tree at ${v1Files[0]}: nothing to apply.`);
      await assertNoLegacySources(rexDir);
      if (!plan) throw new MigrationApplyError("No migration plan to apply.");
      assertApplicable(plan);
      // Without product/ the tree reads as v1, so a changes/ here is what an interrupted apply moved in.
      await rm(changesDir, { recursive: true, force: true });

      const prepared = await prepare(plan, options);
      const { built, v1Items } = prepared;

      let files: number;
      let nodes: number;
      try {
        await mkdir(staging, { recursive: true });
        ({ files, nodes } = await writeAndVerify(staging, prepared, options.lock));
        if (existsSync(join(staging, CHANGES_DIRNAME))) await rename(join(staging, CHANGES_DIRNAME), changesDir);
        await rename(join(staging, PRODUCT_DIRNAME), productDir);
      } catch (err) {
        await rm(changesDir, { recursive: true, force: true });
        await rm(staging, { recursive: true, force: true });
        throw err;
      }
      for (const path of [...v1Files, staging]) await rm(path, { recursive: true, force: true });

      const { tree: _tree, stateKeys: _keys, ...summary } = built;
      return { status: "applied", built: summary, nodes, v1Items, files };
    },
    options.lock,
  );
}
