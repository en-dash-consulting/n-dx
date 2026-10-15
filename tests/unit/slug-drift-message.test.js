/**
 * The slug-conformance failure message picks the right diagnosis.
 *
 * The e2e test that uses this builds it only when the tree has drifted, which
 * is almost never — so neither branch ran, and the threshold that chooses
 * between them was wrong by a factor of fifty without anything noticing:
 * `mismatches` spans the whole tree while the count it was compared against
 * was the roots only.
 */
import { describe, it, expect } from "vitest";

import { countItemsDeep, slugDriftMessage } from "../helpers/slug-drift-message.js";

describe("countItemsDeep", () => {
  it("counts an empty tree as zero", () => {
    expect(countItemsDeep([])).toBe(0);
    expect(countItemsDeep(undefined)).toBe(0);
  });

  it("counts roots that have no children", () => {
    expect(countItemsDeep([{}, {}, {}])).toBe(3);
  });

  it("counts descendants, not just roots", () => {
    // The bug: this tree is 1 root and 6 items.
    const tree = [
      {
        children: [
          { children: [{}, {}] },
          { children: [{}] },
          {},
        ],
      },
    ];
    expect(countItemsDeep(tree)).toBe(7);
  });

  it("tolerates an absent children array at any depth", () => {
    expect(countItemsDeep([{ children: [{ children: undefined }] }])).toBe(2);
  });
});

describe("slugDriftMessage", () => {
  const detail = '  "a" should be "b" in x (T)';

  /** A handful of drifted leaves in a large tree: item drift. */
  const drift = () =>
    slugDriftMessage({ mismatchCount: 23, itemCount: 2502, detail });

  /** Every path moved: the rule itself changed. */
  const ruleChange = () =>
    slugDriftMessage({ mismatchCount: 2502, itemCount: 2502, detail });

  it("calls a handful of drifted paths item drift", () => {
    expect(drift()).toContain("item drift rather than a rule change");
    expect(drift()).not.toContain("the rule itself differs");
  });

  it("does not call 23 of 2502 a rule change", () => {
    // The regression: against the root count (46) this crossed the threshold
    // and told the reader a different rex build had written the tree.
    expect(drift()).not.toContain("different slug rule wrote this tree");
  });

  it("calls a whole-tree mismatch a rule change", () => {
    expect(ruleChange()).toContain("the rule itself differs");
    expect(ruleChange()).toContain("different slug rule wrote this tree");
  });

  it("switches diagnosis at the halfway mark", () => {
    const under = slugDriftMessage({ mismatchCount: 50, itemCount: 100, detail });
    const over = slugDriftMessage({ mismatchCount: 51, itemCount: 100, detail });
    expect(under).toContain("item drift");
    expect(over).toContain("the rule itself differs");
  });

  it("names --allow-on-branch in both branches", () => {
    // Drift is usually found on a feature branch, where migrate-slugs refuses
    // without the flag — so the message has to mention it either way.
    for (const message of [drift(), ruleChange()]) {
      expect(message).toContain("--allow-on-branch");
      expect(message).toContain("rex migrate-slugs");
    }
  });

  it("says only drifted paths move, in both branches", () => {
    for (const message of [drift(), ruleChange()]) {
      expect(message).toContain("only drifted paths move");
    }
  });

  it("reports both counts and carries the detail", () => {
    expect(drift()).toContain("23 of 2502 path(s)");
    expect(drift()).toContain(detail);
  });
});
