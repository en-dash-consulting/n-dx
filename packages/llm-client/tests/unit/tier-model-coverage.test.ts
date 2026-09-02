/**
 * Every model the tier catalog can hand out must be priced and sized.
 *
 * ## The drift this catches
 *
 * Bumping a tier constant to a newer model is an edit this repository has
 * already made twice — `claude-opus-4-7` → `claude-opus-5`, and `gpt-5.5` →
 * `gpt-5.6-terra`. Nothing forced the matching `MODEL_COSTS` and
 * `MODEL_CONTEXT_WINDOWS` entries to be added alongside, and nothing failed
 * when they were missing.
 *
 * The consequence is quiet rather than loud. `budgetPreflight` falls back to
 * `DEFAULT_CONTEXT_WINDOW` (128K) for an unlisted model, so a 200K-token
 * prompt bound for a 1M-context model is reported as not fitting and rejected
 * as too large; `estimatedCostUsd` becomes undefined, so cost estimation stops
 * without saying so. The whole suite stays green throughout.
 *
 * ## Why this is a test and not a runtime guard
 *
 * `llm.tiers.<vendor>.<tier>` lets a project point a tier at any model id it
 * likes, including one this catalog has never heard of. Those must keep
 * working, so the runtime fallbacks are correct behaviour rather than a bug.
 * What needs enforcing is the *built-in* catalog, which is exactly what a test
 * can enforce and a runtime check cannot.
 *
 * Modelled on the equivalent guard for `REVIEW_MODELS`
 * (`review-model.test.ts`), which had it while the tier catalog did not.
 */

import { describe, it, expect } from "vitest";
import {
  TIER_MODELS,
  GOOGLE_MODELS,
  MODEL_COSTS,
  MODEL_CONTEXT_WINDOWS,
} from "../../src/config.js";

/**
 * The coverage predicate, extracted so the same rule can be pointed at a
 * synthetic catalog below and shown to reject drift.
 */
function findCoverageGaps(
  catalog: Record<string, Record<string, string>>,
): string[] {
  const gaps: string[] = [];
  for (const [vendor, tiers] of Object.entries(catalog)) {
    for (const [tier, model] of Object.entries(tiers)) {
      // The local vendor deliberately carries empty strings: LM Studio serves
      // whichever model is loaded, so there is no id to price.
      if (!model) continue;
      if (MODEL_COSTS[model] === undefined) {
        gaps.push(`${vendor}.${tier} → ${model} missing from MODEL_COSTS`);
      }
      if (MODEL_CONTEXT_WINDOWS[model] === undefined) {
        gaps.push(`${vendor}.${tier} → ${model} missing from MODEL_CONTEXT_WINDOWS`);
      }
    }
  }
  return gaps;
}

describe("TIER_MODELS catalog coverage", () => {
  it("prices and sizes every model any tier can resolve to", () => {
    expect(findCoverageGaps(TIER_MODELS as unknown as Record<string, Record<string, string>>)).toEqual([]);
  });

  it("names the vendor, tier, and model when an entry is uncovered", () => {
    // A failure message that only said "missing" would send the next person
    // hunting through three constants to find which pair broke.
    const gaps = findCoverageGaps({ claude: { heavy: "claude-opus-6-unreleased" } });

    expect(gaps).toHaveLength(2);
    expect(gaps[0]).toContain("claude.heavy");
    expect(gaps[0]).toContain("claude-opus-6-unreleased");
    expect(gaps[0]).toContain("MODEL_COSTS");
    expect(gaps[1]).toContain("MODEL_CONTEXT_WINDOWS");
  });

  it("would catch the exact drift this repository has performed twice", () => {
    // Standing in for a temporary edit to TIER_MODELS: pointing a tier at a
    // model that was never added to the cost tables.
    const drifted = {
      claude: { light: TIER_MODELS.claude.light, standard: TIER_MODELS.claude.standard, heavy: "claude-opus-6" },
      codex: { light: "gpt-6-unlisted", standard: TIER_MODELS.codex.standard, heavy: TIER_MODELS.codex.heavy },
    };

    const gaps = findCoverageGaps(drifted);
    expect(gaps.some((g) => g.includes("claude-opus-6"))).toBe(true);
    expect(gaps.some((g) => g.includes("gpt-6-unlisted"))).toBe(true);
    // The untouched entries stay covered, so the failure points only at drift.
    expect(gaps.every((g) => g.includes("claude-opus-6") || g.includes("gpt-6-unlisted"))).toBe(true);
  });

  it("skips the local vendor's empty entries rather than reporting them", () => {
    // LM Studio serves whatever is loaded; an empty id is correct, not drift.
    expect(findCoverageGaps({ local: { light: "", standard: "", heavy: "" } })).toEqual([]);
  });

  it("covers GOOGLE_MODELS, which the tier catalog aliases", () => {
    // budget-preflight.test.ts covered the google tiers and nothing else,
    // which is the asymmetry that let the claude and codex tiers drift
    // unguarded. One rule over both removes it.
    expect(findCoverageGaps({ google: GOOGLE_MODELS as unknown as Record<string, string> })).toEqual([]);
  });

  it("keeps the two tables in step with each other", () => {
    // A model priced but unsized (or the reverse) breaks a different half of
    // budgetPreflight, so neither table may lead the other.
    const priced = new Set(Object.keys(MODEL_COSTS));
    const sized = new Set(Object.keys(MODEL_CONTEXT_WINDOWS));

    expect([...priced].filter((m) => !sized.has(m))).toEqual([]);
    expect([...sized].filter((m) => !priced.has(m))).toEqual([]);
  });
});
