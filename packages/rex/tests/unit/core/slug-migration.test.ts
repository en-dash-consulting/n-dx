/**
 * Tests for the `rex migrate-slugs` guards.
 *
 * Acceptance criteria:
 *   - Same-titled siblings with distinct ids are NOT reported (that is the
 *     ordinary case the `-{id6}` suffix exists for)
 *   - Siblings sharing a title AND an id ARE reported, with the offenders named
 *   - A fingerprint survives a path change but not a field change
 *   - Losslessness is judged on fields and child membership, not on paths
 */

import { describe, it, expect } from "vitest";
import {
  findUnresolvableSiblingCollisions,
  fingerprintTree,
  diffFingerprints,
  isLossless,
} from "../../../src/core/slug-migration.js";
import type { PRDItem } from "../../../src/schema/index.js";

const ID_A = "aaaaaaaa-0000-0000-0000-000000000000";
const ID_B = "bbbbbbbb-0000-0000-0000-000000000000";

function item(id: string, title: string, extra: Partial<PRDItem> = {}): PRDItem {
  return { id, title, level: "task", status: "pending", ...extra } as PRDItem;
}

describe("findUnresolvableSiblingCollisions", () => {
  it("ignores same-titled siblings with distinct ids", () => {
    // The ordinary case: both take an -{id6} suffix. Reporting these would
    // make the guard fire on any healthy tree — this repo's has 78.
    const items = [item(ID_A, "Rex"), item(ID_B, "Rex")];
    expect(findUnresolvableSiblingCollisions(items)).toEqual([]);
  });

  it("ignores a tree with no collisions at all", () => {
    expect(findUnresolvableSiblingCollisions([item(ID_A, "Rex"), item(ID_B, "Hench")])).toEqual([]);
  });

  it("reports siblings that share a title and an id", () => {
    const found = findUnresolvableSiblingCollisions([item(ID_A, "Rex"), item(ID_A, "Rex")]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ slug: "rex", id: ID_A, count: 2 });
  });

  it("reports titles that differ only after normalisation", () => {
    // "Rex!" and "Rex" both normalise to "rex"; with one id they are one slug.
    const found = findUnresolvableSiblingCollisions([item(ID_A, "Rex"), item(ID_A, "Rex!")]);
    expect(found).toHaveLength(1);
    expect(found[0].titles.sort()).toEqual(["Rex", "Rex!"]);
  });

  it("finds collisions nested below the root", () => {
    const parent = item(ID_B, "Parent", {
      children: [item(ID_A, "Child"), item(ID_A, "Child")],
    });
    expect(findUnresolvableSiblingCollisions([parent])).toHaveLength(1);
  });

  it("does not report the same id used under different parents", () => {
    // A duplicate id across parents is a different fault, reported by validate.
    // It is not a *sibling* collision and does not make a slug ambiguous.
    const a = item("p1-0000-0000-0000-000000000000", "A", { children: [item(ID_A, "Shared")] });
    const b = item("p2-0000-0000-0000-000000000000", "B", { children: [item(ID_A, "Shared")] });
    expect(findUnresolvableSiblingCollisions([a, b])).toEqual([]);
  });
});

describe("fingerprintTree / diffFingerprints", () => {
  it("reports a clean diff for an unchanged tree", () => {
    const items = [item(ID_A, "Rex", { children: [item(ID_B, "Child")] })];
    const diff = diffFingerprints(fingerprintTree(items), fingerprintTree(items));
    expect(isLossless(diff)).toBe(true);
  });

  it("is unaffected by a slug change, since it never looks at paths", () => {
    // The whole point: a rename must read as lossless.
    const before = fingerprintTree([item(ID_A, "Rex")]);
    const after = fingerprintTree([item(ID_A, "Rex")]);
    expect(isLossless(diffFingerprints(before, after))).toBe(true);
  });

  it("catches a dropped item", () => {
    const before = fingerprintTree([item(ID_A, "Rex"), item(ID_B, "Hench")]);
    const after = fingerprintTree([item(ID_A, "Rex")]);
    const diff = diffFingerprints(before, after);
    expect(diff.lost).toEqual([ID_B]);
    expect(isLossless(diff)).toBe(false);
  });

  it("catches an altered field", () => {
    const before = fingerprintTree([item(ID_A, "Rex", { status: "pending" })]);
    const after = fingerprintTree([item(ID_A, "Rex", { status: "completed" })]);
    expect(diffFingerprints(before, after).changed).toEqual([ID_A]);
  });

  it("catches a re-parented child", () => {
    const before = fingerprintTree([
      item("p1-0000-0000-0000-000000000000", "P1", { children: [item(ID_A, "C")] }),
      item("p2-0000-0000-0000-000000000000", "P2"),
    ]);
    const after = fingerprintTree([
      item("p1-0000-0000-0000-000000000000", "P1"),
      item("p2-0000-0000-0000-000000000000", "P2", { children: [item(ID_A, "C")] }),
    ]);
    const diff = diffFingerprints(before, after);
    // Both parents changed membership, and the child's parent changed.
    expect(diff.changed).toContain(ID_A);
    expect(isLossless(diff)).toBe(false);
  });

  it("catches an item that appeared", () => {
    const diff = diffFingerprints(
      fingerprintTree([item(ID_A, "Rex")]),
      fingerprintTree([item(ID_A, "Rex"), item(ID_B, "New")]),
    );
    expect(diff.gained).toEqual([ID_B]);
  });
});
