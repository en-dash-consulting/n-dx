/**
 * No rex prompt states the same instruction twice, or two instructions that
 * disagree.
 *
 * Sixteen builders share six prompt constants between them, and each builder
 * also writes sections of its own. Nothing stopped a rule from being written
 * into a shared constant *and* restated in a builder's own text, or from two
 * constants giving the model different answers to the same question — and both
 * had happened by the time these tests were written:
 *
 * - `TASK_QUALITY_RULES` sized a task at "one focused session (1-4 hours)"
 *   while `CONSOLIDATION_INSTRUCTION` sized it at "a single focused sprint
 *   (roughly 0.5–4 engineer-weeks)". Four builders included both. The hours
 *   figure was the outlier: `PRD_SCHEMA` asks for `loe` *in engineer-weeks*,
 *   `FEW_SHOT_EXAMPLE` shows `loe: 2` and `loe: 1.5`, and decomposition splits
 *   any task over `taskThresholdWeeks: 2`. A model told both was being asked
 *   for week-scale estimates of hour-scale tasks.
 * - The `existingId` placement rule was spelled out in `PRD_SCHEMA` and again
 *   in `AUTO_PLACEMENT_INSTRUCTION`; three builders carried both.
 * - "do not duplicate what is already in the PRD" appeared in both the dedup
 *   section and `ANTI_PATTERNS`; two builders carried both.
 *
 * Repetition is not free — it is billed on every call, by every builder that
 * includes it — and a contradiction is worse than either instruction alone.
 *
 * These assertions are deliberately about *meaning* rather than byte equality:
 * a paraphrase costs the same and confuses more. Each is pinned to a distinct
 * marker so a reintroduction fails with the rule that was broken, not a
 * similarity score.
 *
 * @see packages/rex/src/analyze/analyze-shared.ts — PRD_SCHEMA, TASK_QUALITY_RULES
 * @see packages/rex/src/analyze/reason.ts — ANTI_PATTERNS, CONSOLIDATION_INSTRUCTION
 */

import { describe, it, expect } from "vitest";

import { rexPrompt } from "../../../src/analyze/prompt-envelope.js";
import { REX_PROMPT_SURFACES } from "./__fixtures__/prompt-surfaces.js";

/** Every surface as the single string the model receives. */
const ASSEMBLED = REX_PROMPT_SURFACES.map((s) => ({
  name: s.name,
  text: rexPrompt(s.envelope, { separator: s.separator }),
}));

/** Count non-overlapping matches of `re` in `text`. */
function countMatches(text: string, re: RegExp): number {
  return [...text.matchAll(new RegExp(re.source, `${re.flags.replace("g", "")}g`))].length;
}

describe("no rex prompt contradicts itself", () => {
  it.each(ASSEMBLED.map((a) => [a.name, a.text] as const))(
    "%s states task size in one unit, not both hours and weeks",
    (_name, text) => {
      // The system measures effort in engineer-weeks everywhere else — the
      // `loe` field, the few-shot values, the decomposition threshold. An
      // hour-scale task budget in the same prompt asks for two different
      // things at once.
      const hourScale = /completable in one focused session|\(1-4 hours\)|\b1-4 hours\b/i.test(text);
      const weekScale = /engineer-weeks|focused sprint/i.test(text);

      expect(
        hourScale && weekScale,
        "prompt sizes a task in hours AND in engineer-weeks; the schema, the " +
          "few-shot example and the decomposition threshold all use weeks",
      ).toBe(false);
    },
  );

  it("no prompt sizes a task in hours at all", () => {
    // Stronger than the pairwise check above: even alone, an hours budget
    // disagrees with the `loe` units the same prompt asks the model to fill in.
    const offenders = ASSEMBLED.filter((a) =>
      /completable in one focused session|\b1-4 hours\b/i.test(a.text),
    ).map((a) => a.name);

    expect(offenders).toEqual([]);
  });
});

describe("no rex prompt repeats an instruction it already gave", () => {
  it.each(ASSEMBLED.map((a) => [a.name, a.text] as const))(
    "%s explains the existingId placement rule at most once",
    (_name, text) => {
      // Both PRD_SCHEMA and AUTO_PLACEMENT_INSTRUCTION used to teach this.
      // Matches the *explanation*, not the bare field name — the schema line
      // that merely declares `"existingId"?: string` is not an explanation.
      const explanations = countMatches(
        text,
        /existingId[^\n]{0,120}(reference|place new items|belong under)/gi,
      );
      expect(explanations).toBeLessThanOrEqual(1);
    },
  );

  it.each(ASSEMBLED.map((a) => [a.name, a.text] as const))(
    "%s forbids duplicating existing PRD items at most once",
    (_name, text) => {
      const rules = countMatches(text, /duplicat\w*[^\n]{0,80}existing PRD/gi);
      expect(rules).toBeLessThanOrEqual(1);
    },
  );

  it.each(ASSEMBLED.map((a) => [a.name, a.text] as const))(
    "%s forbids markdown fences at most once",
    (_name, text) => {
      // OUTPUT_INSTRUCTION already says "no markdown fences"; ANTI_PATTERNS
      // said it again.
      const rules = countMatches(text, /markdown fences?/gi);
      expect(rules).toBeLessThanOrEqual(1);
    },
  );

  it.each(ASSEMBLED.map((a) => [a.name, a.text] as const))(
    "%s requires description + acceptanceCriteria at most once",
    (_name, text) => {
      const rules = countMatches(
        text,
        /(description AND acceptanceCriteria|only a title and no description)/gi,
      );
      expect(rules).toBeLessThanOrEqual(1);
    },
  );

  it.each(ASSEMBLED.map((a) => [a.name, a.text] as const))(
    "%s demands specific, verb-first titles at most once",
    (_name, text) => {
      const rules = countMatches(text, /(verb-first|vague titles like)/gi);
      expect(rules).toBeLessThanOrEqual(1);
    },
  );
});
