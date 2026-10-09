import { describe, it, expect } from "vitest";
import { applyReshape, type ReshapeProposal } from "../../../src/core/reshape.js";
import type { PRDItem } from "../../../src/schema/index.js";

const applied = (id: string, delta: string): PRDItem =>
  ({ id, title: id, level: "epic", status: "completed", appliedAt: "2026-10-01T00:00:00.000Z", amends: [{ delta, target: "x" }] }) as PRDItem;
const plain = (id: string, children?: PRDItem[]): PRDItem => ({ id, title: id, level: "epic", status: "completed", children });
const proposal = (id: string, action: ReshapeProposal["action"]): ReshapeProposal => ({ id, action });

describe("applyReshape and kept changes", () => {
  it("skips a merge that names any applied change, and applies the other proposals", () => {
    const items = [plain("survivor"), applied("modifies", "modified"), plain("dup"), plain("old")];
    const result = applyReshape(items, [
      proposal("p1", { action: "merge", survivorId: "survivor", mergedIds: ["dup", "modifies"], reason: "same work" }),
      proposal("p2", { action: "merge", survivorId: "survivor", mergedIds: ["dup"], reason: "same work" }),
      proposal("p3", { action: "obsolete", itemId: "old", reason: "stale" }),
    ]);
    expect(result.errors).toEqual([
      { proposal: expect.objectContaining({ id: "p1" }), error: expect.stringMatching(/^Skipped: cannot merge away "modifies".*applied change/) },
    ]);
    expect(result.applied.map((p) => p.id)).toEqual(["p2", "p3"]);
    expect(items.map((i) => i.id)).toEqual(["survivor", "modifies", "old"]);
  });

  it("lets an applied change survive a merge", () => {
    const items = [applied("keeper", "removed"), plain("dup")];
    const result = applyReshape(items, [proposal("p1", { action: "merge", survivorId: "keeper", mergedIds: ["dup"], reason: "same" })]);
    expect(result.errors).toEqual([]);
    expect(items.map((i) => i.id)).toEqual(["keeper"]);
  });

  it("skips a split that would remove a change prune keeps, or a subtree holding one", () => {
    const items = [applied("retiring", "removed"), plain("holder", [applied("adding", "added")]), applied("modifies", "modified")];
    const split = (sourceId: string) => proposal(sourceId, { action: "split", sourceId, children: [{ title: "a", level: "epic" }], reason: "split" });
    const result = applyReshape(items, [split("retiring"), split("holder"), split("modifies")]);
    expect(result.errors.map((e) => e.error)).toEqual([
      expect.stringMatching(/^Skipped: cannot split and remove "retiring".*mark a node retired/),
      expect.stringMatching(/^Skipped: cannot split and remove "holder".*holds "adding"/),
    ]);
    expect(result.deletedIds).toEqual(["modifies"]);
  });

  it("leaves v1 items unchanged", () => {
    const items = [plain("a"), plain("b")];
    const result = applyReshape(items, [proposal("p1", { action: "merge", survivorId: "a", mergedIds: ["b"], reason: "same" })]);
    expect(result.errors).toEqual([]);
    expect(items.map((i) => i.id)).toEqual(["a"]);
  });
});
