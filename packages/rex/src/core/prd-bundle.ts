/**
 * Portable PRD bundle — a single-file transport format for the PRD tree.
 *
 * ## Why a JSON file exists at all
 *
 * The PRD invariant is that `.rex/prd_tree/` is the sole writable PRD surface
 * and no mutation writes JSON. A bundle does not violate it: it is a
 * *transport artifact* written to a user-chosen path outside `.rex/`, never
 * read as a backend and never a write target for a PRD mutation. Import
 * reconstructs the folder tree through the normal store write path, under the
 * store transaction lock.
 *
 * ## Version gating is stricter here than at store read boundaries
 *
 * {@link isCompatibleSchema} deliberately accepts newer *minor* versions so a
 * document written by a slightly newer rex still loads. A bundle cannot take
 * that liberty: it arrives from an unknown machine and is applied wholesale, so
 * a field this rex does not understand would be silently dropped on the way
 * into the tree. {@link parseBundle} therefore rejects anything newer than the
 * running schema, and does so before any write happens.
 *
 * ## A scoped bundle is a closure, not a filter
 *
 * {@link scopeItems} carves one item out of the tree for transport. It cannot
 * simply keep the matching subtree: a task inside it may be `blockedBy` an
 * item in another epic, and a fragment that keeps the edge without the target
 * imports a dangling dependency. So the selection is closed under descendants,
 * `blockedBy`, and ancestry — see that function for the rules and their cost.
 *
 * @module rex/core/prd-bundle
 */

import { SCHEMA_VERSION } from "../schema/index.js";
import type { PRDDocument, PRDItem } from "../schema/index.js";
import { validateDocument } from "../schema/validate.js";
import { findItem } from "./tree.js";

/** Discriminator stored in every bundle, so a stray JSON file is rejected by shape. */
export const BUNDLE_KIND = "rex/prd-bundle";

/**
 * Version of the bundle envelope itself, independent of the PRD schema
 * version it carries. Bump when the envelope gains or changes a field.
 */
export const BUNDLE_VERSION = 1;

/** Where and when a bundle was produced. Informational — import never depends on it. */
export interface BundleProvenance {
  branch?: string;
  commit?: string;
}

export interface PRDBundle {
  bundle: typeof BUNDLE_KIND;
  bundleVersion: number;
  /** The rex schema version of the items, as of export. */
  schema: string;
  title: string;
  exportedAt: string;
  exportedFrom?: BundleProvenance;
  items: PRDItem[];
}

/**
 * A bundle was malformed, or came from a rex too new to read it.
 *
 * Distinct from a generic Error so the CLI can report it as an operator
 * problem (bad file, wrong version) rather than an internal fault.
 */
export class BundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleError";
  }
}

// ── Export ───────────────────────────────────────────────────────────────────

export interface BuildBundleOptions {
  /** Override the export timestamp (tests, reproducible fixtures). */
  exportedAt?: string;
  branch?: string;
  commit?: string;
}

/**
 * Remote-sync bookkeeping that must not travel in a bundle.
 *
 * `lastSyncedAt` and `remoteId` bind an item to the *source project's* remote:
 * its sync watermark and its page in that project's Notion/Jira/Asana
 * workspace. Imported elsewhere they are actively harmful — a `lastSyncedAt`
 * at or after `lastModified` makes `isModifiedSinceSync` read the item as
 * unchanged, so the destination's first bidirectional sync lets its remote
 * overwrite the freshly imported content in silence, and the stale `remoteId`
 * points the destination's sync at another project's remote records.
 *
 * `lastModified` / `lastModifiedBy` stay: they are content attribution, not
 * remote pointers, and the import path depends on them (see
 * {@link defaultTimestampFromExport}). Whole-bundle provenance belongs in
 * `exportedFrom`, not in per-item remote pointers.
 */
const BUNDLE_STRIPPED_FIELDS = ["lastSyncedAt", "remoteId"] as const;

/** Remove per-item remote-sync pointers, in place, across a whole tree. */
function stripSyncBookkeeping(items: PRDItem[]): void {
  for (const item of items) {
    for (const field of BUNDLE_STRIPPED_FIELDS) delete item[field];
    if (item.children?.length) stripSyncBookkeeping(item.children);
  }
}

/**
 * Snapshot a loaded PRD document into a bundle.
 *
 * The items are deep-cloned: a bundle is a value, and a caller that mutates
 * one must not reach back into the document it came from. The clone is also
 * where remote-sync bookkeeping is stripped — see
 * {@link BUNDLE_STRIPPED_FIELDS}.
 */
export function buildBundle(doc: PRDDocument, options: BuildBundleOptions = {}): PRDBundle {
  const provenance: BundleProvenance = {};
  if (options.branch) provenance.branch = options.branch;
  if (options.commit) provenance.commit = options.commit;

  const items = structuredClone(doc.items);
  stripSyncBookkeeping(items);

  return {
    bundle: BUNDLE_KIND,
    bundleVersion: BUNDLE_VERSION,
    schema: SCHEMA_VERSION,
    title: doc.title,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    ...(Object.keys(provenance).length > 0 ? { exportedFrom: provenance } : {}),
    items,
  };
}

// ── Scope ────────────────────────────────────────────────────────────────────

/**
 * Why an item is in a scoped bundle.
 *
 * Reported back to the operator because a scoped export can grow well past
 * what was asked for: "requested" is what they named and everything beneath
 * it, the other two are what the closure dragged along.
 */
export type ScopeReason = "requested" | "dependency" | "ancestor";

/** A `blockedBy` edge whose target does not exist in the source PRD. */
export interface DroppedEdge {
  /** The item carrying the edge. */
  id: string;
  title: string;
  /** The unresolvable target id. */
  blockedBy: string;
}

export interface ScopedSelection {
  /** The pruned tree, ready to hand to {@link buildBundle}. */
  items: PRDItem[];
  /** Every included id, and why. */
  reasons: Map<string, ScopeReason>;
  counts: Record<ScopeReason, number>;
  /**
   * Edges dropped because their target is missing from the source PRD — a
   * pre-existing break, surfaced rather than carried into the bundle.
   */
  droppedEdges: DroppedEdge[];
}

/**
 * Precedence when an item qualifies for more than one reason.
 *
 * Lower wins. "requested" outranks everything because the operator named it;
 * "dependency" outranks "ancestor" because a blocker pulled in from another
 * epic is the interesting half of the report, while a container is expected.
 */
const REASON_RANK: Record<ScopeReason, number> = {
  requested: 0,
  dependency: 1,
  ancestor: 2,
};

/**
 * Select the items a scoped bundle must carry, rooted at `rootId`.
 *
 * This is a closure, not a filter. Three rules feed each other until nothing
 * new is reachable:
 *
 * 1. The requested item brings **every descendant** — otherwise the fragment
 *    arrives as a childless stub.
 * 2. Any included item brings **the items it is `blockedBy`**. A bundle that
 *    keeps the edge but omits the target imports into a tree with a dangling
 *    dependency; one that drops the edge loses sequencing information.
 * 3. Any included item brings **its ancestor containers**, so import places
 *    the subtree at its original depth instead of re-parenting it to the root.
 *
 * Rules 2 and 3 apply to items the closure itself pulled in, which is why this
 * is a worklist rather than three passes: a blocker in another epic drags in
 * its own containers, and those containers may carry `blockedBy` edges of
 * their own.
 *
 * Blockers are carried without their descendants. Only the requested item
 * expands downward — a blocker is needed as a dependency target, not as a body
 * of work, and pulling its subtree would make a scoped export unbounded in
 * practice. It is included exactly the way an ancestor container is.
 *
 * @throws {BundleError} If `rootId` is not in `items`.
 */
export function scopeItems(items: PRDItem[], rootId: string): ScopedSelection {
  const byId = new Map<string, PRDItem>();
  const parentOf = new Map<string, string>();

  const index = (siblings: PRDItem[], parentId?: string): void => {
    for (const item of siblings) {
      byId.set(item.id, item);
      if (parentId !== undefined) parentOf.set(item.id, parentId);
      if (item.children?.length) index(item.children, item.id);
    }
  };
  index(items);

  if (!byId.has(rootId)) {
    throw new BundleError(`No PRD item with id "${rootId}" — nothing to scope the bundle to.`);
  }

  const reasons = new Map<string, ScopeReason>();
  const queue: string[] = [];

  /** Record a reason, re-queueing only when it improves on what we knew. */
  const select = (id: string, reason: ScopeReason): void => {
    if (!byId.has(id)) return;
    const current = reasons.get(id);
    if (current !== undefined && REASON_RANK[current] <= REASON_RANK[reason]) return;
    reasons.set(id, reason);
    queue.push(id);
  };

  select(rootId, "requested");

  while (queue.length > 0) {
    const id = queue.pop() as string;
    const item = byId.get(id) as PRDItem;

    if (reasons.get(id) === "requested") {
      for (const child of item.children ?? []) select(child.id, "requested");
    }

    for (const blocker of item.blockedBy ?? []) select(blocker, "dependency");

    const parentId = parentOf.get(id);
    if (parentId !== undefined) select(parentId, "ancestor");
  }

  const droppedEdges: DroppedEdge[] = [];

  /**
   * Rebuild the tree with only the selected items, preserving order and depth.
   *
   * A `blockedBy` target absent from the selection can only be one that is
   * absent from the PRD entirely — the closure above selected every
   * resolvable one — so filtering here is what makes "no dangling edges in a
   * bundle" true even for a PRD that already had a broken edge.
   */
  const prune = (siblings: PRDItem[]): PRDItem[] => {
    const kept: PRDItem[] = [];

    for (const item of siblings) {
      if (!reasons.has(item.id)) continue;

      const node = structuredClone(item);
      delete node.children;

      if (node.blockedBy) {
        const resolved = node.blockedBy.filter((target) => reasons.has(target));
        for (const target of node.blockedBy) {
          if (!reasons.has(target)) {
            droppedEdges.push({ id: item.id, title: item.title, blockedBy: target });
          }
        }
        if (resolved.length > 0) node.blockedBy = resolved;
        else delete node.blockedBy;
      }

      const children = prune(item.children ?? []);
      if (children.length > 0) node.children = children;

      kept.push(node);
    }

    return kept;
  };

  const pruned = prune(items);

  const counts: Record<ScopeReason, number> = { requested: 0, dependency: 0, ancestor: 0 };
  for (const reason of reasons.values()) counts[reason] += 1;

  return { items: pruned, reasons, counts, droppedEdges };
}

// ── Import ───────────────────────────────────────────────────────────────────

/** Parsed `rex/vMAJOR[.MINOR]` version string. */
function parseSchemaVersion(version: string): { major: number; minor: number } | null {
  const match = /^rex\/v(\d+)(?:\.(\d+))?$/.exec(version);
  if (!match) return null;
  return { major: Number(match[1]), minor: match[2] ? Number(match[2]) : 0 };
}

/**
 * Reject a tree in which two items claim the same id.
 *
 * `rex export` can never produce one — this guards the bundles it did not
 * write. Titles of both claimants are named so the operator can tell a
 * copy-paste slip from two genuinely different items.
 *
 * @throws {BundleError} On the first duplicated id, before any write.
 */
function assertUniqueIds(items: PRDItem[], seen = new Map<string, string>()): void {
  for (const item of items) {
    const first = seen.get(item.id);
    if (first !== undefined) {
      throw new BundleError(
        `Bundle contains the same item id twice: "${item.id}" (as "${first}" and "${item.title}"). ` +
          `Every item id must be unique. Nothing was written.`,
      );
    }
    seen.set(item.id, item.title);
    if (item.children?.length) assertUniqueIds(item.children, seen);
  }
}

/**
 * Validate an untrusted parsed-JSON payload as a bundle.
 *
 * Every check here runs before the caller touches the tree, so a rejected
 * bundle leaves the PRD untouched.
 *
 * @throws {BundleError} If the payload is not a bundle, is newer than this
 *   rex can read, carries items that fail schema validation, or claims the
 *   same item id twice.
 */
export function parseBundle(raw: unknown): PRDBundle {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new BundleError("This file is not a rex PRD bundle (expected a JSON object).");
  }

  const candidate = raw as Record<string, unknown>;

  if (candidate.bundle !== BUNDLE_KIND) {
    throw new BundleError(
      `This file is not a rex PRD bundle (expected "bundle": "${BUNDLE_KIND}").`,
    );
  }

  const bundleVersion = candidate.bundleVersion;
  if (typeof bundleVersion !== "number" || !Number.isInteger(bundleVersion) || bundleVersion < 1) {
    throw new BundleError(`Bundle has an invalid "bundleVersion": ${String(bundleVersion)}.`);
  }
  if (bundleVersion > BUNDLE_VERSION) {
    throw new BundleError(
      `Bundle format version ${bundleVersion} is newer than this rex supports (${BUNDLE_VERSION}). ` +
        `Upgrade rex to import it. Nothing was written.`,
    );
  }

  const schema = candidate.schema;
  if (typeof schema !== "string") {
    throw new BundleError('Bundle is missing its "schema" version.');
  }
  const bundleSchema = parseSchemaVersion(schema);
  const runningSchema = parseSchemaVersion(SCHEMA_VERSION);
  if (!bundleSchema || !runningSchema || bundleSchema.major !== runningSchema.major) {
    throw new BundleError(
      `Bundle has an incompatible PRD schema "${schema}", expected "${SCHEMA_VERSION}". Nothing was written.`,
    );
  }
  if (bundleSchema.minor > runningSchema.minor) {
    throw new BundleError(
      `Bundle schema "${schema}" is newer than this rex supports ("${SCHEMA_VERSION}"). ` +
        `Upgrade rex to import it. Nothing was written.`,
    );
  }

  const title = candidate.title;
  if (typeof title !== "string") {
    throw new BundleError('Bundle is missing its "title".');
  }

  const exportedAt = candidate.exportedAt;
  if (typeof exportedAt !== "string") {
    throw new BundleError('Bundle is missing its "exportedAt" timestamp.');
  }

  if (!Array.isArray(candidate.items)) {
    throw new BundleError('Bundle is missing its "items" array.');
  }

  // Reuse the document validator so bundle items are held to exactly the same
  // field contract as items already in the tree — no second, drifting schema.
  const validation = validateDocument({ schema: SCHEMA_VERSION, title, items: candidate.items });
  if (!validation.ok) {
    throw new BundleError(`Bundle contains invalid PRD items: ${validation.errors.message}`);
  }

  // The field validator checks each item alone; id uniqueness is a property of
  // the whole tree, and it is the one this boundary exists to defend. Two
  // items claiming one id would survive `--replace` into the tree (the
  // serializer is positional and loses nothing), where every id-keyed
  // operation — findItem, update, remove — resolves them ambiguously.
  assertUniqueIds(candidate.items as PRDItem[]);

  // `rex export` strips these, but a bundle from an older rex or another tool
  // may still carry them — the guarantee that imported items arrive without
  // another project's remote pointers has to hold at this boundary too.
  stripSyncBookkeeping(candidate.items as PRDItem[]);

  const parsed: PRDBundle = {
    bundle: BUNDLE_KIND,
    bundleVersion,
    schema,
    title,
    exportedAt,
    items: candidate.items as PRDItem[],
  };

  const from = candidate.exportedFrom;
  if (typeof from === "object" && from !== null) {
    const { branch, commit } = from as Record<string, unknown>;
    const provenance: BundleProvenance = {};
    if (typeof branch === "string") provenance.branch = branch;
    if (typeof commit === "string") provenance.commit = commit;
    if (Object.keys(provenance).length > 0) parsed.exportedFrom = provenance;
  }

  return parsed;
}

// ── Merge ────────────────────────────────────────────────────────────────────

export type ImportMode = "merge" | "replace";

export type CollisionKind = "identical" | "differing";

export interface BundleCollision {
  id: string;
  /** Title as it appears in the bundle. */
  title: string;
  kind: CollisionKind;
}

export interface MergeOutcome {
  /** The tree to save. */
  items: PRDItem[];
  /** Bundle items whose id already existed locally. `merge` keeps the local copy. */
  collisions: BundleCollision[];
  /** Count of items the bundle contributed. */
  added: number;
  /** Count of local items discarded — non-zero only in `replace` mode. */
  replaced: number;
}

/** Count every item in a tree, including descendants. */
export function countItems(items: PRDItem[]): number {
  let total = 0;
  for (const item of items) {
    total += 1;
    if (item.children?.length) total += countItems(item.children);
  }
  return total;
}

/**
 * Compare two items by content, ignoring their children.
 *
 * Placement is deliberately excluded: `merge` never moves a local item, so a
 * bundle item that sits under a different parent locally is still "identical"
 * when its own fields match. Hierarchy divergence is a `--replace` concern.
 */
function sameContent(a: PRDItem, b: PRDItem): boolean {
  return stableKey(a) === stableKey(b);
}

function stableKey(item: PRDItem): string {
  const entries = Object.entries(item)
    .filter(([key]) => key !== "children")
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(entries, (_key, value) =>
    // Nested objects need the same key ordering, or two equal items with
    // differently-ordered keys would read as differing.
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>).sort(([l], [r]) => l.localeCompare(r)),
        )
      : value,
  );
}

/**
 * Give an attribution-only item the bundle's export time as its timestamp.
 *
 * An item carrying `lastModifiedBy` without `lastModified` is a trap: the
 * store deliberately keeps a partial stamp as-is (re-stamping overwrote the
 * original author), but `isModifiedSinceSync` reads a missing timestamp as
 * "never modified" — so the item would land on disk permanently invisible to
 * remote sync push, and a later pull could overwrite it in silence. The
 * bundle's `exportedAt` is the honest default: the content is at least that
 * old, and the author it names really did write it by then.
 *
 * An item with *neither* field is left alone on purpose — the import
 * transaction stamps it with the importing actor and the current time, which
 * is the established rule for unstamped new items.
 */
function defaultTimestampFromExport(item: PRDItem, exportedAt: string): void {
  if (item.lastModifiedBy !== undefined && item.lastModified === undefined) {
    item.lastModified = exportedAt;
  }
}

/**
 * Apply a bundle to an existing tree.
 *
 * `merge` (default) is additive and never destructive: every local item keeps
 * its content and its place, bundle items with unseen ids are grafted onto the
 * matching parent, and an id that already exists anywhere in the local tree is
 * reported as a collision rather than duplicated. `replace` discards the local
 * tree entirely.
 *
 * The returned items are cloned — the bundle is left intact for the caller to
 * report on afterwards.
 */
export function mergeBundle(
  existing: PRDItem[],
  bundle: PRDBundle,
  mode: ImportMode,
): MergeOutcome {
  if (mode === "replace") {
    const replacement = structuredClone(bundle.items);
    const walk = (siblings: PRDItem[]): void => {
      for (const item of siblings) {
        defaultTimestampFromExport(item, bundle.exportedAt);
        if (item.children?.length) walk(item.children);
      }
    };
    walk(replacement);
    return {
      items: replacement,
      collisions: [],
      added: countItems(bundle.items),
      replaced: countItems(existing),
    };
  }

  const items = structuredClone(existing);
  const collisions: BundleCollision[] = [];
  let added = 0;

  /**
   * Walk the bundle tree against a target sibling list.
   *
   * The id lookup is global (against the whole evolving tree) rather than
   * limited to `target`, so an item that lives under a different parent
   * locally is recognised instead of being cloned into a second home.
   */
  const graft = (bundleSiblings: PRDItem[], target: PRDItem[]): void => {
    for (const incoming of bundleSiblings) {
      const local = findItem(items, incoming.id);

      if (local) {
        collisions.push({
          id: incoming.id,
          title: incoming.title,
          kind: sameContent(local.item as PRDItem, incoming) ? "identical" : "differing",
        });
        if (incoming.children?.length) {
          const localItem = local.item as PRDItem;
          localItem.children ??= [];
          graft(incoming.children, localItem.children);
        }
        continue;
      }

      const node = structuredClone(incoming);
      delete node.children;
      defaultTimestampFromExport(node, bundle.exportedAt);
      target.push(node);
      added += 1;

      if (incoming.children?.length) {
        node.children = [];
        graft(incoming.children, node.children);
      }
    }
  };

  graft(bundle.items, items);

  return { items, collisions, added, replaced: 0 };
}
