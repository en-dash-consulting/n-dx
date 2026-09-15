/**
 * Unit tests for `--item` reference resolution.
 *
 * This resolver decides which subtree an operator gets. Its looser spellings
 * (slug, path, id prefix) are only safe because of the order they are tried
 * in, so the precedence assertions here are the point of the file — not the
 * happy paths.
 */

import { describe, it, expect } from "vitest";
import { resolveItemRef } from "../../../src/cli/commands/export.js";
import type { PRDItem } from "../../../src/schema/index.js";

const EPIC = "aaaaaaaa-1111-4111-8111-111111111111";
const FEATURE = "bbbbbbbb-2222-4222-8222-222222222222";
const TASK = "cccccccc-3333-4333-8333-333333333333";
const TWIN_A = "dddddddd-4444-4444-8444-444444444444";
const TWIN_B = "eeeeeeee-5555-4555-8555-555555555555";

function item(overrides: Partial<PRDItem> & { id: string; title: string }): PRDItem {
  return { status: "pending", level: "task", ...overrides };
}

/**
 * Two of the children share a title, which is what makes the tree worth
 * testing against: that is the only case where the `-{id6}` suffix appears,
 * and therefore the only case where slugging a title on its own gets the
 * folder name wrong.
 */
function tree(): PRDItem[] {
  return [
    item({
      id: EPIC,
      title: "Checkout Overhaul",
      level: "epic",
      children: [
        item({
          id: FEATURE,
          title: "One-tap payment",
          level: "feature",
          children: [
            item({ id: TASK, title: "Store cards" }),
            item({ id: TWIN_A, title: "Wire up the vendor" }),
            item({ id: TWIN_B, title: "Wire up the vendor" }),
          ],
        }),
      ],
    }),
  ];
}

const ids = (ref: string): string[] =>
  resolveItemRef(tree(), ref).map((match) => match.item.id);

describe("resolveItemRef", () => {
  it("resolves an exact id", () => {
    expect(ids(FEATURE)).toEqual([FEATURE]);
  });

  it("resolves an exact title, case-insensitively", () => {
    expect(ids("one-TAP Payment")).toEqual([FEATURE]);
  });

  it("resolves a slug", () => {
    expect(ids("one-tap-payment")).toEqual([FEATURE]);
  });

  it("resolves a full folder path", () => {
    expect(ids("checkout-overhaul/one-tap-payment")).toEqual([FEATURE]);
  });

  it("reports the path an item is stored at", () => {
    expect(resolveItemRef(tree(), TASK)[0].path).toBe(
      "checkout-overhaul/one-tap-payment/store-cards",
    );
  });

  it("resolves a directory name carrying the -{id6} disambiguation suffix", () => {
    const suffixed = `wire-up-the-vendor-${TWIN_B.slice(0, 6)}`;
    expect(resolveItemRef(tree(), suffixed)[0].path).toBe(
      `checkout-overhaul/one-tap-payment/${suffixed}`,
    );
    expect(ids(suffixed)).toEqual([TWIN_B]);
  });

  it("resolves a bare id prefix", () => {
    expect(ids(TWIN_A.slice(0, 6))).toEqual([TWIN_A]);
  });

  it("returns both candidates for a reference that names two items", () => {
    expect(ids("Wire up the vendor").sort()).toEqual([TWIN_A, TWIN_B].sort());
  });

  it("returns nothing for an unknown reference", () => {
    expect(ids("no-such-thing")).toEqual([]);
  });

  describe("precedence", () => {
    /**
     * A title that happens to *be* another item's slug must resolve to its own
     * item. Without the ordering, the slug pass would run against a reference
     * the title pass had already earned.
     */
    it("prefers an exact title over another item's slug", () => {
      const items = tree();
      items[0].children![0].children!.push(item({ id: TASK, title: "one-tap-payment" }));
      items[0].children![0].children![3].id = "ffffffff-6666-4666-8666-666666666666";

      const matches = resolveItemRef(items, "one-tap-payment");
      expect(matches).toHaveLength(1);
      expect(matches[0].item.title).toBe("one-tap-payment");
    });

    it("prefers an id over anything a looser rule could match", () => {
      const items = tree();
      // A title spelled exactly like another item's id.
      items[0].children!.push(item({ id: "99999999-9999-4999-8999-999999999999", title: TASK }));

      const matches = resolveItemRef(items, TASK);
      expect(matches).toHaveLength(1);
      expect(matches[0].item.id).toBe(TASK);
    });
  });
});
