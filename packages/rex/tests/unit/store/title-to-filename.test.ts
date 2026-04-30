/**
 * Tests for title-to-filename normalization.
 *
 * Acceptance criteria:
 *   - Pure function maps any title to deterministic filename
 *   - Handles quotes, slashes, colons, parentheses, and reserved chars
 *   - Spaces collapsed to single underscores (no double underscores)
 *   - Round-trip safe: f(f(x)) == f(x)
 *   - Covers ASCII, Unicode, empty-after-normalization, and collision cases
 */

import { describe, it, expect } from "vitest";
import {
  appendFilenameSuffix,
  titleToFilename,
} from "../../../src/store/title-to-filename.js";

describe("titleToFilename", () => {
  // ── Basic ASCII cases ─────────────────────────────────────────────────────────

  it("normalizes basic ASCII titles to lowercase with underscores", () => {
    expect(titleToFilename("Web Dashboard")).toBe("web_dashboard.md");
    expect(titleToFilename("Hello World")).toBe("hello_world.md");
    expect(titleToFilename("Simple Title")).toBe("simple_title.md");
  });

  // ── Reserved filesystem characters ────────────────────────────────────────────

  it("removes forward and backward slashes", () => {
    expect(titleToFilename("Path / Separator")).toBe("path_separator.md");
    expect(titleToFilename("Back \\ Slash")).toBe("back_slash.md");
    expect(titleToFilename("Both / and \\ slashes")).toBe("both_and_slashes.md");
  });

  it("removes colons", () => {
    expect(titleToFilename("Title: Subtitle")).toBe("title_subtitle.md");
    expect(titleToFilename("Part 1: Part 2: Part 3")).toBe("part_1_part_2_part_3.md");
  });

  it("removes asterisks and question marks", () => {
    expect(titleToFilename("File*Name?")).toBe("filename.md");
    expect(titleToFilename("What?*")).toBe("what.md");
  });

  it("removes quotes (single, double, angle brackets, pipes)", () => {
    expect(titleToFilename('My "Title"')).toBe("my_title.md");
    expect(titleToFilename("My 'Title'")).toBe("my_title.md");
    expect(titleToFilename("My <Title> | Other")).toBe("my_title_other.md");
  });

  it("removes parentheses and other punctuation", () => {
    expect(titleToFilename("My (test) title")).toBe("my_test_title.md");
    expect(titleToFilename("Title (with) (parentheses)")).toBe("title_with_parentheses.md");
  });

  // ── Whitespace handling ───────────────────────────────────────────────────────

  it("collapses multiple spaces to single underscore", () => {
    expect(titleToFilename("Hello    World")).toBe("hello_world.md");
    expect(titleToFilename("A  B  C")).toBe("a_b_c.md");
  });

  it("collapses mixed whitespace (spaces, tabs, newlines) to single underscore", () => {
    expect(titleToFilename("Hello\t\tWorld")).toBe("hello_world.md");
    expect(titleToFilename("Line1\nLine2")).toBe("line1_line2.md");
    expect(titleToFilename("Mixed  \t\n  Whitespace")).toBe("mixed_whitespace.md");
  });

  it("strips leading and trailing whitespace and underscores", () => {
    expect(titleToFilename("  Title  ")).toBe("title.md");
    expect(titleToFilename("\t\tTitle\n\n")).toBe("title.md");
    expect(titleToFilename("_Title_")).toBe("title.md");
  });

  // ── Combined special characters ───────────────────────────────────────────────

  it("handles combined special characters and punctuation", () => {
    expect(titleToFilename("My: Title? (test)")).toBe("my_title_test.md");
    expect(titleToFilename('Feature: "Cool" / Idea!')).toBe("feature_cool_idea.md");
    expect(titleToFilename('Title (with "quotes" and: colons)!')).toBe(
      "title_with_quotes_and_colons.md",
    );
  });

  // ── Empty and whitespace-only ─────────────────────────────────────────────────

  it("returns 'unnamed.md' when title is empty string", () => {
    expect(titleToFilename("")).toBe("unnamed.md");
  });

  it("returns 'unnamed.md' when title is all whitespace", () => {
    expect(titleToFilename("   ")).toBe("unnamed.md");
    expect(titleToFilename("\t\t")).toBe("unnamed.md");
    expect(titleToFilename("\n\n")).toBe("unnamed.md");
  });

  it("returns 'unnamed.md' when title is all special characters", () => {
    expect(titleToFilename("!!!???")).toBe("unnamed.md");
    expect(titleToFilename("--- !!!")).toBe("unnamed.md");
    expect(titleToFilename('""":::***')).toBe("unnamed.md");
  });

  // ── Unicode and accents ───────────────────────────────────────────────────────

  it("preserves ASCII letters in Unicode titles", () => {
    expect(titleToFilename("Héros & Légendes")).toBe("heros_legendes.md");
    expect(titleToFilename("Café au Lait")).toBe("cafe_au_lait.md");
    expect(titleToFilename("Naïve Approach")).toBe("naive_approach.md");
  });

  it("strips unsupported Unicode letters after preserving ASCII words", () => {
    expect(titleToFilename("Α Greek Letter")).toBe("greek_letter.md");
    expect(titleToFilename("Russian Text")).toBe("russian_text.md");
  });

  it("converts decomposable accents to ASCII where applicable", () => {
    expect(titleToFilename("Äpfel")).toBe("apfel.md");
  });

  // ── Existing .md extension ───────────────────────────────────────────────────

  it("removes .md extension before normalization (round-trip safety)", () => {
    expect(titleToFilename("web_dashboard.md")).toBe("web_dashboard.md");
    expect(titleToFilename("My_Item.md")).toBe("my_item.md");
  });

  // ── Round-trip safety (idempotence) ───────────────────────────────────────────

  it("is round-trip safe: f(f(x)) == f(x)", () => {
    const testCases = [
      "Web Dashboard",
      "My: Title? (test)",
      "  spaces  ",
      "!!!???",
      "hello_world.md",
      "Héros & Légendes",
      "Path / Separator \\ Safe!",
    ];

    for (const input of testCases) {
      const once = titleToFilename(input);
      const twice = titleToFilename(once);
      expect(twice).toBe(once, `Not idempotent for input: "${input}"`);
    }
  });

  it("always produces .md extension", () => {
    const testCases = [
      "Web Dashboard",
      "!!!???",
      "hello_world.md",
      "Héros & Légendes",
      "",
      "   ",
    ];

    for (const input of testCases) {
      const result = titleToFilename(input);
      expect(result).toMatch(/\.md$/);
    }
  });

  // ── Collision-prone cases (titles that differ only in punctuation) ────────────

  it("normalizes titles that differ only in punctuation to the same filename", () => {
    // Titles that should collide after normalization
    expect(titleToFilename("Hello World")).toBe(titleToFilename("Hello: World"));
    expect(titleToFilename("Hello World")).toBe(titleToFilename("Hello (World)"));
    expect(titleToFilename("Hello World")).toBe(titleToFilename("Hello! World?"));
    expect(titleToFilename("Héros & Légendes")).toBe(
      titleToFilename('Héros & "Légendes"'),
    );
  });

  it("produces distinct filenames for semantically different titles", () => {
    expect(titleToFilename("First Item")).not.toBe(titleToFilename("Second Item"));
    expect(titleToFilename("Test A")).not.toBe(titleToFilename("Test B"));
  });

  // ── Case sensitivity ──────────────────────────────────────────────────────────

  it("lowercases all output", () => {
    expect(titleToFilename("UPPERCASE")).toBe("uppercase.md");
    expect(titleToFilename("MixedCase")).toBe("mixedcase.md");
    expect(titleToFilename("CamelCase")).toBe("camelcase.md");
  });

  // ── No leading/trailing underscores ───────────────────────────────────────────

  it("does not produce leading or trailing underscores in filename", () => {
    expect(titleToFilename("_Leading")).toBe("leading.md");
    expect(titleToFilename("Trailing_")).toBe("trailing.md");
    expect(titleToFilename("__Both__")).toBe("both.md");
  });

  it("does not produce double underscores from original content", () => {
    expect(titleToFilename("A  B")).toBe("a_b.md");
    expect(titleToFilename("A   B")).toBe("a_b.md");
    expect(titleToFilename("A\t\tB")).toBe("a_b.md");
  });

  // ── Long titles ───────────────────────────────────────────────────────────────

  it("truncates long titles at a word boundary", () => {
    const longTitle = "This is a very long title with many words that should all be preserved";
    const result = titleToFilename(longTitle);
    expect(result).toBe("this_is_a_very_long_title_with_many.md");
    expect(result.length).toBeLessThanOrEqual(40);
  });

  it("appends suffixes without exceeding the filename length cap", () => {
    const result = appendFilenameSuffix(
      "this_is_a_very_long_title_with_many.md",
      "abcdef",
    );
    expect(result).toBe("this_is_a_very_long_title_abcdef.md");
    expect(result.length).toBeLessThanOrEqual(40);
  });

  // ── Edge cases ────────────────────────────────────────────────────────────────

  it("handles single character titles", () => {
    expect(titleToFilename("A")).toBe("a.md");
    expect(titleToFilename("!")).toBe("unnamed.md");
  });

  it("handles titles with only numbers", () => {
    expect(titleToFilename("123")).toBe("123.md");
    expect(titleToFilename("123 456")).toBe("123_456.md");
  });

  it("handles titles with underscores already present", () => {
    expect(titleToFilename("my_title")).toBe("my_title.md");
    expect(titleToFilename("my__title")).toBe("my__title.md");
  });
});
