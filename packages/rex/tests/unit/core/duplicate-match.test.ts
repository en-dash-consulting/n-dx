import { describe, expect, it } from "vitest";
import { findDuplicateItem, scoreDuplicate } from "../../../src/core/duplicate-match.js";

const items = [
  { id: "a", title: "Add Apple Pay" },
  { id: "b", title: "Refund flow", description: "Shoppers ask for a refund and get one." },
  { id: "c", title: "Something else entirely" },
];

describe("findDuplicateItem", () => {
  it("matches an exact title, ignoring case and spacing", () => {
    expect(findDuplicateItem({ title: "  add  apple pay" }, items)).toMatchObject({ item: { id: "a" }, score: 1, reason: "exact_title" });
  });

  it("matches a title that contains another", () => {
    expect(findDuplicateItem({ title: "Add Apple Pay to checkout" }, items)).toMatchObject({ item: { id: "a" }, reason: "semantic_title" });
  });

  it("answers null when nothing matches", () => {
    expect(findDuplicateItem({ title: "Translate the docs" }, items)).toBeNull();
    expect(findDuplicateItem({ title: "Add Apple Pay" }, [])).toBeNull();
  });

  it("picks the best of several matches", () => {
    const pool = [{ id: "x", title: "Add Apple Pay to checkout" }, { id: "y", title: "Add Apple Pay" }];
    expect(findDuplicateItem({ title: "Add Apple Pay" }, pool)?.item.id).toBe("y");
  });
});

describe("scoreDuplicate", () => {
  it("leaves which items may match to the caller", () => {
    expect(scoreDuplicate({ title: "Refund flow" }, items[1])).not.toBeNull();
  });
});
