/**
 * Bounds on the context handed to a task.
 *
 * The brief is rebuilt for every task and every retry, so an unbounded section
 * is a cost multiplied by the loop. The properties worth pinning are not the
 * numbers but the honesty: a dropped sibling or requirement must be *reported*,
 * because an agent that cannot tell an absent constraint from an unmentioned
 * one will act as though it does not exist.
 */

import { describe, it, expect } from "vitest";
import {
  capList,
  dedupeRequirements,
  trimDocument,
  MAX_BRIEF_SIBLINGS,
  MAX_CONTEXT_FILE_CHARS,
} from "../../../src/agent/planning/context-caps.js";

describe("capList", () => {
  it("passes a short list through untouched", () => {
    const result = capList(["a", "b"], 5);
    expect(result.items).toEqual(["a", "b"]);
    expect(result.omitted).toBe(0);
  });

  it("passes a list exactly at the cap without reporting omissions", () => {
    const items = Array.from({ length: 5 }, (_, i) => i);
    const result = capList(items, 5);
    expect(result.items).toHaveLength(5);
    expect(result.omitted).toBe(0);
  });

  it("keeps the leading prefix and counts the rest", () => {
    const items = Array.from({ length: 30 }, (_, i) => i);
    const result = capList(items, MAX_BRIEF_SIBLINGS);

    expect(result.items).toHaveLength(MAX_BRIEF_SIBLINGS);
    expect(result.items[0]).toBe(0);
    expect(result.omitted).toBe(30 - MAX_BRIEF_SIBLINGS);
  });

  it("does not mutate the input", () => {
    const items = ["a", "b", "c"];
    capList(items, 1);
    expect(items).toEqual(["a", "b", "c"]);
  });
});

describe("dedupeRequirements", () => {
  it("collapses requirements repeated by id across the parent chain", () => {
    const result = dedupeRequirements([
      { id: "REQ-1", title: "Must log", source: "feature" },
      { id: "REQ-1", title: "Must log", source: "epic" },
    ] as never);

    expect(result).toHaveLength(1);
    // Nearest-parent attribution wins: it is the more specific one.
    expect((result[0] as { source: string }).source).toBe("feature");
  });

  it("collapses restatements that share no id, by title and criteria", () => {
    const result = dedupeRequirements([
      { title: "Must log", acceptanceCriteria: ["logs on start"] },
      { title: "  must LOG ", acceptanceCriteria: ["logs on start"] },
    ] as never);

    expect(result).toHaveLength(1);
  });

  it("keeps same-titled requirements whose criteria differ", () => {
    const result = dedupeRequirements([
      { title: "Must log", acceptanceCriteria: ["logs on start"] },
      { title: "Must log", acceptanceCriteria: ["logs on stop"] },
    ] as never);

    expect(result).toHaveLength(2);
  });

  it("preserves order", () => {
    const result = dedupeRequirements([
      { id: "A", title: "a" },
      { id: "B", title: "b" },
      { id: "A", title: "a" },
      { id: "C", title: "c" },
    ] as never);

    expect(result.map((r) => (r as { id: string }).id)).toEqual(["A", "B", "C"]);
  });

  it("handles an empty list", () => {
    expect(dedupeRequirements([])).toEqual([]);
  });
});

describe("trimDocument", () => {
  it("returns a short document unchanged", () => {
    expect(trimDocument("short", 100, "workflow.md")).toBe("short");
  });

  it("reports how much it dropped and names the source", () => {
    const long = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
    const out = trimDocument(long, 200, "workflow.md");

    expect(out).toMatch(/not shown/);
    expect(out).toContain("workflow.md");
    expect(out).toMatch(/\d+ more character/);
  });

  it("cuts at a line boundary so no instruction is left half-stated", () => {
    // A mid-line cut turns "do not delete X" into "do not delete", which
    // reads as a complete and different rule.
    const doc = Array.from({ length: 100 }, (_, i) => `rule ${i}: do not delete thing-${i}`).join("\n");
    const out = trimDocument(doc, 300, "workflow.md");
    const body = out.split("\n\n_…")[0];

    for (const line of body.split("\n")) {
      if (!line) continue;
      expect(line).toMatch(/^rule \d+: do not delete thing-\d+$/);
    }
  });

  it("falls back to a hard cut when there is no usable line break", () => {
    const oneLine = "x".repeat(1000);
    const out = trimDocument(oneLine, 100, "context file");
    expect(out).toMatch(/not shown/);
    expect(out.startsWith("x".repeat(100))).toBe(true);
  });

  it("bounds a pathological context file to roughly its budget", () => {
    const huge = Array.from({ length: 100_000 }, (_, i) => `line ${i}`).join("\n");
    const out = trimDocument(huge, MAX_CONTEXT_FILE_CHARS, "context file");

    // Budget plus the marker, not the original megabyte.
    expect(out.length).toBeLessThan(MAX_CONTEXT_FILE_CHARS + 500);
    expect(huge.length).toBeGreaterThan(MAX_CONTEXT_FILE_CHARS * 10);
  });
});
