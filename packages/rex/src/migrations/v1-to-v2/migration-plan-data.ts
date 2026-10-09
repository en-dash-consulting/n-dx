/**
 * Migration plan, data: ids, aliases, backfill and data fixes.
 *
 * Pure and deterministic like {@link classifyV1Tree}: reads the v1 tree and
 * the plan, writes nothing, and keys everything by v1 item id so the result
 * can be re-applied to a newer tree. Callers supply the outside facts (release
 * tags, PR merges); this module never shells out.
 *
 * - Criterion ids `c1…cn` in source order, from `acceptanceCriteria`. Not for a
 *   capability: its statement and criteria come only from its draft
 *   (`draftCapabilitySpecs`), the source `reviewedHash` is hashed from, so the
 *   plan never holds a second, differently worded list for it.
 * - Aliases: a release umbrella dissolves, so its id is aliased to its first
 *   child change and old references still resolve.
 * - `shippedIn` for completed items: a PR merge's release wins; otherwise the
 *   first release tagged at or after `completedAt`.
 * - Flags, one per problem class: criteria kept in tags, duplicate sibling
 *   titles, a legacy `parentId` field, a stale description.
 * - Legacy `loe` buckets (`xs|s|m|l|xl`): no numeric loe, the bucket kept as
 *   text at the start of `loeRationale`. Buckets are never mapped to weeks.
 * - `appliedAt` on each change the plan marks applied (completed in v1): its
 *   `completedAt`, else the plan's cut time. Without it the change would read
 *   as changing forever. `appliedIn` and `specReviewed` are retired and never
 *   written.
 * - `reviewedHash` on each capability the caller lists as reviewed, only while
 *   its drafted spec's `specHash` is the hash the reviewer approved
 *   (`stampReview`). A draft that changed since approval stays unreviewed, with
 *   a `reviewNote` naming both hashes, and joins the review queue. Unlisted
 *   nodes stay unreviewed.
 * - `slug` on each item whose v1 directory name cannot be frozen in v2 (a title
 *   of "Con", "AUX" or "Nul", which Windows cannot create, or "Index", which is
 *   its folder's index.md once the item is a leaf): v2 freezes slugs and the
 *   writer refuses such a name, so the plan assigns a replacement (`con-<id6>`, from
 *   `freeSlug`), records the v1 name in `slug.from`, and flags `unsafe-slug`.
 *   Safe names are not listed: the v1 name is the v2 slug. A name that clashes
 *   (ignoring case) with another item's in its v2 sibling set (`planSlugs`) is
 *   replaced the same way and flagged `slug-clash`.
 * - The literal "[object Object]" in `recommendationMeta` or an item's `log`
 *   (written by a pre-squash build; unrecoverable) is dropped and counted.
 *
 * @module migrations/v1-to-v2/migration-plan-data
 */

import type { PRDItem } from "../../schema/v1.js";
import type { Criterion } from "../../schema/v2.js";
import { specHash } from "../../schema/v2-rules.js";
import type { CapabilitySpecDraft } from "./capability-spec.js";
import type { MigrationPlan } from "./migration-plan.js";
import { freeSlug } from "../../core/apply-amendments.js";
import { isUsableFrozenSlug, resolveSiblingSlugs } from "../../store/folder-tree-serializer.js";

export const CORRUPT_VALUE = "[object Object]";

export const DATA_FLAGS = ["criteria-in-tags", "duplicate-title", "legacy-parent-id", "slug-clash", "stale-description", "unsafe-slug"] as const;
export type DataFlag = (typeof DATA_FLAGS)[number];

export interface ReleaseTag {
  version: string;
  /** ISO date the tag was created. */
  date: string;
}

/** A capability a reviewer approved: its v1 id and the `specHash` of the draft they read. */
export interface ReviewedSpec {
  id: string;
  hash: string;
}

export interface PlanDataOptions {
  /** ISO time the plan is cut: the `appliedAt` of an applied change with no `completedAt`. Required, so the plan stays deterministic. */
  cutAt: string;
  /** Drafted specs (`draftCapabilitySpecs`), the source of each `reviewedHash`. */
  specs?: readonly CapabilitySpecDraft[];
  /** Capabilities a reviewer approved, each with the `specHash` they approved. An id with no draft in `specs` gets no hash. */
  reviewed?: readonly ReviewedSpec[];
  /** Release tags; order does not matter. */
  releases?: readonly ReleaseTag[];
  /** Release version of the merged PR that delivered an item (v1 id): beats the tag backfill. */
  prMerges?: Readonly<Record<string, string>>;
}

export interface LegacyLoe {
  /** The bucket as written (`xl`). */
  bucket: string;
  /** `loeRationale` after conversion: begins with `Legacy estimate: <bucket>`. */
  loeRationale: string;
}

export interface ItemPlanData {
  /** v1 id. */
  id: string;
  /** From `acceptanceCriteria`; never set for a capability, whose spec is its draft. */
  criteria?: Criterion[];
  aliases?: string[];
  /** Present when the v1 directory name (`from`) cannot be frozen (`isUsableFrozenSlug`): the v2 slug to freeze instead (`to`). */
  slug?: { from: string; to: string };
  /** Applied changes only: ISO time the change counts as applied. */
  appliedAt?: string;
  /** Listed capabilities only: the `specHash` the reviewer approved. Plan-only; never written to v2. */
  approvedHash?: string;
  /** Set only while the migrated spec's `specHash` is `approvedHash`. */
  reviewedHash?: string;
  /** Set when the migrated spec is not the one approved: names the approved and current hashes. */
  reviewNote?: string;
  shippedIn?: { version: string; source: "pr-merge" | "release-tag" };
  flags: DataFlag[];
  /** Present when `loe` was a legacy bucket: drop the numeric loe, set this rationale. */
  legacyLoe?: LegacyLoe;
  /** `recommendationMeta` values dropped at conversion. */
  droppedMeta: number;
  /** Values in the item's own `log` dropped at conversion. */
  droppedLog: number;
}

export interface PlanData {
  /** Keyed by v1 item id; only items with something to say. */
  items: Record<string, ItemPlanData>;
  /** Items per flag. */
  flagCounts: Record<DataFlag, number>;
  legacyLoe: number;
  /** Corrupt values dropped, by field: `recommendationMeta`, and item `log` entries. */
  corrupt: { recommendationMeta: number; logEntries: number };
}

// ── Item rules ───────────────────────────────────────────────────

const LEGACY_BUCKETS = new Set(["xs", "s", "m", "l", "xl"]);
const CRITERIA_TAG = /^(?:ac|criteria|criterion|acceptance)[:\s-]/i;
const STALE_DESCRIPTION = /\b(?:todo|tbd|will be (?:added|implemented|built)|to be (?:added|implemented|built)|not yet|yet to)\b/i;
const MIN_PROSE_TAG = 40;

/** The bucket when `loe` is a legacy `xs|s|m|l|xl` string, else undefined. */
export function legacyLoeBucket(item: PRDItem): string | undefined {
  const loe = item.loe;
  if (typeof loe !== "string") return undefined;
  const bucket = loe.trim().toLowerCase();
  return LEGACY_BUCKETS.has(bucket) ? bucket : undefined;
}

/** `loeRationale` for an item whose `loe` was a legacy bucket; the existing rationale follows the prefix. */
export function legacyLoeRationale(bucket: string, rationale: unknown): string {
  const prefix = `Legacy estimate: ${bucket}`;
  return typeof rationale === "string" && rationale.trim() !== "" ? `${prefix}. ${rationale}` : prefix;
}

/** Criteria sit in tags: a tag that is a sentence or an `ac:` / `criteria:` entry. */
function criteriaInTags(item: PRDItem): boolean {
  return (item.tags ?? []).some((t) => CRITERIA_TAG.test(t) || (/\s/.test(t) && t.length >= MIN_PROSE_TAG));
}

function staleDescription(item: PRDItem): boolean {
  const done = item.status === "completed" || item.status === "cancelled" || item.status === "deleted";
  return done && item.description !== undefined && STALE_DESCRIPTION.test(item.description);
}

/** Count `[object Object]` strings in a value: the value itself, or any string within an object or array. */
export function countCorrupt(value: unknown): number {
  if (value === CORRUPT_VALUE) return 1;
  if (Array.isArray(value)) return value.reduce<number>((n, v) => n + countCorrupt(v), 0);
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).reduce<number>((n, v) => n + countCorrupt(v), 0);
  }
  return 0;
}

/** Remove every `[object Object]` value, and the keys that held it. Returns the value, or undefined when it was itself corrupt. */
export function dropCorrupt<T>(value: T): T | undefined {
  if ((value as unknown) === CORRUPT_VALUE) return undefined;
  if (Array.isArray(value)) return value.filter((v) => v !== CORRUPT_VALUE).map((v) => dropCorrupt(v)) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const cleaned = dropCorrupt(v);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out as T;
  }
  return value;
}

/** The first release tagged at or after `completedAt`. */
function firstReleaseAfter(completedAt: string, releases: readonly ReleaseTag[]): string | undefined {
  const done = Date.parse(completedAt);
  if (Number.isNaN(done)) return undefined;
  let best: { version: string; at: number } | undefined;
  for (const r of releases) {
    const at = Date.parse(r.date);
    if (Number.isNaN(at) || at < done) continue;
    if (best === undefined || at < best.at) best = { version: r.version, at };
  }
  return best?.version;
}

// ── Slugs ────────────────────────────────────────────────────────

const PRODUCT_TARGETS = new Set<string>(["area", "capability", "constraint"]);

interface FrozenSlug {
  slug: { from: string; to: string };
  flag: "slug-clash" | "unsafe-slug";
}

/**
 * The slug each item freezes when it is not its v1 directory name. v1 names are
 * unique among v1 siblings only, but v2 reparents (a release umbrella's children
 * become root changes, deep items become subtasks), so every slug is resolved
 * against its v2 sibling set: same layer (product or changes), same plan parent.
 * In tree order the first holder keeps a name; a later item that clashes
 * (ignoring case) or cannot be frozen gets `freeSlug`'s `-<id6>` form.
 */
function planSlugs(items: readonly PRDItem[], plan: MigrationPlan): Map<string, FrozenSlug> {
  const v1Slugs = new Map<string, string>();
  const collect = (list: readonly PRDItem[]): void => {
    for (const [id, slug] of resolveSiblingSlugs([...list])) v1Slugs.set(id, slug);
    for (const item of list) collect(item.children ?? []);
  };
  collect(items);

  const taken = new Map<string, { slug: string }[]>();
  const out = new Map<string, FrozenSlug>();
  for (const entry of plan.entries) {
    const from = v1Slugs.get(entry.id);
    if (entry.target === "release" || from === undefined) continue;
    const key = `${PRODUCT_TARGETS.has(entry.target) ? "product" : "changes"}:${entry.parent ?? ""}`;
    const siblings = taken.get(key) ?? [];
    taken.set(key, siblings);
    const usable = isUsableFrozenSlug(from);
    const clash = siblings.some((s) => s.slug.toLowerCase() === from.toLowerCase());
    if (usable && !clash) {
      siblings.push({ slug: from });
      continue;
    }
    const to = freeSlug(entry.title, entry.id, [...siblings, { slug: from }]);
    siblings.push({ slug: to });
    out.set(entry.id, { slug: { from, to }, flag: usable ? "slug-clash" : "unsafe-slug" });
  }
  return out;
}

// ── Review ───────────────────────────────────────────────────────

/**
 * `data` with review re-checked against `spec`, the capability's current draft:
 * `reviewedHash` when its `specHash` is `approvedHash`, else a `reviewNote`
 * naming both. Every pass that changes the draft calls this. Data with no
 * `approvedHash` is returned as is.
 */
export function stampReview(data: ItemPlanData, spec: { statement?: string; criteria?: Criterion[] }): ItemPlanData {
  const { approvedHash } = data;
  if (approvedHash === undefined) return data;
  const { reviewedHash: _reviewed, reviewNote: _note, ...rest } = data;
  const current = specHash(spec);
  if (current === approvedHash) return { ...rest, reviewedHash: current };
  return { ...rest, reviewNote: `the draft changed since review: approved ${approvedHash}, current ${current}; review it again` };
}

// ── Build ────────────────────────────────────────────────────────

/** Data for every item in the tree. Same tree, plan and options always give the same result. */
export function buildPlanData(items: readonly PRDItem[], plan: MigrationPlan, options: PlanDataOptions): PlanData {
  const { cutAt, releases = [], prMerges = {} } = options;
  const approved = new Map((options.reviewed ?? []).map((r) => [r.id, r.hash]));
  const specById = new Map((options.specs ?? []).map((d) => [d.capability, d]));
  const result: PlanData = {
    items: {},
    flagCounts: { "criteria-in-tags": 0, "duplicate-title": 0, "legacy-parent-id": 0, "slug-clash": 0, "stale-description": 0, "unsafe-slug": 0 },
    legacyLoe: 0,
    corrupt: { recommendationMeta: 0, logEntries: 0 },
  };
  const entryById = new Map(plan.entries.map((e) => [e.id, e]));
  const slugs = planSlugs(items, plan);

  const visit = (list: readonly PRDItem[]): void => {
    const titles = new Map<string, number>();
    for (const item of list) {
      const key = item.title.trim().toLowerCase();
      titles.set(key, (titles.get(key) ?? 0) + 1);
    }
    for (const item of list) {
      const data: ItemPlanData = { id: item.id, flags: [], droppedMeta: 0, droppedLog: 0 };

      const frozen = slugs.get(item.id);
      if (frozen) {
        data.slug = frozen.slug;
        data.flags.push(frozen.flag);
      }

      const entry = entryById.get(item.id);
      // A capability's spec comes only from its draft, the source of reviewedHash.
      if (item.acceptanceCriteria?.length && entry?.target !== "capability") {
        data.criteria = item.acceptanceCriteria.map((text, i) => ({ id: `c${i + 1}`, text }));
      }

      if (entry?.target === "release") {
        const first = item.children?.[0];
        if (first) {
          const host = result.items[first.id] ?? { id: first.id, flags: [], droppedMeta: 0, droppedLog: 0 };
          host.aliases = [...(host.aliases ?? []), item.id];
          result.items[first.id] = host;
        }
      }

      if (item.status === "completed" && item.completedAt !== undefined) {
        const merged = prMerges[item.id];
        const tagged = firstReleaseAfter(item.completedAt, releases);
        if (merged !== undefined) data.shippedIn = { version: merged, source: "pr-merge" };
        else if (tagged !== undefined) data.shippedIn = { version: tagged, source: "release-tag" };
      } else if (item.status === "completed" && prMerges[item.id] !== undefined) {
        data.shippedIn = { version: prMerges[item.id]!, source: "pr-merge" };
      }

      if (entry?.target === "change" && entry.applied) {
        // An empty or unparsable completedAt would leave the change reading as changing.
        const done = item.completedAt;
        data.appliedAt = done !== undefined && !Number.isNaN(Date.parse(done)) ? done : cutAt;
      }
      const draft = specById.get(item.id);
      const approvedHash = approved.get(item.id);
      if (entry?.target === "capability" && approvedHash !== undefined && draft) {
        Object.assign(data, stampReview({ ...data, approvedHash }, draft));
      }

      if (criteriaInTags(item)) data.flags.push("criteria-in-tags");
      if ((titles.get(item.title.trim().toLowerCase()) ?? 0) > 1) data.flags.push("duplicate-title");
      if ("parentId" in item) data.flags.push("legacy-parent-id");
      if (staleDescription(item)) data.flags.push("stale-description");

      const bucket = legacyLoeBucket(item);
      if (bucket !== undefined) {
        data.legacyLoe = { bucket, loeRationale: legacyLoeRationale(bucket, item.loeRationale) };
        result.legacyLoe += 1;
      }

      data.droppedMeta = countCorrupt(item.recommendationMeta);
      result.corrupt.recommendationMeta += data.droppedMeta;
      data.droppedLog = countCorrupt(item.log);
      result.corrupt.logEntries += data.droppedLog;
      for (const flag of data.flags) result.flagCounts[flag] += 1;

      const existing = result.items[item.id];
      const merged = existing ? { ...data, aliases: existing.aliases } : data;
      const interesting =
        merged.slug ||
        merged.criteria || merged.aliases || merged.appliedAt || merged.approvedHash || merged.shippedIn || merged.flags.length || merged.legacyLoe || merged.droppedMeta || merged.droppedLog;
      if (interesting) result.items[item.id] = merged;
      else delete result.items[item.id];

      visit(item.children ?? []);
    }
  };
  visit(items);
  return result;
}
