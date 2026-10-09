/**
 * Migration plan, seams: which model passes run, and with what.
 *
 * The text seam answers two kinds of question: placement of a held change
 * (`./placement-pass.ts`), when `rex.placement.models` includes the text tier,
 * and a capability spec redraft (`./spec-pass.ts`), whenever a spec drafter
 * is given. Spec drafting is on by default: the caller passes the drafter
 * unless the plan is rules-only. The Jev seam answers placement when
 * `rex.placement.models` includes Jev, and review (`./jev-review-pass.ts`)
 * then or when the `jevReview` option asks for it. Without a TypeSafe key the
 * Jev seam is left out, with one warning.
 *
 * @module migrations/v1-to-v2/seams
 */

import { DEFAULT_PLACEMENT_SETTINGS, type PlacementJudge, type PlacementSettings } from "../../core/placement-policy.js";
import type { PlacementModel } from "../../core/placement.js";
import type { PassSeam } from "../migration.js";
import type { ModelPassName } from "../plan-file.js";
import { askJevBundle, REVIEW_QUESTION_KIND } from "./jev-review-pass.js";
import { PLACEMENT_QUESTION_KIND, PLACEMENT_TIERS, rawTextAnswer, type PlacementSeam } from "./placement-pass.js";
import { isSpecQuestion, SPEC_QUESTION_KIND, type SpecModel } from "./spec-pass.js";

export interface PlanSeamOptions {
  /** `rex.placement`; decides which tiers place changes. */
  settings?: PlacementSettings;
  /** Rules only: no model pass runs, whatever is configured. */
  rulesOnly?: boolean;
  /** The text tier's placement model (see `createTextPlacementModel`). */
  text?: { model: string; place: PlacementModel };
  /** The text tier's spec drafter (see `createTextSpecModel`). Same model as `text`: the pass records one. */
  spec?: { model: string; draft: SpecModel };
  /** The Jev tier, `askJev`-shaped. */
  jev?: { model: string; judge: PlacementJudge };
  /** False without a TypeSafe key; the caller reads env. */
  jevAvailable?: boolean;
  /** Ask Jev to review the plan even when `rex.placement.models` leaves Jev out of placement. */
  jevReview?: boolean;
  /** Receives each warning: today, only that a configured Jev has no key. */
  warn?: (message: string) => void;
}

/**
 * The pipeline seams: a pass gets one only for the question kinds its tier is configured and available for.
 * Each seam records its `placement` settings, which the passes read: `options.placement` need not repeat it.
 */
export function planSeams(options: PlanSeamOptions): Partial<Record<ModelPassName, PassSeam>> {
  if (options.rulesOnly) return {};
  const placement = options.settings ?? DEFAULT_PLACEMENT_SETTINGS;
  const { models } = placement;
  const seams: Partial<Record<ModelPassName, PlacementSeam>> = {};
  const { jev, spec } = options;
  const text = options.text && PLACEMENT_TIERS.text.includes(models) ? options.text : undefined;

  if (text && spec && text.model !== spec.model) {
    throw new Error(`text placement uses ${text.model} and spec drafting ${spec.model}; the text pass records one model`);
  }
  const kinds = [...(text ? [PLACEMENT_QUESTION_KIND] : []), ...(spec ? [SPEC_QUESTION_KIND] : [])];
  const model = text?.model ?? spec?.model;
  if (model !== undefined) {
    seams.text = {
      model,
      placement,
      kinds,
      ask: async (q) => {
        if (isSpecQuestion(q.question)) {
          if (!spec) throw new Error(`text seam asked to draft a spec for ${q.id} without a spec drafter`);
          return spec.draft(q.question);
        }
        if (!text) throw new Error(`text seam asked to place ${q.id} without a text placement model`);
        return rawTextAnswer(q.question, text.place);
      },
    };
  }
  const jevPlaces = PLACEMENT_TIERS.jev.includes(models);
  if (jevPlaces || options.jevReview === true) {
    if (options.jevAvailable === false) {
      options.warn?.("Jev is configured but unavailable (no TYPESAFE_API_KEY): the Jev pass is skipped");
    } else if (jev) {
      seams.jev = {
        model: jev.model,
        placement,
        kinds: [...(jevPlaces ? [PLACEMENT_QUESTION_KIND] : []), REVIEW_QUESTION_KIND],
        ask: (q) => askJevBundle(q.question, jev.judge),
      };
    }
  }
  return seams;
}
