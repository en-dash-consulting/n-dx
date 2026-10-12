/**
 * The adapter writes the snapshot file by hand (no runtime `@graview/*`
 * dependency), so this holds its writer to Graview's own: the same bytes
 * `writeSnapshot` from `@graview/core/snapshot` writes for the same graph,
 * and a file `readSnapshot` reads back whole or a kind at a time.
 */
import { describe, expect, it } from "vitest";
import { readSnapshot, readSnapshotHeader, writeSnapshot } from "@graview/core/snapshot";
import { canonical } from "../../src/canonical.js";
import { writeSnapshotFile, SNAPSHOT_FORMAT } from "../../src/snapshot-file.js";
import type { GraphSnapshot } from "../../src/types.js";

const AT = "2026-10-11T12:00:00.000Z";
const snapshot: GraphSnapshot = {
  nodes: [
    { id: "c1", kind: "change", title: "Ship it", status: "pending" },
    { id: "z1", kind: "zone", name: "checkout", cohesion: 0.5 },
    { id: "c2", kind: "change", title: "Fix it — with a dash", status: "completed" },
    { id: "t1", kind: "task", title: "Write the test" },
  ],
  edges: [
    { from: "t1", to: "c1", kind: "under" },
    { from: "c2", to: "c1", kind: "blockedBy" },
  ],
};

describe("writeSnapshotFile", () => {
  it("writes the bytes Graview's own writer writes for the same graph", () => {
    expect(writeSnapshotFile(snapshot, AT)).toBe(writeSnapshot(canonical(snapshot) as GraphSnapshot, { generatedAt: AT }));
  });

  it("says in its first line when it was made and what it holds", () => {
    const header = readSnapshotHeader(writeSnapshotFile(snapshot, new Date(AT)));
    expect(header.format).toBe(SNAPSHOT_FORMAT);
    expect(header.generatedAt).toBe(AT);
    expect(header.kinds).toEqual({ change: 2, zone: 1, task: 1 });
    expect(header.edges).toEqual({ under: 1, blockedBy: 1 });
    expect(header.parts.map((p) => p.kind)).toEqual(["change", "zone", "task", null]);
  });

  it("reads back whole, and a kind at a time with only the links among those kinds", () => {
    const text = writeSnapshotFile(snapshot, AT);
    const whole = readSnapshot(text).snapshot;
    expect(whole.nodes.map((n) => n.id).sort()).toEqual(["c1", "c2", "t1", "z1"]);
    expect(whole.edges).toHaveLength(2);
    const some = readSnapshot(text, { kinds: ["change"] }).snapshot;
    expect(some.nodes.map((n) => n.id)).toEqual(["c1", "c2"]);
    expect(some.edges).toEqual([{ from: "c2", to: "c1", kind: "blockedBy" }]);
  });

  it("sorts every record's keys, so the body of an unchanged checkout is the same bytes", () => {
    const shuffled: GraphSnapshot = { nodes: [{ kind: "change", title: "Ship it", id: "c1", status: "pending" }], edges: [] };
    const ordered: GraphSnapshot = { nodes: [{ id: "c1", kind: "change", status: "pending", title: "Ship it" }], edges: [] };
    expect(writeSnapshotFile(shuffled, AT)).toBe(writeSnapshotFile(ordered, AT));
  });
});
