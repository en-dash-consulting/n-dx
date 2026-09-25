/**
 * Regression tests for GitHub #375: `rex fix` backfilled a missing startedAt
 * on a completed item with the current clock. For anything completed before
 * today that inverted the pair (startedAt > completedAt) — a validation
 * failure manufactured by the repair command — and the inversion was then
 * invisible to both a second `rex fix` and `rex validate --repair`.
 *
 * The contract under test:
 * - Backfilled startedAt on a completed item derives from the item's own
 *   completedAt, never from the clock.
 * - An already-inverted pair is a detectable, fixable issue
 *   (`inverted_timestamps`), repaired by clamping startedAt to completedAt.
 * - No fix pass may leave startedAt > completedAt on any item it touched.
 */
import { describe, it, expect } from "vitest";
import {
  detectTimestampIssues,
  detectInvertedTimestamps,
  detectIssues,
  applyFixes,
} from "../../../src/fix/index.js";
import type { FixItem } from "../../../src/fix/index.js";

// The issue's reproduction: an item completed well before "today".
const COMPLETED_AT = "2026-09-07T23:58:00.000Z";
const NOW = "2026-09-17T16:25:42.231Z";

function completedTask(overrides: Partial<FixItem>): FixItem {
  return {
    id: "t1",
    title: "Sample task",
    level: "task",
    status: "completed",
    ...overrides,
  };
}

describe("startedAt backfill on completed items (#375)", () => {
  it("derives startedAt from the item's own completedAt, not the clock", () => {
    const items = [completedTask({ completedAt: COMPLETED_AT })];
    applyFixes(items, NOW);
    expect(items[0].startedAt).toBe(COMPLETED_AT);
  });

  it("never leaves startedAt after completedAt", () => {
    const items = [completedTask({ completedAt: COMPLETED_AT })];
    applyFixes(items, NOW);
    expect(Date.parse(items[0].startedAt!)).toBeLessThanOrEqual(
      Date.parse(items[0].completedAt!),
    );
  });

  it("records the derivation in the plan, not a bare 'Add startedAt'", () => {
    const actions = detectTimestampIssues([completedTask({ completedAt: COMPLETED_AT })]);
    const startedAtAction = actions.find((a) => a.description.includes("startedAt"));
    expect(startedAtAction).toBeDefined();
    expect(startedAtAction!.description).toContain("from completedAt");
  });

  it("keeps the clock for in_progress items, which have no completedAt to derive from", () => {
    const items: FixItem[] = [
      { id: "t1", title: "Active", level: "task", status: "in_progress" },
    ];
    applyFixes(items, NOW);
    expect(items[0].startedAt).toBe(NOW);
  });

  it("both absent: backfills a consistent zero-length pair, never an inverted one", () => {
    const items = [completedTask({})];
    applyFixes(items, NOW);
    expect(items[0].startedAt).toBe(items[0].completedAt);
    expect(items[0].completedAt).toBe(NOW);
  });

  it("floors a completedAt backfill at a future startedAt rather than inverting", () => {
    const future = "2026-12-31T00:00:00.000Z";
    const items = [completedTask({ startedAt: future })];
    applyFixes(items, NOW);
    expect(items[0].completedAt).toBe(future);
  });

  it("repairs the issue's 18-item scenario in one run with no inversions", () => {
    const items: FixItem[] = Array.from({ length: 18 }, (_, i) =>
      completedTask({ id: `t${i}`, title: `Task ${i}`, completedAt: COMPLETED_AT }),
    );
    applyFixes(items, NOW);
    for (const item of items) {
      expect(Date.parse(item.startedAt!)).toBeLessThanOrEqual(Date.parse(item.completedAt!));
    }
    expect(detectIssues(items)).toEqual([]);
  });
});

describe("inverted pairs left behind by the old backfill (#375)", () => {
  const inverted = () =>
    completedTask({ startedAt: NOW, completedAt: COMPLETED_AT });

  it("is detected as an inverted_timestamps issue", () => {
    const actions = detectInvertedTimestamps([inverted()]);
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("inverted_timestamps");
    expect(actions[0].itemId).toBe("t1");
  });

  it("appears in the aggregate detectIssues plan", () => {
    const kinds = detectIssues([inverted()]).map((a) => a.kind);
    expect(kinds).toContain("inverted_timestamps");
  });

  it("is repaired by clamping startedAt to completedAt", () => {
    const items = [inverted()];
    const result = applyFixes(items, NOW);
    expect(items[0].startedAt).toBe(COMPLETED_AT);
    expect(items[0].completedAt).toBe(COMPLETED_AT);
    expect(result.mutatedCount).toBeGreaterThan(0);
  });

  it("converges: the second fix the issue asked for is not needed", () => {
    const items = [inverted()];
    applyFixes(items, NOW);
    expect(detectIssues(items)).toEqual([]);
    expect(applyFixes(items, NOW).mutatedCount).toBe(0);
  });

  it("does not fire for a consistent pair", () => {
    const items = [
      completedTask({ startedAt: COMPLETED_AT, completedAt: NOW }),
    ];
    expect(detectInvertedTimestamps(items)).toEqual([]);
  });

  it("does not fire for a zero-length pair", () => {
    const items = [
      completedTask({ startedAt: COMPLETED_AT, completedAt: COMPLETED_AT }),
    ];
    expect(detectInvertedTimestamps(items)).toEqual([]);
  });

  it("leaves non-completed items to the stale-completedAt rule, keeping plan and run aligned", () => {
    // A pending item with an inverted pair loses its completedAt to the stale
    // clear; promising a clamp too would put an action in the dry-run preview
    // that the run never performs.
    const items: FixItem[] = [
      {
        id: "t1",
        title: "Pending",
        level: "task",
        status: "pending",
        startedAt: NOW,
        completedAt: COMPLETED_AT,
      },
    ];
    expect(detectInvertedTimestamps(items)).toEqual([]);
    applyFixes(items, NOW);
    expect(items[0].completedAt).toBeUndefined();
  });

  it("finds inversions on items nested below the root", () => {
    const items: FixItem[] = [
      {
        id: "e1",
        title: "Epic",
        level: "epic",
        status: "pending",
        children: [inverted()],
      },
    ];
    const actions = detectInvertedTimestamps(items);
    expect(actions.map((a) => a.itemId)).toEqual(["t1"]);
  });
});
