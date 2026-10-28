/**
 * Migration v1 → v2: the v1 PRD tree to the product and change layers.
 *
 * Source: {@link v1TreeSource}, a v1 item tree. Rules: classification
 * (`./migration-plan.ts`), capability spec drafts (`./capability-spec.ts`) and
 * per-item data (`./migration-plan-data.ts`), joined into one entry per v1
 * item. Then, in order: the text and Jev passes place the changes the rules
 * hold (`./placement-pass.ts`); the template specs are drafted again from the
 * settled placements; the text pass redrafts them (`./spec-pass.ts`); Jev
 * reviews the plan (`./jev-review-pass.ts`); last, each capability is proposed
 * a `dependsOn` on every earlier capability it shares a linked test file with
 * ({@link proposeDependsOn}). The caller supplies the seams
 * with `planSeams` (`./seams.ts`). The summary ends with the review queue.
 * `./apply.ts` applies a reviewed plan (`rex migrate-apply`).
 *
 * @module migrations/v1-to-v2
 */

import type { PRDItem } from "../../schema/v1.js";
import { contentHash, type MigrationSource, type PlanContext, type PlanStage, type SourceItem } from "../migration.js";
import { defineMigration, sourceDigest } from "../pipeline.js";
import { draftCapabilitySpecs, type CapabilitySpecDraft, type SpecDraftOptions } from "./capability-spec.js";
import { buildPlanData, stampReview, type ItemPlanData, type PlanData, type PlanDataOptions } from "./migration-plan-data.js";
import { classifyV1Tree, type ClassifyOptions, type MigrationPlan, type PlanEntry } from "./migration-plan.js";
import {
  jevHeldPass,
  flagThresholdOf,
  jevReviewPass,
  jevReviewSummary,
  reviewQueue,
  withJevArea,
  type JevReviewFields,
  type JevReviewOptions,
  type JevReviewSummary,
  type ReviewQueueItem,
} from "./jev-review-pass.js";
import { placementTextPass, type PlacementFields, type PlacementPassOptions } from "./placement-pass.js";
import { specTextPass } from "./spec-pass.js";
import { sharedFilePairs } from "../../core/product-edges.js";

// Re-exported so the CLI reaches the digest and its hash through this module.
export { contentHash, sourceDigest };

export const V1_TREE_SOURCE_KIND = "rex-v1-tree";

/** A v1 item's content without its children; with its parent, so a moved item counts as changed. */
function itemContent(item: PRDItem, parent: string | undefined): unknown {
  const { children: _children, ...own } = item;
  return { parent: parent ?? null, item: own };
}

function sourceItems(items: readonly PRDItem[], parent: string | undefined, out: SourceItem[]): SourceItem[] {
  for (const item of items) {
    out.push({ id: item.id, hash: contentHash(itemContent(item, parent)) });
    sourceItems(item.children ?? [], item.id, out);
  }
  return out;
}

/** A v1 item tree as a migration source. Items are listed depth first. */
export function v1TreeSource(items: readonly PRDItem[]): MigrationSource<readonly PRDItem[]> {
  return { kind: V1_TREE_SOURCE_KIND, read: () => ({ data: items, items: sourceItems(items, undefined, []) }) };
}

/** A `dependsOn` the plan proposes for review, and why. */
export interface ProposedDependency {
  /** v1 id of the capability depended on. */
  capability: string;
  /** Test files both capabilities' specs link, sorted. */
  tests: string[];
}

export interface V1ToV2Entry extends PlanEntry, PlacementFields, JevReviewFields {
  data?: ItemPlanData;
  spec?: CapabilitySpecDraft;
  /** Capabilities only: proposed `dependsOn`, one per earlier capability it shares a linked test with. Absent when it shares none. */
  dependsOn?: ProposedDependency[];
}

/** A release epic that dissolved into its changes' `plannedRelease`; its id aliases no child. */
export interface DissolvedRelease {
  id: string;
  title: string;
  plannedRelease?: string;
}

export interface V1ToV2Summary {
  areas: MigrationPlan["areas"];
  constraints: MigrationPlan["constraints"];
  /** Each dissolved release epic, so a lookup of its old id can say what it was. */
  dissolvedReleases: DissolvedRelease[];
  counts: MigrationPlan["counts"];
  flagCounts: PlanData["flagCounts"];
  legacyLoe: PlanData["legacyLoe"];
  corrupt: PlanData["corrupt"];
  /**
   * Where the capability code evidence came from, and when.
   *
   * A stale analysis reads exactly like a fresh one — every file parses,
   * every zone has files — so a reader of the plan (or the cut-day apply)
   * has no way to judge the specs without this. Absent when nothing was read.
   */
  codeEvidence?: {
    /** Items the evidence covered. */
    items: number;
    /** ISO timestamp the analysis recorded, when it recorded one. */
    analyzedAt?: string;
    /** Commit the analysis was taken at, when it recorded one. */
    gitSha?: string;
    /** True when `gitSha` is neither HEAD nor an ancestor: the evidence is off this history. */
    offHistory?: boolean;
  };
  /**
   * Hash of the code evidence the plan read, empty evidence included. The
   * source digest covers PRD items only, so a re-analysis changes this alone;
   * a re-plan compares it before reusing the earlier cut time.
   */
  evidenceDigest?: string;
  /** Held items first, then entries Jev judged by ascending confidence: reviewers start with the weakest calls. */
  reviewQueue: ReviewQueueItem[];
  /** What the Jev review flagged and dropped; absent when Jev reviewed nothing. */
  jevReview?: JevReviewSummary;
}

/** Outside facts the rules read; the caller gathers them, the migration never shells out. */
export type V1ToV2Options = Partial<Pick<SpecDraftOptions, "testFiles" | "codeFiles" | "testCommand" | "minTestScore">> &
  Omit<PlanDataOptions, "cutAt" | "specs"> &
  ClassifyOptions &
  PlacementPassOptions &
  JevReviewOptions;

/**
 * The template specs again, from the placements every stage so far settled:
 * an applied change a model pass placed joins its capability's history like
 * one the rules placed. Review is re-checked against each draft.
 */
function draftSettledSpecs(
  entries: Readonly<Record<string, V1ToV2Entry>>,
  items: readonly PRDItem[],
  context: PlanContext<V1ToV2Options>,
): Record<string, V1ToV2Entry> {
  const { testFiles = [], codeFiles, testCommand, minTestScore } = context.options ?? {};
  const specs = draftCapabilitySpecs({ entries: Object.values(entries) }, items, { testFiles, codeFiles, testCommand, minTestScore });
  const out = { ...entries };
  for (const spec of specs) {
    const entry = out[spec.capability]!;
    out[spec.capability] = { ...entry, spec, ...(entry.data ? { data: stampReview(entry.data, spec) } : {}) };
  }
  return out;
}

/**
 * Propose `dependsOn` where two capabilities' settled specs link a test file
 * in common: a shared test exercises both, so a change to one can break the
 * other. Shared tests are symmetric and `dependsOn` is not, so the capability
 * later in plan order depends on the earlier one; every edge points back in
 * plan order, so the proposals cannot form a cycle. A proposal for review: the
 * apply does not write it. Re-derived from scratch on every run.
 */
export function proposeDependsOn(entries: Readonly<Record<string, V1ToV2Entry>>): Record<string, V1ToV2Entry> {
  const out: Record<string, V1ToV2Entry> = {};
  for (const [id, entry] of Object.entries(entries)) {
    const { dependsOn: _stale, ...rest } = entry;
    out[id] = rest;
  }
  const tests = new Map(
    Object.values(out)
      .filter((e) => e.target === "capability" && e.spec !== undefined)
      .map((e) => [e.id, e.spec!.tests] as const),
  );
  for (const { a, b, files } of sharedFilePairs(tests)) {
    const entry = out[b]!;
    out[b] = { ...entry, dependsOn: [...(entry.dependsOn ?? []), { capability: a, tests: files }] };
  }
  return out;
}

/**
 * Placement settles first, the text pass's then Jev's, so a spec is drafted
 * from every applied change placed on its capability; then the text pass
 * redrafts the specs and Jev reviews them. Each model's stages ask about
 * disjoint items: text places held changes and redrafts capabilities; Jev
 * judges held changes, then areas and capabilities.
 */
const stages: readonly PlanStage<readonly PRDItem[], V1ToV2Entry, V1ToV2Options>[] = [
  { model: "text", ...placementTextPass },
  { model: "jev", ...jevHeldPass },
  { derive: draftSettledSpecs },
  { model: "text", ...specTextPass },
  { model: "jev", ...jevReviewPass },
  { derive: proposeDependsOn },
];

export const v1ToV2 = defineMigration<readonly PRDItem[], V1ToV2Entry, V1ToV2Summary, V1ToV2Options>({
  id: "v1-to-v2",
  from: "v1",
  to: "v2",
  rules(items, { cutAt, options = {} }) {
    const { testFiles = [], codeFiles, testCommand, minTestScore, reviewed, releases, prMerges, productNames } = options;
    const plan = classifyV1Tree(items, { productNames });
    const specs = draftCapabilitySpecs(plan, items, { testFiles, codeFiles, testCommand, minTestScore });
    const data = buildPlanData(items, plan, { cutAt, specs, reviewed, releases, prMerges });
    const specById = new Map(specs.map((s) => [s.capability, s]));

    const entries: Record<string, V1ToV2Entry> = {};
    for (const entry of plan.entries) {
      const itemData = data.items[entry.id];
      const spec = specById.get(entry.id);
      entries[entry.id] = { ...entry, ...(itemData ? { data: itemData } : {}), ...(spec ? { spec } : {}) };
    }
    return {
      entries,
      summary: {
        areas: plan.areas,
        constraints: plan.constraints,
        dissolvedReleases: plan.entries
          .filter((e) => e.target === "release")
          .map((e) => ({ id: e.id, title: e.title, ...(e.plannedRelease !== undefined ? { plannedRelease: e.plannedRelease } : {}) })),
        counts: plan.counts,
        flagCounts: data.flagCounts,
        legacyLoe: data.legacyLoe,
        corrupt: data.corrupt,
        reviewQueue: [],
      },
    };
  },
  stages,
  summarize(entries, summary, context) {
    const threshold = flagThresholdOf(context.options);
    const jevReview = jevReviewSummary(entries, threshold);
    return {
      ...summary,
      areas: summary.areas.map((a) => withJevArea(a, Object.hasOwn(entries, a.id) ? entries[a.id] : undefined, threshold)),
      reviewQueue: reviewQueue(entries, threshold),
      ...(jevReview ? { jevReview } : {}),
    };
  },
});
