/**
 * `traceRequirements(entry)` is `collectRequirements(items, id)` without the
 * second tree walk. Next-task ranking scores every item in the tree, and
 * re-finding each one made a single selection quadratic in PRD size — about
 * half a second on a 2,800-item tree, five times per Live-monitor tick.
 * These tests pin the two to the same answer so the fast path cannot drift.
 */

import { describe, it, expect } from "vitest";
import type { PRDItem } from "../../../src/schema/index.js";
import { collectRequirements, traceRequirements } from "../../../src/core/requirements.js";
import { walkTree } from "../../../src/core/tree.js";
import { findNextTask } from "../../../src/core/next-task.js";

function item(id: string, level: PRDItem["level"], extra: Partial<PRDItem> = {}): PRDItem {
  return {
    id,
    title: `Item ${id}`,
    description: "",
    status: "pending",
    priority: "medium",
    level,
    ...extra,
  } as PRDItem;
}

const requirement = (id: string, category: "security" | "performance" | "functional", priority: "critical" | "high" | "medium" = "medium") =>
  ({ id, text: `req ${id}`, category, priority, validationType: "test" }) as never;

const tree: PRDItem[] = [
  item("e1", "epic", {
    requirements: [requirement("r-epic", "security", "critical")],
    children: [
      item("f1", "feature", {
        requirements: [requirement("r-feature", "performance", "high")],
        children: [
          item("t1", "task", { requirements: [requirement("r-task", "functional")] }),
          item("t2", "task"),
        ],
      }),
      item("f2", "feature", { children: [item("t3", "task", { status: "completed" })] }),
    ],
  }),
  item("e2", "epic", { children: [item("t4", "task")] }),
];

describe("traceRequirements", () => {
  it("answers exactly what collectRequirements answers, for every item in the tree", () => {
    for (const entry of walkTree(tree)) {
      expect(traceRequirements(entry)).toEqual(collectRequirements(tree, entry.item.id));
    }
  });

  it("lists the item's own requirements first, then ancestors from the parent up", () => {
    const entry = [...walkTree(tree)].find((e) => e.item.id === "t1")!;
    expect(traceRequirements(entry).map((t) => t.sourceItemId)).toEqual(["t1", "f1", "e1"]);
  });

  it("selection still prefers the task whose chain carries the heavier requirements", () => {
    // t1 inherits a critical security requirement; t4 inherits nothing.
    const next = findNextTask(tree, new Set(["t3"]));
    expect(next?.item.id).toBe("t1");
  });

  it("stays linear: one selection over a few thousand items takes milliseconds, not seconds", () => {
    const big: PRDItem[] = [];
    for (let e = 0; e < 30; e++) {
      const features: PRDItem[] = [];
      for (let f = 0; f < 10; f++) {
        const tasks: PRDItem[] = [];
        for (let t = 0; t < 10; t++) tasks.push(item(`t-${e}-${f}-${t}`, "task", { status: t % 3 === 0 ? "completed" : "pending" }));
        features.push(item(`f-${e}-${f}`, "feature", { requirements: [requirement(`r-${e}-${f}`, "security")], children: tasks }));
      }
      big.push(item(`e-${e}`, "epic", { children: features }));
    }
    const started = performance.now();
    const next = findNextTask(big, new Set());
    const elapsed = performance.now() - started;
    expect(next).not.toBeNull();
    // The quadratic version took ~500 ms here; a generous ceiling catches a
    // regression without flaking on a slow CI box.
    expect(elapsed).toBeLessThan(250);
  });
});
