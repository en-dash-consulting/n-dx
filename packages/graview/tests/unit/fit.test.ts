import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileDocument } from "@graview/core/check";
import { validateGraph } from "@graview/core";
import { emitProjection } from "../../src/emit.js";
import { buildSnapshot } from "../../src/snapshot.js";
import { resolveLayout } from "../../src/llm-gateway.js";
import { documentFor, loadDocument } from "../../src/document.js";
import { clampToCaps, fitSnapshot, describeMisfits, LIST_MAX, STRING_MAX, TEXT_MAX } from "../../src/fit.js";
import type { GraphSnapshot } from "../../src/types.js";
import { makeProject, runRecord, ZONES } from "../helpers/project.js";

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
    expect(describeMisfits(fitSnapshot(doc, snapshot), 2)).toMatch(/^\d+ misfits in 6 records against the declaration:\n {2}c1: .*\n {2}.*\n {2}and \d+ more$/);
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

  it("holds each field to Graview's types, caps and its rule against null", () => {
    const run = { id: "r1", kind: "run", status: "completed" };
    const snapshot: GraphSnapshot = {
      nodes: [
        { ...change, title: "x".repeat(STRING_MAX + 1) },
        { ...task, tags: ["ok", 7] },
        { id: "z2", kind: "zone", name: "Cart", fileCount: 2.5 },
        { id: "z3", kind: "zone", name: "Lists", entryPoints: Array.from({ length: LIST_MAX + 1 }, (_, i) => `src/${i}.ts`) },
        { ...run, startedAt: "not a date" },
        { id: "c2", kind: "change", title: "Two", status: "pending", fix: "yes" },
        { id: "t3", kind: "task", title: "Three", status: "pending", assignee: null },
        { id: "", kind: "task", title: "No id", status: "pending" },
      ],
      edges: [],
    };
    const said = fitSnapshot(doc, snapshot).map((m) => `${m.record} ${m.at}: ${m.message}`);
    expect(said).toEqual(expect.arrayContaining([
      `c1 title: change.title is ${STRING_MAX + 1} characters, over Graview's ${STRING_MAX}`,
      expect.stringMatching(/^t1 tags: task\.tags holds 7, which is not a string/),
      "z2 fileCount: zone.fileCount is 2.5, not a whole number Graview can hold",
      `z3 entryPoints: zone.entryPoints holds ${LIST_MAX + 1} items, over Graview's ${LIST_MAX}`,
      'r1 startedAt: run.startedAt is "not a date", not a date and time',
      'c2 fix: change.fix is "yes", not true or false',
      "t3 assignee: task.assignee is null; leave it out instead",
      " id: a task record has no id",
    ]));
  });

  it("flags every record Graview's validateGraph flags", () => {
    // fit.ts is plain data over the declaration; this holds it to the validator a face runs.
    const compiled = compileDocument(documentFor("n-dx"));
    if (!compiled.ok || !compiled.app) throw new Error(JSON.stringify(compiled.findings));
    const run = { id: "r1", kind: "run", status: "completed" };
    const bad: GraphSnapshot[] = [
      { nodes: [{ ...change, title: "x".repeat(STRING_MAX + 1) }], edges: [] },
      { nodes: [{ ...task, tags: Array.from({ length: LIST_MAX + 1 }, (_, i) => `t${i}`) }], edges: [] },
      { nodes: [{ ...task, assignee: null }], edges: [] },
      { nodes: [{ ...change, status: "shipped" }], edges: [] },
      { nodes: [{ ...zone, cohesion: 1.5 }], edges: [] },
      { nodes: [{ ...zone, fileCount: 2.5 }], edges: [] },
      { nodes: [{ ...run, startedAt: "soon" }], edges: [] },
      { nodes: [task, zone], edges: [{ kind: "blockedBy", from: "t1", to: "z1" }] },
    ];
    for (const snapshot of bad) {
      const graview = validateGraph(compiled.app, structuredClone(snapshot));
      expect(graview.length, `validateGraph finds nothing in ${JSON.stringify(snapshot).slice(0, 120)}`).toBeGreaterThan(0);
      expect(fitSnapshot(doc, snapshot).length, `fit misses what validateGraph finds: ${JSON.stringify(graview.map((f) => f.message))}`).toBeGreaterThan(0);
    }
  });

  it("agrees with validateGraph at each of Graview's caps, both ways: the cap passes both, one past it fails both", () => {
    // If a Graview bump moves a cap, one side of this fails: fit would pass what the face rejects, or reject valid data.
    const compiled = compileDocument(documentFor("n-dx"));
    if (!compiled.ok || !compiled.app) throw new Error(JSON.stringify(compiled.findings));
    const at = (n: number) => "x".repeat(n);
    const cases: [string, GraphSnapshot, GraphSnapshot][] = [
      ["string", { nodes: [{ ...change, title: at(STRING_MAX) }], edges: [] }, { nodes: [{ ...change, title: at(STRING_MAX + 1) }], edges: [] }],
      ["text", { nodes: [{ ...zone, description: at(TEXT_MAX) }], edges: [] }, { nodes: [{ ...zone, description: at(TEXT_MAX + 1) }], edges: [] }],
      ["list", { nodes: [{ ...task, tags: Array.from({ length: LIST_MAX }, (_, i) => `t${i}`) }], edges: [] }, { nodes: [{ ...task, tags: Array.from({ length: LIST_MAX + 1 }, (_, i) => `t${i}`) }], edges: [] }],
      ["list item", { nodes: [{ ...task, tags: [at(STRING_MAX)] }], edges: [] }, { nodes: [{ ...task, tags: [at(STRING_MAX + 1)] }], edges: [] }],
    ];
    for (const [what, fits, over] of cases) {
      expect(validateGraph(compiled.app, structuredClone(fits)), `${what} at the cap: validateGraph`).toEqual([]);
      expect(fitSnapshot(doc, fits), `${what} at the cap: fit`).toEqual([]);
      expect(validateGraph(compiled.app, structuredClone(over)).length, `${what} past the cap: validateGraph`).toBeGreaterThan(0);
      expect(fitSnapshot(doc, over).length, `${what} past the cap: fit`).toBeGreaterThan(0);
    }
  });

  it("cuts a string at the cap without splitting a surrogate pair", () => {
    const nodes = [{ id: "c11", kind: "change", title: `${"t".repeat(STRING_MAX - 2)}\u{1F600}tail`, status: "pending" }];
    clampToCaps(doc, nodes);
    const title = nodes[0]!.title;
    expect(title.length).toBeLessThanOrEqual(STRING_MAX);
    expect(title.endsWith("…")).toBe(true);
    expect(title.isWellFormed()).toBe(true);
  });

  it("admits a run or a commit for the area a v1 epic becomes, and leaves out a blocker that names one", async () => {
    const root = makeProject({ prd: "v1" });
    roots.push(root);
    const layout = resolveLayout(root);
    const EPIC = "11111111-1111-1111-1111-111111111111";
    writeFileSync(join(layout.henchDir, "runs", "run-epic.json"), JSON.stringify(runRecord("run-epic", EPIC, { commits: [] })));
    const blocked = join(layout.rexDir, "prd_tree", "auth-platform-11111111", "login-flow-22222222", "password-login-33333333", "index.md");
    writeFileSync(blocked, readFileSync(blocked, "utf-8").replace('"dep-password-policy"', `"${EPIC}"`));

    const warn = vi.fn();
    const report = await buildSnapshot(layout, { warn, cacheDir: join(root, "cache") });
    expect(report.productLayer).toBe("proposed");
    expect(report.snapshot.nodes.find((n) => n.id === EPIC)?.kind).toBe("area");
    // The edge stays, and the declaration admits it: narrowing ranFor again fails here.
    expect(report.snapshot.edges).toContainEqual({ kind: "ranFor", from: "run-epic", to: EPIC });
    expect(report.snapshot.edges.some((e) => e.kind === "blockedBy" && e.to === EPIC)).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^1 blockedBy reference names a product node.*33333333-3333-3333-3333-333333333333 -> 11111111/));
    expect(fitSnapshot(doc, report.snapshot), describeMisfits(fitSnapshot(doc, report.snapshot))).toEqual([]);
  });

  it("cuts what the sources wrote to Graview's caps, so a valid PRD never fails check for its length", () => {
    const nodes = [
      { id: "c9", kind: "change", title: "t".repeat(STRING_MAX + 40), status: "pending", tags: ["ok", "x".repeat(STRING_MAX + 1)] },
      { id: "z9", kind: "zone", name: "Big", description: "d".repeat(TEXT_MAX + 1), entryPoints: Array.from({ length: LIST_MAX + 13 }, (_, i) => `src/${i}.ts`) },
      { id: "c10", kind: "change", title: "Short", status: "pending" },
    ];
    const cut = clampToCaps(doc, nodes);
    expect([...cut.keys()].sort()).toEqual(["change.tags", "change.title", "zone.description", "zone.entryPoints"]);
    expect((nodes[0]!.title as string).length).toBe(STRING_MAX);
    expect((nodes[0]!.title as string).endsWith("…")).toBe(true);
    expect((nodes[0]!.tags as string[])[1]!.length).toBe(STRING_MAX);
    expect((nodes[1]!.description as string).length).toBe(TEXT_MAX);
    expect((nodes[1]!.entryPoints as string[]).length).toBe(LIST_MAX);
    expect(nodes[2]!.title).toBe("Short");
    expect(fitSnapshot(doc, { nodes, edges: [] })).toEqual([]);
  });

  it("builds a snapshot that fits from a zone with more entry points and a longer description than Graview takes, and says so", async () => {
    const root = makeProject();
    roots.push(root);
    const layout = resolveLayout(root);
    const zones = structuredClone(ZONES);
    zones.zones[1]!.description = "d".repeat(TEXT_MAX + 5);
    zones.zones[1]!.entryPoints = Array.from({ length: LIST_MAX + 1 }, (_, i) => `src/catalog/${String(i).padStart(3, "0")}.ts`);
    writeFileSync(join(layout.sourcevisionDir, "zones.json"), JSON.stringify(zones));
    const warn = vi.fn();
    const report = await buildSnapshot(layout, { warn, cacheDir: join(root, "cache") });
    const catalog = report.snapshot.nodes.find((n) => n.id === "catalog")!;
    expect((catalog.entryPoints as string[]).length).toBe(LIST_MAX);
    expect((catalog.description as string).length).toBe(TEXT_MAX);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^cut to Graview's length caps .*zone\.description \(1\).*zone\.entryPoints \(1\)/));
    expect(fitSnapshot(doc, report.snapshot)).toEqual([]);
  });

  it("holds an integer to what Graview can hold: a whole number past 2^53 is not one", () => {
    const said = fitSnapshot(doc, { nodes: [{ ...zone, fileCount: 2 ** 53 + 2 }], edges: [] }).map((m) => m.message);
    expect(said).toEqual([expect.stringMatching(/^zone\.fileCount is \d+, not a whole number Graview can hold$/)]);
  });
});
