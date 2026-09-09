// @vitest-environment jsdom
/**
 * The finding → Ask handoff.
 *
 * Two properties do the work: the seed is *structured* (so what reaches the
 * model is the finding, not a sentence about it, and a test can check the zone
 * and files survived), and it is *consumed once* (so an explanation cannot
 * silently attach itself to the next question the user types).
 *
 * @see packages/web/src/viewer/ask-seed.ts
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Finding } from "../../../src/viewer/external.js";
import {
  findingToSeed,
  setPendingAskSeed,
  takePendingAskSeed,
  explainFinding,
  EXPLAIN_FINDING_PROMPT,
} from "../../../src/viewer/ask-seed.js";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    type: "anti-pattern",
    scope: "billing",
    text: "High coupling between billing and api",
    severity: "critical",
    pass: 3,
    related: ["src/billing/invoice.ts", "src/api/handlers.ts"],
    ...overrides,
  } as Finding;
}

describe("findingToSeed", () => {
  it("carries type, severity, zone, message and files across", () => {
    expect(findingToSeed(finding())).toEqual({
      type: "anti-pattern",
      severity: "critical",
      zone: "billing",
      message: "High coupling between billing and api",
      files: ["src/billing/invoice.ts", "src/api/handlers.ts"],
    });
  });

  it("omits severity the analysis never set rather than inventing one", () => {
    // The list renders these rows as "info"; saying so to the model would be
    // asserting a classification the analysis did not make.
    const seed = findingToSeed(finding({ severity: undefined }));

    expect(seed).not.toHaveProperty("severity");
    expect(seed.zone).toBe("billing");
  });

  it("calls an unscoped finding global, matching how the list reads it", () => {
    expect(findingToSeed(finding({ scope: "" })).zone).toBe("global");
  });

  it("yields an empty file list rather than undefined when none are recorded", () => {
    expect(findingToSeed(finding({ related: undefined })).files).toEqual([]);
  });

  it("copies the file list, so a later mutation cannot rewrite the seed", () => {
    const source = finding();
    const seed = findingToSeed(source);
    source.related!.push("src/late-addition.ts");

    expect(seed.files).toHaveLength(2);
  });
});

describe("pending seed slot", () => {
  beforeEach(() => {
    setPendingAskSeed(null);
  });

  it("holds nothing until something is left in it", () => {
    expect(takePendingAskSeed()).toBeNull();
  });

  it("hands over what was left, once", () => {
    setPendingAskSeed(findingToSeed(finding()));

    expect(takePendingAskSeed()?.zone).toBe("billing");
    // Second read is empty: an explanation is a single act, and a seed that
    // outlived it would attach to the next hand-typed question.
    expect(takePendingAskSeed()).toBeNull();
  });

  it("keeps only the most recent finding when two are queued", () => {
    setPendingAskSeed(findingToSeed(finding({ scope: "first" })));
    setPendingAskSeed(findingToSeed(finding({ scope: "second" })));

    expect(takePendingAskSeed()?.zone).toBe("second");
    expect(takePendingAskSeed()).toBeNull();
  });
});

describe("explainFinding", () => {
  beforeEach(() => {
    setPendingAskSeed(null);
  });

  it("leaves the seed before navigating, so the panel cannot mount first", () => {
    const order: string[] = [];
    const navigateTo = vi.fn(() => {
      // By the time the panel is asked for, the seed has to be there already.
      order.push(takePendingAskSeed() ? "seed-present" : "seed-missing");
    });

    explainFinding(finding(), navigateTo);

    expect(navigateTo).toHaveBeenCalledWith("ask");
    expect(order).toEqual(["seed-present"]);
  });
});

describe("EXPLAIN_FINDING_PROMPT", () => {
  it("asks for both halves of an explanation", () => {
    // Either half alone is the failure this task exists to prevent: meaning
    // without action is a lecture, action without this repo's specifics is a
    // recipe that could have been written without reading it.
    expect(EXPLAIN_FINDING_PROMPT).toMatch(/what it means/i);
    expect(EXPLAIN_FINDING_PROMPT).toMatch(/zone/i);
    expect(EXPLAIN_FINDING_PROMPT).toMatch(/files/i);
    expect(EXPLAIN_FINDING_PROMPT).toMatch(/fix would touch/i);
  });

  it("does not restate the finding, which travels as structured context", () => {
    expect(EXPLAIN_FINDING_PROMPT).not.toMatch(/coupling|anti-pattern|billing/i);
  });
});
