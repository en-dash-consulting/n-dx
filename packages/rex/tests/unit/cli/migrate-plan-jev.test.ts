import { describe, it, expect } from "vitest";
import type { LLMConfig } from "@n-dx/llm-client";
import { wantsJevReview } from "../../../src/cli/commands/migrate-plan.js";
import { planSeams } from "../../../src/migrations/v1-to-v2/seams.js";
import { mockJudge } from "../../helpers/jev-judge.js";

/** What `buildSeams` hands `planSeams`, with a key present. */
function seamsFor(flags: Record<string, string>, llm: LLMConfig) {
  return planSeams({
    settings: { models: "text", autoAccept: "agree" },
    jev: { model: "jev-test", judge: mockJudge({}) },
    jevAvailable: true,
    jevReview: wantsJevReview(flags, llm),
  });
}

describe("migrate-plan Jev review", () => {
  it("runs with a key by default", () => {
    expect(wantsJevReview({}, {})).toBe(true);
    expect(seamsFor({}, {}).jev).toBeDefined();
  });

  it("is off under --no-jev-review", () => {
    expect(wantsJevReview({ "no-jev-review": "true" }, {})).toBe(false);
    expect(seamsFor({ "no-jev-review": "true" }, {}).jev).toBeUndefined();
  });

  it.each([
    ["the exact class", { routes: { "prd.migrate.judge": "light" } }],
    ["a wildcard", { routes: { "*": "standard" } }],
    ["a prefix glob", { routes: { "prd.*": "light" } }],
  ] as const)("is off when llm.routes sends %s to a tier", (_name, llm) => {
    expect(wantsJevReview({}, llm)).toBe(false);
    expect(seamsFor({}, llm).jev).toBeUndefined();
  });

  it("stays on for a typesafe route or an unrelated route", () => {
    expect(wantsJevReview({}, { routes: { "*": "standard", "prd.migrate.judge": "typesafe" } })).toBe(true);
    expect(wantsJevReview({}, { routes: { "code.*": "light" } })).toBe(true);
  });
});
