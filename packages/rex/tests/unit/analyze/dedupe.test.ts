import { describe, it, expect } from "vitest";
import {
  similarity,
  deduplicateScanResults,
} from "../../../src/analyze/dedupe.js";
import type { ScanResult } from "../../../src/analyze/scanners.js";

function makeScanResult(
  overrides: Partial<ScanResult> & { name: string },
): ScanResult {
  return {
    source: "test",
    sourceFile: "test.ts",
    kind: "feature",
    ...overrides,
  };
}

describe("similarity", () => {
  it("returns 1.0 for identical strings", () => {
    expect(similarity("login flow", "login flow")).toBe(1.0);
  });

  it("returns 1.0 for case-insensitive matches", () => {
    expect(similarity("Login Flow", "login flow")).toBe(1.0);
  });

  it("returns high score for near-duplicates", () => {
    const score = similarity("validate email", "validates email");
    expect(score).toBeGreaterThan(0.7);
  });

  it("returns high score for reworded duplicates", () => {
    const score = similarity("User Login Flow", "Login Flow");
    expect(score).toBeGreaterThan(0.6);
  });

  it("returns low score for unrelated strings", () => {
    const score = similarity("Payment Processing", "User Authentication");
    expect(score).toBeLessThan(0.3);
  });

  it("returns 0 for empty strings", () => {
    expect(similarity("", "")).toBe(0);
  });

  it("returns 0 when one string is empty", () => {
    expect(similarity("hello", "")).toBe(0);
    expect(similarity("", "world")).toBe(0);
  });

  it("handles single-character strings", () => {
    // Single chars produce no bigrams, should return 0
    expect(similarity("a", "b")).toBe(0);
  });

  it("returns high score for plural variations", () => {
    const score = similarity("handle errors", "handle error");
    expect(score).toBeGreaterThan(0.7);
  });

  it("returns high score for minor word reordering", () => {
    const score = similarity("email validation", "validate email");
    // Bigrams differ but there should be some overlap
    expect(score).toBeGreaterThan(0.2);
  });
});

describe("deduplicateScanResults", () => {
  it("returns empty array for empty input", () => {
    expect(deduplicateScanResults([])).toEqual([]);
  });

  it("keeps distinct results unchanged", () => {
    const results = [
      makeScanResult({ name: "Login Flow" }),
      makeScanResult({ name: "Payment Processing" }),
      makeScanResult({ name: "Dashboard Charts" }),
    ];

    const deduped = deduplicateScanResults(results);
    expect(deduped).toHaveLength(3);
  });

  it("merges exact duplicates (case-insensitive)", () => {
    const results = [
      makeScanResult({ name: "Login Flow" }),
      makeScanResult({ name: "login flow" }),
    ];

    const deduped = deduplicateScanResults(results);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].name).toBe("Login Flow");
  });

  it("merges near-duplicate scan results", () => {
    const results = [
      makeScanResult({ name: "validate email", kind: "task" }),
      makeScanResult({ name: "validates email", kind: "task" }),
    ];

    const deduped = deduplicateScanResults(results);
    expect(deduped).toHaveLength(1);
  });

  it("only merges results of the same kind", () => {
    const results = [
      makeScanResult({ name: "Login", kind: "feature" }),
      makeScanResult({ name: "Login", kind: "task" }),
    ];

    const deduped = deduplicateScanResults(results);
    expect(deduped).toHaveLength(2);
  });

  it("prefers result with higher priority", () => {
    const results = [
      makeScanResult({
        name: "fix auth bug",
        kind: "task",
        priority: "low",
        sourceFile: "a.ts",
      }),
      makeScanResult({
        name: "fix authentication bug",
        kind: "task",
        priority: "high",
        sourceFile: "b.ts",
      }),
    ];

    const deduped = deduplicateScanResults(results);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].priority).toBe("high");
  });

  it("prefers result with description over one without", () => {
    const results = [
      makeScanResult({
        name: "Setup caching",
        kind: "feature",
        sourceFile: "a.ts",
      }),
      makeScanResult({
        name: "Set up caching layer",
        kind: "feature",
        description: "Implement Redis-based caching",
        sourceFile: "b.ts",
      }),
    ];

    const deduped = deduplicateScanResults(results);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].description).toBe("Implement Redis-based caching");
  });

  it("prefers result with acceptance criteria", () => {
    const results = [
      makeScanResult({
        name: "validate input",
        kind: "task",
        sourceFile: "a.ts",
      }),
      makeScanResult({
        name: "validates input data",
        kind: "task",
        acceptanceCriteria: ["Rejects empty strings", "Trims whitespace"],
        sourceFile: "b.ts",
      }),
    ];

    const deduped = deduplicateScanResults(results);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].acceptanceCriteria).toEqual([
      "Rejects empty strings",
      "Trims whitespace",
    ]);
  });

  it("prefers longer (more descriptive) title when merging", () => {
    const results = [
      makeScanResult({ name: "Login", kind: "feature", sourceFile: "a.ts" }),
      makeScanResult({
        name: "User Login Flow",
        kind: "feature",
        sourceFile: "b.ts",
      }),
    ];

    const deduped = deduplicateScanResults(results);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].name).toBe("User Login Flow");
  });

  it("supports custom similarity threshold", () => {
    const results = [
      makeScanResult({ name: "validate email", kind: "task" }),
      makeScanResult({ name: "validates email", kind: "task" }),
    ];

    // Very high threshold should keep them separate
    const strict = deduplicateScanResults(results, 0.99);
    expect(strict).toHaveLength(2);

    // Lower threshold should merge
    const loose = deduplicateScanResults(results, 0.5);
    expect(loose).toHaveLength(1);
  });

  it("handles large result sets in reasonable time", () => {
    // Generate many results with 50 truly distinct items + 50 near-duplicates
    const baseNames = [
      "User authentication flow", "Payment gateway integration",
      "Dashboard chart rendering", "Email notification system",
      "Database migration scripts", "API rate limiting",
      "File upload service", "Search index optimization",
      "Session management logic", "Error logging pipeline",
      "Cache invalidation strategy", "Role permission matrix",
      "Webhook delivery queue", "PDF report generation",
      "OAuth provider setup", "Data export scheduler",
      "Audit trail recording", "Feature flag evaluation",
      "WebSocket connection pool", "Batch processing engine",
      "Image compression service", "Localization string loader",
      "Retry backoff handler", "Schema validation layer",
      "Encryption key rotation",
    ];

    const results: ScanResult[] = [];
    for (const name of baseNames) {
      // Original
      results.push(
        makeScanResult({
          name,
          kind: "feature",
          sourceFile: `${name.toLowerCase().replace(/\s+/g, "-")}.ts`,
        }),
      );
      // Near-duplicate (plural/minor rewording)
      results.push(
        makeScanResult({
          name: name + "s",
          kind: "feature",
          sourceFile: `${name.toLowerCase().replace(/\s+/g, "-")}-v2.ts`,
        }),
      );
    }

    const start = Date.now();
    const deduped = deduplicateScanResults(results);
    const elapsed = Date.now() - start;

    // Near-duplicates should be merged: expect roughly 25 (one per base name)
    expect(deduped.length).toBeLessThanOrEqual(baseNames.length);
    expect(deduped.length).toBeGreaterThan(0);
    // Should complete in reasonable time (< 2 seconds)
    expect(elapsed).toBeLessThan(2000);
  });

  it("merges acceptance criteria from duplicate results", () => {
    const results = [
      makeScanResult({
        name: "validate input",
        kind: "task",
        acceptanceCriteria: ["Rejects empty strings"],
        sourceFile: "a.ts",
      }),
      makeScanResult({
        name: "validates input",
        kind: "task",
        acceptanceCriteria: ["Trims whitespace"],
        sourceFile: "b.ts",
      }),
    ];

    const deduped = deduplicateScanResults(results);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].acceptanceCriteria).toContain("Rejects empty strings");
    expect(deduped[0].acceptanceCriteria).toContain("Trims whitespace");
  });

  it("merges tags from duplicate results", () => {
    const results = [
      makeScanResult({
        name: "fix auth bug",
        kind: "task",
        tags: ["auth"],
        sourceFile: "a.ts",
      }),
      makeScanResult({
        name: "fix authentication bug",
        kind: "task",
        tags: ["security"],
        sourceFile: "b.ts",
      }),
    ];

    const deduped = deduplicateScanResults(results);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].tags).toContain("auth");
    expect(deduped[0].tags).toContain("security");
  });

  it("returns dedupe stats", () => {
    const results = [
      makeScanResult({ name: "Login Flow" }),
      makeScanResult({ name: "login flow" }),
      makeScanResult({ name: "Payment Processing" }),
    ];

    const deduped = deduplicateScanResults(results);
    expect(deduped).toHaveLength(2);
  });
});
