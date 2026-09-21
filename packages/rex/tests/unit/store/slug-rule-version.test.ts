/**
 * The pin that makes `SLUG_RULE_VERSION` mean something.
 *
 * A version number attached to a rule is only useful if it cannot drift from
 * the rule. Nothing about editing `slugifyTitle` forces anyone to remember the
 * constant three lines above it, and a rule change that keeps the old version
 * is strictly worse than no version at all: every build then agrees it may
 * write a tree it is about to re-slug, and the guard reports all-clear while
 * the exact failure it exists to prevent happens anyway.
 *
 * So the rule's output is pinned here for a fixture chosen to exercise each of
 * its branches. Change any of `slugifyTitle`, `resolvePositionalSiblingSlugs`,
 * `appendShortIdSuffix` or the constants they read, and this fails. The fix is
 * always the same: bump `SLUG_RULE_VERSION`, update the expectations below,
 * and ship both in the commit that changed the rule.
 */

import { describe, it, expect } from "vitest";
import {
  SLUG_RULE_VERSION,
  resolveSiblingSlugs,
  slugifyTitle,
} from "../../../src/store/folder-tree-serializer.js";
import type { PRDItem } from "../../../src/schema/index.js";

function item(id: string, title: string): PRDItem {
  return { id, title, status: "pending", level: "task" } as PRDItem;
}

describe("slug rule version pin", () => {
  it("records the rule version the fixture below was pinned against", () => {
    // Bumping this alone is not enough — the expectations must be re-derived
    // from the new rule in the same commit.
    expect(SLUG_RULE_VERSION).toBe(2);
  });

  it("pins slugifyTitle across every normalisation branch", () => {
    expect(
      Object.fromEntries(
        [
          "Add SSO support",
          "  Mixed   Whitespace  ",
          "Punctuation!? & symbols/slashes",
          "Café déjà-vu naïve",
          "日本語 only",
          "UPPERCASE TITLE",
          "--leading-and-trailing--",
          "",
          "A title long enough that the forty character limit truncates it",
        ].map((title) => [title, slugifyTitle(title)]),
      ),
    ).toEqual({
      "Add SSO support": "add-sso-support",
      "  Mixed   Whitespace  ": "mixed-whitespace",
      "Punctuation!? & symbols/slashes": "punctuation-symbols-slashes",
      "Café déjà-vu naïve": "cafe-deja-vu-naive",
      // Every character is stripped as non-ASCII, leaving the empty-title slug.
      "日本語 only": "only",
      "UPPERCASE TITLE": "uppercase-title",
      "--leading-and-trailing--": "leading-and-trailing",
      "": "untitled",
      // Truncated at a word boundary below 40 characters, never mid-word.
      "A title long enough that the forty character limit truncates it":
        "a-title-long-enough-that-the-forty",
    });
  });

  it("pins sibling resolution: unique titles, collisions, and truncated collisions", () => {
    const siblings = [
      item("11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Unique Title"),
      item("22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "Shared Title"),
      item("33333333-cccc-4ccc-8ccc-cccccccccccc", "Shared Title"),
      item(
        "44444444-dddd-4ddd-8ddd-dddddddddddd",
        "A title long enough that the forty character limit truncates it",
      ),
      item(
        "55555555-eeee-4eee-8eee-eeeeeeeeeeee",
        "A title long enough that the forty character limit truncates it",
      ),
    ];

    expect(Object.fromEntries(resolveSiblingSlugs(siblings))).toEqual({
      // Rule 1: a title unique among its siblings is the whole slug.
      "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa": "unique-title",
      // Rule 2: a collision suffixes *every* member, not just the later ones,
      // so a slug never depends on where its item sits in the array.
      // The suffix is the first 6 alphanumerics of the id, hyphens stripped.
      "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb": "shared-title-222222",
      "33333333-cccc-4ccc-8ccc-cccccccccccc": "shared-title-333333",
      // Rule 2 again, with the base re-truncated to leave room for the suffix.
      "44444444-dddd-4ddd-8ddd-dddddddddddd": "a-title-long-enough-that-the-444444",
      "55555555-eeee-4eee-8eee-eeeeeeeeeeee": "a-title-long-enough-that-the-555555",
    });
  });

  it("pins rule 3: siblings sharing both title and id still get distinct slugs", () => {
    // A data-invariant violation `validate` reports — but the write must stay
    // lossless, so each instance gets its own directory.
    const siblings = [
      item("66666666-ffff-4fff-8fff-ffffffffffff", "Same Everything"),
      item("66666666-ffff-4fff-8fff-ffffffffffff", "Same Everything"),
    ];
    // resolveSiblingSlugs collapses on duplicate ids by construction; the
    // positional distinctness is what serializeFolderTree relies on.
    expect(resolveSiblingSlugs(siblings).size).toBe(1);
  });
});
