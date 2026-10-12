import { describe, it, expect, afterEach } from "vitest";
import { rmSync } from "node:fs";
import { emitProjection } from "../../src/emit.js";
import { loadDocument } from "../../src/document.js";
import { fitSnapshot, describeMisfits } from "../../src/fit.js";
import type { GraphSnapshot } from "../../src/types.js";
import { makeProject } from "../helpers/project.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const doc = loadDocument();
const change = { id: "c1", kind: "change", title: "Add Apple Pay", status: "in_progress" };
const task = { id: "t1", kind: "task", title: "The button", status: "pending" };
const zone = { id: "z1", kind: "zone", name: "Checkout" };

describe("the snapshot fits the declaration", () => {
  it("passes a pair that fits", () => {
    const snapshot: GraphSnapshot = { nodes: [change, task, zone], edges: [{ kind: "blockedBy", from: "t1", to: "c1" }] };
    expect(fitSnapshot(doc, snapshot)).toEqual([]);
  });

  it("names each record and field the declaration does not admit", () => {
    const snapshot: GraphSnapshot = {
      nodes: [
        { ...change, status: "shipped" },
        { ...task, priority: 3 },
        { id: "z2", kind: "zone", name: "Cart", cohesion: 1.5 },
        { id: "x", kind: "widget" },
        { id: "t2", kind: "task", status: "pending" },
        { id: "z3", kind: "zone", name: "Lists", madeUp: true },
        zone,
      ],
      edges: [
        { kind: "blockedBy", from: "t1", to: "z1" },
        { kind: "crosses", from: "c1", to: "z1" },
        { kind: "inZone", from: "t1", to: "nowhere" },
      ],
    };
    const said = fitSnapshot(doc, snapshot).map((m) => `${m.record} ${m.at}: ${m.message}`);
    expect(said).toEqual(expect.arrayContaining([
      expect.stringMatching(/^c1 status: change\.status is "shipped", which is not one of /),
      expect.stringMatching(/^t1 priority: task\.priority is 3/),
      expect.stringMatching(/^z2 cohesion: zone\.cohesion is 1\.5, above the declared maximum 1/),
      "x kind: kind \"widget\" is not declared",
      "t2 title: task.title is required and missing",
      "z3 madeUp: zone.madeUp is not declared",
      expect.stringMatching(/^t1 blockedBy: task\.blockedBy reaches a zone \(z1\); it is declared to reach /),
      "c1 crosses: change declares no relation \"crosses\"",
      "t1 inZone: inZone reaches nowhere, which is not in the snapshot",
    ]));
    expect(describeMisfits(fitSnapshot(doc, snapshot), 2)).toMatch(/^\d+ records do not fit the declaration:\n {2}c1: .*\n {2}.*\n {2}and \d+ more$/);
  });

  it("holds a relation declared to reach one record to one", () => {
    const run = { id: "r1", kind: "run", status: "completed" };
    const snapshot: GraphSnapshot = { nodes: [run, change, task], edges: [{ kind: "ranFor", from: "r1", to: "c1" }, { kind: "ranFor", from: "r1", to: "t1" }] };
    expect(fitSnapshot(doc, snapshot).map((m) => m.message)).toContain("run.ranFor is declared to reach one record and reaches more");
  });

  it("fits what emit writes for a v2 project and for a v1 project with its proposed product layer", async () => {
    for (const prd of ["v2", "v1"] as const) {
      const root = makeProject({ prd });
      roots.push(root);
      const emitted = await emitProjection(root, { warn: () => {} });
      expect(emitted.misfits, `${prd}: ${describeMisfits(emitted.misfits)}`).toEqual([]);
    }
  });
});
