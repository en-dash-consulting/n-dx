/**
 * Migration v1 → v2: the v1 PRD tree to the product and change layers.
 *
 * Source: {@link v1TreeSource}, a v1 item tree. Rules: classification
 * (`./migration-plan.ts`), capability spec drafts (`./capability-spec.ts`) and
 * per-item data (`./migration-plan-data.ts`), joined into one entry per v1
 * item. Then, in order: the text and Jev passes place the changes the rules
 * hold (`./placement-pass.ts`); the template specs are drafted again from the
 * settled placements; the text pass redrafts them (`./spec-pass.ts`); Jev
 * reviews the plan (`./jev-review-pass.ts`). The caller supplies the seams
 * with `planSeams` (`./seams.ts`). The summary ends with the review queue.
 * Nothing applies the plan yet.
 *
 * @module migrations/v1-to-v2
 */

import type { PRDItem } from "../../schema/v1.js";
import { contentHash, type MigrationSource, type PlanContext, type PlanStage, type SourceItem } from "../migration.js";
import { defineMigration } from "../pipeline.js";
import { draftCapabilitySpecs, type CapabilitySpecDraft, type SpecDraftOptions } from "./capability-spec.js";
import { buildPlanData, stampReview, type ItemPlanData, type PlanData, type PlanDataOptions } from "./migration-plan-data.js";
import { classifyV1Tree, type ClassifyOptions, type MigrationPlan, type PlanEntry } from "./migration-plan.js";
import {
  jevHeldPass,
  jevReviewPass,
  jevReviewSummary,
  reviewQueue,
  withJevArea,
  type JevReviewFields,
  type JevReviewSummary,
  type ReviewQueueItem,
} from "./jev-review-pass.js";
import { placementTextPass, type PlacementFields, type PlacementPassOptions } from "./placement-pass.js";
import { specTextPass } from "./spec-pass.js";

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

export interface V1ToV2Entry extends PlanEntry, PlacementFields, JevReviewFields {
  data?: ItemPlanData;
  spec?: CapabilitySpecDraft;
}

export interface V1ToV2Summary {
  areas: MigrationPlan["areas"];
  constraints: MigrationPlan["constraints"];
  counts: MigrationPlan["counts"];
  flagCounts: PlanData["flagCounts"];
  legacyLoe: PlanData["legacyLoe"];
  corrupt: PlanData["corrupt"];
  /** Held items first, then entries Jev judged by ascending confidence: reviewers start with the weakest calls. */
  reviewQueue: ReviewQueueItem[];
  /** What the Jev review flagged and dropped; absent when Jev reviewed nothing. */
  jevReview?: JevReviewSummary;
}

/** Outside facts the rules read; the caller gathers them, the migration never shells out. */
export type V1ToV2Options = Partial<Pick<SpecDraftOptions, "testFiles" | "codeFiles" | "testCommand" | "minTestScore">> &
  Omit<PlanDataOptions, "cutAt" | "specs"> &
  ClassifyOptions &
  PlacementPassOptions;

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
        counts: plan.counts,
        flagCounts: data.flagCounts,
        legacyLoe: data.legacyLoe,
        corrupt: data.corrupt,
        reviewQueue: [],
      },
    };
  },
  stages,
  summarize(entries, summary) {
    const jevReview = jevReviewSummary(entries);
    return {
      ...summary,
      areas: summary.areas.map((a) => withJevArea(a, Object.hasOwn(entries, a.id) ? entries[a.id] : undefined)),
      reviewQueue: reviewQueue(entries),
      ...(jevReview ? { jevReview } : {}),
    };
  },
});
