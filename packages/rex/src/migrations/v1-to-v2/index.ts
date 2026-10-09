/**
 * Migration v1 → v2: the v1 PRD tree to the product and change layers.
 *
 * Source: {@link v1TreeSource}, a v1 item tree. Rules: classification
 * (`./migration-plan.ts`), capability spec drafts (`./capability-spec.ts`) and
 * per-item data (`./migration-plan-data.ts`), joined into one entry per v1
 * item. Model passes: the text pass redrafts capability specs
 * (`./spec-pass.ts`) and, with the Jev pass, places the changes the rules hold
 * (`./placement-pass.ts`); the Jev pass also reviews the plan
 * (`./jev-review-pass.ts`). The caller supplies their seams with `planSeams`
 * (`./seams.ts`). The summary ends with the review queue. Nothing applies the
 * plan yet.
 *
 * @module migrations/v1-to-v2
 */

import type { PRDItem } from "../../schema/v1.js";
import { contentHash, type MigrationSource, type SourceItem } from "../migration.js";
import { defineMigration } from "../pipeline.js";
import { draftCapabilitySpecs, type CapabilitySpecDraft, type SpecDraftOptions } from "./capability-spec.js";
import { buildPlanData, type ItemPlanData, type PlanData, type PlanDataOptions } from "./migration-plan-data.js";
import { classifyV1Tree, type ClassifyOptions, type MigrationPlan, type PlanEntry } from "./migration-plan.js";
import {
  jevPass,
  jevReviewSummary,
  reviewQueue,
  withJevArea,
  type JevReviewFields,
  type JevReviewSummary,
  type ReviewQueueItem,
} from "./jev-review-pass.js";
import { placementTextPass, type PlacementFields, type PlacementPassOptions } from "./placement-pass.js";
import { isSpecQuestion, specTextPass } from "./spec-pass.js";
import type { ModelPass } from "../migration.js";

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
 * The text pass asks both kinds of question: placement of held changes and
 * spec redrafts of capabilities. The two never ask about the same item. Spec
 * questions come from the rules' placements; a change the text pass places
 * joins the capability's history on the next plan, not this one.
 */
const textPass: ModelPass<readonly PRDItem[], V1ToV2Entry, V1ToV2Options> = {
  questions: (entries, items, context) => [
    ...placementTextPass.questions(entries, items, context),
    ...specTextPass.questions(entries, items, context),
  ],
  merge: (entry, answer, at) =>
    isSpecQuestion(at.question) ? specTextPass.merge(entry, answer, at) : placementTextPass.merge(entry, answer, at),
};

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
  passes: { text: textPass, jev: jevPass },
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
