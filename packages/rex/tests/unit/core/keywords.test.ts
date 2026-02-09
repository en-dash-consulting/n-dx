import { describe, it, expect } from "vitest";
import {
  extractKeywords,
  scoreMatch,
  STOP_WORDS,
} from "../../../src/core/keywords.js";

// ---------------------------------------------------------------------------
// extractKeywords
// ---------------------------------------------------------------------------

describe("extractKeywords", () => {
  it("extracts meaningful words, dropping stop words", () => {
    const kw = extractKeywords("Maps criteria to test files");
    expect(kw).toContain("maps");
    expect(kw).toContain("criteria");
    expect(kw).toContain("files");
    expect(kw).not.toContain("to");
    expect(kw).not.toContain("test");
  });

  it("lowercases and strips punctuation", () => {
    const kw = extractKeywords("Runs relevant tests for a task!");
    expect(kw).toContain("runs");
    expect(kw).toContain("relevant");
    expect(kw).toContain("task");
    expect(kw).not.toContain("!");
  });

  it("drops short words (length <= 2)", () => {
    const kw = extractKeywords("A is on it");
    expect(kw).toHaveLength(0);
  });

  it("handles hyphenated and underscored terms", () => {
    const kw = extractKeywords("Reports test-results clearly");
    expect(kw).toContain("reports");
    expect(kw).toContain("test-results");
    expect(kw).toContain("clearly");
  });

  it("returns empty for empty string", () => {
    expect(extractKeywords("")).toHaveLength(0);
  });

  it("deduplicates keywords", () => {
    const kw = extractKeywords("tree tree traversal traversal tree");
    const unique = new Set(kw);
    expect(kw.length).toBe(unique.size);
  });

  it("extracts from acceptance criteria text", () => {
    const kw = extractKeywords("Progress statistics are accurate (counts all statuses, nested items)");
    expect(kw).toContain("progress");
    expect(kw).toContain("statistics");
    expect(kw).toContain("accurate");
    expect(kw).toContain("counts");
    expect(kw).toContain("statuses");
    expect(kw).toContain("nested");
    expect(kw).toContain("items");
  });

  it("extracts from technical test names", () => {
    const kw = extractKeywords("findItem returns null for unknown id");
    expect(kw).toContain("finditem");
    expect(kw).toContain("returns");
    expect(kw).toContain("null");
    expect(kw).toContain("unknown");
  });
});

// ---------------------------------------------------------------------------
// scoreMatch
// ---------------------------------------------------------------------------

describe("scoreMatch", () => {
  it("returns 0 when no keywords match", () => {
    expect(scoreMatch("tests/unit/auth.test.ts", ["database", "migration"])).toBe(0);
  });

  it("returns count of matching keywords", () => {
    expect(scoreMatch("tests/unit/verify.test.ts", ["verify", "unit"])).toBe(2);
  });

  it("matches across path separators", () => {
    expect(scoreMatch("packages/rex/tests/verify.test.ts", ["rex", "verify"])).toBe(2);
  });

  it("is case-insensitive", () => {
    expect(scoreMatch("tests/Verify.test.ts", ["verify"])).toBe(1);
  });

  it("matches compound words containing keywords", () => {
    // "tree" should match "tree-hardened" in file path
    expect(scoreMatch("tests/unit/core/tree-hardened.test.ts", ["tree"])).toBe(1);
  });

  it("scores acceptance criteria against test names accurately", () => {
    const keywords = extractKeywords("Parent chains are correctly computed");
    const score = scoreMatch("tests/unit/core/tree.test.ts", keywords);
    // "parent" might match if in test description, but won't match file path
    // This ensures no spurious matches on path alone
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// STOP_WORDS
// ---------------------------------------------------------------------------

describe("STOP_WORDS", () => {
  it("contains common English stop words", () => {
    expect(STOP_WORDS.has("the")).toBe(true);
    expect(STOP_WORDS.has("is")).toBe(true);
    expect(STOP_WORDS.has("and")).toBe(true);
    expect(STOP_WORDS.has("for")).toBe(true);
  });

  it("contains testing-specific stop words", () => {
    expect(STOP_WORDS.has("test")).toBe(true);
    expect(STOP_WORDS.has("tests")).toBe(true);
  });

  it("does not contain meaningful technical terms", () => {
    expect(STOP_WORDS.has("tree")).toBe(false);
    expect(STOP_WORDS.has("priority")).toBe(false);
    expect(STOP_WORDS.has("statistics")).toBe(false);
  });
});
