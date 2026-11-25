import { describe, it, expect } from "vitest";
import {
  buildDependencyIndex,
  orderSiblingsByDependencies,
  waitingOnIds,
  withWaitingOn,
} from "../../../src/core/waiting-on.js";
import type { PRDItem } from "../../../src/schema/index.js";

function task(id: string, extra: Partial<PRDItem> = {}): PRDItem {
  return { id, title: `Task ${id}`, level: "task", status: "pending", ...extra };
}

const ids = (items: PRDItem[]): string[] => items.map((i) => i.id);

describe("waitingOnIds", () => {
  it("lists blockers that are not completed, including unknown ids", () => {
    const items = [task("a", { status: "completed" }), task("b"), task("c", { blockedBy: ["a", "b", "ghost"] })];
    expect(waitingOnIds(items[2], buildDependencyIndex(items))).toEqual(["b", "ghost"]);
  });

  it("is empty once every blocker is completed", () => {
    const items = [task("a", { status: "completed" }), task("c", { blockedBy: ["a"] })];
    expect(waitingOnIds(items[1], buildDependencyIndex(items))).toEqual([]);
  });

  it("applies to pending and in-progress items only", () => {
    const items = [task("a"), task("b", { status: "blocked", blockedBy: ["a"] }), task("c", { status: "in_progress", blockedBy: ["a"] })];
    const index = buildDependencyIndex(items);
    expect(waitingOnIds(items[1], index)).toEqual([]);
    expect(waitingOnIds(items[2], index)).toEqual(["a"]);
  });
});

describe("orderSiblingsByDependencies", () => {
  it("orders a chain A→B→C regardless of input order", () => {
    const a = task("a");
    const b = task("b", { blockedBy: ["a"] });
    const c = task("c", { blockedBy: ["b"] });
    expect(ids(orderSiblingsByDependencies([c, b, a]))).toEqual(["a", "b", "c"]);
  });

  it("keeps input order for unrelated siblings and ignores outside blockers", () => {
    const x = task("x", { blockedBy: ["elsewhere"] });
    const y = task("y");
    const b = task("b", { blockedBy: ["a"] });
    const a = task("a");
    expect(ids(orderSiblingsByDependencies([x, b, y, a]))).toEqual(["x", "y", "a", "b"]);
  });

  it("emits every item of a cycle exactly once", () => {
    const a = task("a", { blockedBy: ["c"] });
    const b = task("b", { blockedBy: ["a"] });
    const c = task("c", { blockedBy: ["b"] });
    const d = task("d");
    // d is free; then the cycle breaks at its earliest member, b.
    expect(ids(orderSiblingsByDependencies([b, a, c, d]))).toEqual(["d", "b", "c", "a"]);
  });

  it("ignores a self-reference", () => {
    const a = task("a", { blockedBy: ["a"] });
    const b = task("b");
    expect(ids(orderSiblingsByDependencies([a, b]))).toEqual(["a", "b"]);
  });
});

describe("withWaitingOn", () => {
  it("adds waitingOn at any depth without touching existing fields or the input", () => {
    const child = task("c", { blockedBy: ["a"] });
    const items: PRDItem[] = [task("a"), { id: "e", title: "Epic", level: "epic", status: "pending", children: [child] }];
    const out = withWaitingOn(items, buildDependencyIndex(items));
    expect(out[0]).toEqual(items[0]);
    expect(out[1].children?.[0]).toEqual({ ...child, waitingOn: ["a"] });
    expect(child).not.toHaveProperty("waitingOn");
  });
});
