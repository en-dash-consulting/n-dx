/**
 * Contract: every call site this feature routes light actually resolves to the
 * light-tier model, and the calls that must stay strong actually do.
 *
 * The routing is three indirections deep — call site declares a class, the
 * registry maps it to a tier, the vendor catalog maps the tier to a model — so
 * "we routed it light" is not observable at any single layer. This test pins
 * the resolved model per class, which is what the cost claim actually rests on.
 *
 * @see docs/analysis/llm-cost-optimization-plan.md — the Haiku routing map
 */

import { describe, it, expect } from "vitest";
import {
  resolveTaskModel,
  TIER_MODELS,
  resolveModel,
} from "../../packages/llm-client/dist/public.js";

/** Classes the audit's routing map assigns to the light tier. */
const LIGHT_CLASSES = [
  "git.commit-message",
  "prd.rename",
  "prd.merge",
  "prd.assess",
  "prd.consolidate-check",
  "prd.clarify",
  "code.classify",
  "zone.enrich-scan",
];

/**
 * Classes that must NOT be cheapened: multi-turn loops where turn count
 * dominates cost, and judgment work a human reads.
 */
const STRONG_CLASSES = [
  "agent.execute",
  "prd.propose",
  "prd.modify",
  "prd.spec",
  "prd.smart-add",
  "prd.restructure",
  "zone.enrich-deep",
  "zone.meta-eval",
];

describe("light-tier routing map", () => {
  const claude = { vendor: "claude" };

  it.each(LIGHT_CLASSES)("%s resolves to the light-tier model", (taskClass) => {
    const resolved = resolveTaskModel(taskClass, claude);
    expect(resolved.tier).toBe("light");
    expect(resolved.model).toBe(resolveModel(TIER_MODELS.claude.light));
  });

  it.each(STRONG_CLASSES)("%s stays on standard or stronger", (taskClass) => {
    const resolved = resolveTaskModel(taskClass, claude);
    expect(resolved.tier).not.toBe("light");
    expect(resolved.model).not.toBe(resolveModel(TIER_MODELS.claude.light));
  });

  it("routes light on every vendor, not just claude", () => {
    for (const vendor of ["claude", "codex", "google"]) {
      const resolved = resolveTaskModel("prd.rename", { vendor });
      expect(resolved.tier, vendor).toBe("light");
      expect(resolved.model, vendor).toBeTruthy();
    }
  });

  it("lets a cautious project pull all rex planning back to standard in one line", () => {
    // The documented escape hatch: quality regression on a light route is a
    // config change, not a code change.
    const config = { vendor: "claude", routes: { "prd.*": "standard" } };
    for (const taskClass of ["prd.rename", "prd.merge", "prd.assess", "prd.clarify"]) {
      expect(resolveTaskModel(taskClass, config).tier).toBe("standard");
    }
    // Non-prd light routes are untouched by that glob.
    expect(resolveTaskModel("code.classify", config).tier).toBe("light");
  });

  it("lets the light model itself be repinned without touching routes", () => {
    const config = { vendor: "claude", tiers: { claude: { light: "claude-haiku-pinned" } } };
    expect(resolveTaskModel("git.commit-message", config).model).toBe("claude-haiku-pinned");
  });
});
