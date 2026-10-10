import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolveLayout } from "../../src/llm-gateway.js";
import { buildSnapshot } from "../../src/snapshot.js";
import { canonicalJson } from "../../src/canonical.js";
import { loadDocument, declaredEdges } from "../../src/document.js";
import { COMPONENT_PREFIX, FILE_PREFIX } from "../../src/sources/code.js";
import { makeProject, runRecord } from "../helpers/project.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(options: Parameters<typeof makeProject>[0] = {}): string {
  const root = makeProject(options);
  roots.push(root);
  return root;
}

const quiet = { warn: () => {} };

describe("buildSnapshot", () => {
  it("projects a v2 tree, the code and the runs, with ids n-dx already uses", async () => {
    const root = project();
    const { snapshot, counts, layout } = await buildSnapshot(resolveLayout(root), quiet);
    expect(layout).toBe("v2");
    const kinds = new Set(snapshot.nodes.map((n) => n.kind));
    for (const kind of ["area", "capability", "change", "zone", "component", "run", "commit"]) expect(kinds.has(kind), kind).toBe(true);
    expect(counts.zone).toBe(3);
    expect(counts.component).toBe(2);
    expect(counts.run).toBe(2);
    expect(counts.file).toBeUndefined();

    const byId = new Map(snapshot.nodes.map((n) => [n.id, n]));
    const capability = snapshot.nodes.find((n) => n.kind === "capability")!;
    expect(capability.intentStatus).toBeDefined();
    expect(capability.health).toBeDefined();
    const change = snapshot.nodes.find((n) => n.kind === "change")!;
    expect(change.changeKind).toBeDefined();
    expect(typeof change.inbox).toBe("boolean");

    // The sub-zone sits under its parent; the component in a zone's file points at the deepest zone; the loose one has no zone.
    expect(snapshot.edges).toContainEqual({ kind: "under", from: "checkout-wallets", to: "checkout" });
    expect(snapshot.edges).toContainEqual({ kind: "inZone", from: `${COMPONENT_PREFIX}src/checkout/pay.ts#PayButton`, to: "checkout" });
    expect(snapshot.edges.filter((e) => e.from === `${COMPONENT_PREFIX}src/elsewhere/Loose.tsx#Loose`)).toEqual([]);
    expect(snapshot.edges.filter((e) => e.kind === "crosses")).toEqual([{ kind: "crosses", from: "checkout", to: "catalog" }]);

    // One record per run id; the .json wins over its .json.gz twin; the hidden temp file is skipped.
    expect(byId.get("run-1")!.turns).toBe(7);
    expect(byId.get("run-2")!.status).toBe("completed");
    expect(byId.get("a".repeat(40))).toMatchObject({ kind: "commit", subject: "Do the thing" });
    expect(snapshot.edges).toContainEqual({ kind: "produced", from: "run-1", to: "a".repeat(40) });
    // A run for a task the tree does not have keeps its node and loses the edge.
    expect(snapshot.edges.filter((e) => e.kind === "ranFor")).toEqual([]);
  });

  it("only emits edges whose ends exist, and edges only on the kind that declares them", async () => {
    const root = project();
    const { snapshot } = await buildSnapshot(resolveLayout(root), quiet);
    const ids = new Set(snapshot.nodes.map((n) => n.id));
    const kindOf = new Map(snapshot.nodes.map((n) => [n.id, n.kind]));
    const declared = declaredEdges(loadDocument());
    for (const edge of snapshot.edges) {
      expect(ids.has(edge.from), `${edge.kind} from ${edge.from}`).toBe(true);
      expect(ids.has(edge.to), `${edge.kind} to ${edge.to}`).toBe(true);
      expect(declared.get(edge.kind)?.has(kindOf.get(edge.from)!), `${kindOf.get(edge.from)} does not declare ${edge.kind}`).toBe(true);
    }
    const doc = loadDocument();
    for (const node of snapshot.nodes) {
      const kind = doc.kinds[node.kind]!;
      expect(kind, node.kind).toBeDefined();
      for (const field of Object.keys(node)) {
        if (field === "id" || field === "kind") continue;
        expect(kind.fields[field], `${node.kind}.${field} is not declared`).toBeDefined();
      }
    }
  });

  it("is byte-identical across two builds of the same checkout", async () => {
    const root = project();
    const a = await buildSnapshot(resolveLayout(root), quiet);
    const b = await buildSnapshot(resolveLayout(root), quiet);
    expect(canonicalJson(a.snapshot)).toBe(canonicalJson(b.snapshot));
    const kinds = a.snapshot.nodes.map((n) => n.kind);
    expect(kinds).toEqual([...kinds].sort());
  });

  it("projects file nodes only when asked", async () => {
    const root = project();
    const layout = resolveLayout(root);
    const without = await buildSnapshot(layout, quiet);
    expect(without.snapshot.nodes.some((n) => n.kind === "file")).toBe(false);
    const withFiles = await buildSnapshot(layout, { ...quiet, files: true });
    expect(withFiles.counts.file).toBe(2);
    expect(withFiles.snapshot.edges).toContainEqual({ kind: "inZone", from: `${FILE_PREFIX}src/catalog/list.ts`, to: "catalog" });
  });

  it("reads a v1 tree as changes only, with no product layer", async () => {
    const root = project({ prd: "v1", layout: "ndx" });
    const { snapshot, layout, counts } = await buildSnapshot(resolveLayout(root), quiet);
    expect(layout).toBe("v1");
    expect(counts.area).toBeUndefined();
    expect(counts.capability).toBeUndefined();
    const changes = snapshot.nodes.filter((n) => n.kind === "change");
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.some((c) => c.level === "epic")).toBe(true);
    expect(snapshot.edges.some((e) => e.kind === "under" && e.from !== e.to)).toBe(true);
  });

  it("still projects a project with no analysis and no runs", async () => {
    const root = project({ sourcevision: false, runs: false });
    const { snapshot, counts } = await buildSnapshot(resolveLayout(root), quiet);
    expect(counts.zone).toBeUndefined();
    expect(counts.run).toBeUndefined();
    expect(snapshot.nodes.length).toBeGreaterThan(0);
  });

  it("links a run to the task it worked and a change to its releases", async () => {
    const root = project({ runs: false });
    const layout = resolveLayout(root);
    const before = await buildSnapshot(layout, quiet);
    const change = before.snapshot.nodes.find((n) => n.kind === "change")!;
    const runs = join(layout.henchDir, "runs");
    mkdirSync(runs, { recursive: true });
    writeFileSync(join(runs, "run-3.json"), JSON.stringify(runRecord("run-3", change.id)));
    const after = await buildSnapshot(layout, quiet);
    expect(after.snapshot.edges).toContainEqual({ kind: "ranFor", from: "run-3", to: change.id });
    const releases = after.snapshot.nodes.filter((n) => n.kind === "release");
    for (const release of releases) {
      expect(after.snapshot.edges.some((e) => (e.kind === "plannedFor" || e.kind === "shippedWith") && e.to === release.id)).toBe(true);
    }
  });

  it("warns and carries on when realized-by needs a git repository it does not have", async () => {
    const root = project();
    const report = await buildSnapshot(resolveLayout(root), quiet);
    expect(report.snapshot.edges.some((e) => e.kind === "realizedIn")).toBe(false);
    expect(report.warnings.some((w) => w.startsWith("Realized-by edges skipped"))).toBe(true);
    // And wrote nothing under the rex, sourcevision or hench directories while trying.
    const layout = resolveLayout(root);
    expect(() => readFileSync(join(layout.rexDir, ".cache", "trailer-commits.json"))).toThrow();
  });
});
