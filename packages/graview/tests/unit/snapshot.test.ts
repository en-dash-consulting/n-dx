import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
    const doc = loadDocument();
    const declared = declaredEdges(doc);
    for (const edge of snapshot.edges) {
      expect(ids.has(edge.from), `${edge.kind} from ${edge.from}`).toBe(true);
      expect(ids.has(edge.to), `${edge.kind} to ${edge.to}`).toBe(true);
      expect(declared.get(edge.kind)?.has(kindOf.get(edge.from)!), `${kindOf.get(edge.from)} does not declare ${edge.kind}`).toBe(true);
      // ...and only towards a kind that edge admits: the store refuses an edge to an undeclared target.
      const to = (doc.kinds[kindOf.get(edge.from)!]?.edges?.[edge.kind] as { to?: string[] } | undefined)?.to ?? [];
      expect(to, `${kindOf.get(edge.from)}.${edge.kind} does not admit ${kindOf.get(edge.to)}`).toContain(kindOf.get(edge.to));
    }
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

  it("draws the product layer rex's migration plan proposes for a v1 tree, every node marked proposed", async () => {
    const root = project({ prd: "v1", layout: "ndx" });
    const { snapshot, layout, productLayer } = await buildSnapshot(resolveLayout(root), quiet);
    expect(layout).toBe("v1");
    expect(productLayer).toBe("proposed");
    // The fixture's epic "Auth Platform" is an area; its feature "Login Flow" has completed work
    // under it, so it is a capability, and the task "Password Login" a change placed on it.
    const area = snapshot.nodes.find((n) => n.kind === "area");
    expect(area).toMatchObject({ title: "Auth Platform", proposed: true });
    const product = snapshot.nodes.filter((n) => n.kind === "area" || n.kind === "capability" || n.kind === "constraint");
    expect(product.every((n) => n.proposed === true)).toBe(true);
    const login = snapshot.nodes.find((n) => n.title === "Login Flow");
    expect(login).toMatchObject({ kind: "capability", proposed: true });
    expect(snapshot.edges).toContainEqual({ kind: "under", from: login!.id, to: area!.id });
    const password = snapshot.nodes.find((n) => n.title === "Password Login");
    expect(password).toMatchObject({ kind: "change" });
    const placed = snapshot.edges.find((e) => e.from === password!.id && e.to === login!.id);
    expect(["amends", "touches"]).toContain(placed?.kind);
    // Changes keep rex's ids and say nothing of being proposed: they are the tree's own items.
    expect(password!.proposed).toBeUndefined();
  });

  it("reads a v1 tree as changes only when told not to propose", async () => {
    const root = project({ prd: "v1", layout: "ndx" });
    const { snapshot, layout, counts, productLayer } = await buildSnapshot(resolveLayout(root), { ...quiet, proposeProductLayer: false });
    expect(layout).toBe("v1");
    expect(productLayer).toBe("none");
    expect(counts.area).toBeUndefined();
    expect(counts.capability).toBeUndefined();
    const changes = snapshot.nodes.filter((n) => n.kind === "change");
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.some((c) => c.level === "epic")).toBe(true);
    expect(snapshot.edges.some((e) => e.kind === "under" && e.from !== e.to)).toBe(true);
  });

  it("never proposes over a v2 tree", async () => {
    const root = project();
    const { productLayer, snapshot } = await buildSnapshot(resolveLayout(root), quiet);
    expect(productLayer).toBe("stored");
    expect(snapshot.nodes.filter((n) => n.kind === "capability").every((n) => n.proposed === undefined)).toBe(true);
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

  it("projects the N-DX-Item commits on main and the release a finished change landed in, from git", async () => {
    const root = project({ runs: false });
    const layout = resolveLayout(root);
    const change = "c0000000-0000-4000-8000-000000000001";
    const state = join(layout.rexDir, "changes", "add-apple-pay", "state.yaml");
    writeFileSync(state, readFileSync(state, "utf-8").replace('status: "in_progress"', 'status: "completed"'));

    let clock = 0;
    const git = (...args: string[]): string => {
      clock += 1;
      const date = new Date(Date.UTC(2026, 9, 1, 0, clock)).toISOString();
      const env = { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: "Pat", GIT_AUTHOR_EMAIL: "p@test", GIT_COMMITTER_NAME: "Pat", GIT_COMMITTER_EMAIL: "p@test" };
      return execFileSync("git", args, { cwd: root, encoding: "utf-8", env }).trim();
    };
    const commit = (file: string, message: string): string => {
      writeFileSync(join(root, file), `${file}\n`);
      writeFileSync(join(root, ".msg"), message);
      git("add", file);
      git("commit", "-q", "-F", ".msg");
      return git("rev-parse", "HEAD");
    };
    git("init", "-q", "--initial-branch=main");
    writeFileSync(join(root, ".gitignore"), ".msg\n");
    commit("README.md", "start");
    git("tag", "@shop/core@1.1.0");
    const landed = commit("pay.ts", `Add Apple Pay\n\nN-DX-Item: ${change}`);
    git("tag", "@shop/core@1.2.0");
    git("tag", "@shop/web@1.2.0");
    const unreleased = commit("later.ts", `Polish\n\nN-DX-Item: ${change}`);
    commit("nothing.ts", "N-DX-Item: 00000000-0000-4000-8000-00000000dead\n\nN-DX-Item: 00000000-0000-4000-8000-00000000dead");

    const report = await buildSnapshot(layout, quiet);
    const { nodes, edges } = report.snapshot;
    expect(report.warnings).toEqual([]);
    const commits = nodes.filter((n) => n.kind === "commit");
    expect(commits.map((c) => c.id).sort()).toEqual([landed, unreleased].sort());
    expect(commits.find((c) => c.id === landed)).toMatchObject({ sha: landed, subject: "Add Apple Pay", author: "Pat", committedAt: expect.stringMatching(/^2026-10-01T/) });
    expect(edges).toContainEqual({ kind: "landedFor", from: landed, to: change });
    expect(edges).toContainEqual({ kind: "landedFor", from: unreleased, to: change });
    // The change landed with its last commit, which no release tag contains yet: not shipped.
    expect(edges.some((e) => e.kind === "shippedWith" && e.from === change)).toBe(false);

    git("tag", "@shop/core@1.3.0");
    const shipped = await buildSnapshot(layout, quiet);
    expect(shipped.snapshot.edges).toContainEqual({ kind: "shippedWith", from: change, to: "release:1.3.0" });
    const release = shipped.snapshot.nodes.find((n) => n.id === "release:1.3.0");
    expect(release).toMatchObject({ kind: "release", version: "1.3.0", shippedChanges: 1, plannedChanges: 0, taggedAt: expect.stringMatching(/^2026-10-01T/) });
    // Every release tag is a release, the monorepo's two 1.2.0 tags one of them, shipped or not.
    expect(shipped.snapshot.nodes.filter((n) => n.kind === "release").map((n) => n.version).sort()).toEqual(["1.1.0", "1.2.0", "1.3.0"]);
    // The caches went under the graview dir, not rex's.
    expect(() => readFileSync(join(layout.rexDir, ".cache", "trailer-commits.json"))).toThrow();
    expect(readFileSync(join(layout.graviewDir, "cache", "trailer-commits.json"), "utf-8")).toContain(landed);
  });

  it("warns and carries on when the commits need a git repository it does not have", async () => {
    const root = project();
    const report = await buildSnapshot(resolveLayout(root), quiet);
    expect(report.snapshot.edges.some((e) => e.kind === "realizedIn")).toBe(false);
    expect(report.snapshot.edges.some((e) => e.kind === "landedFor")).toBe(false);
    expect(report.warnings.some((w) => w.startsWith("Commits and releases from git skipped"))).toBe(true);
    expect(report.warnings.some((w) => w.startsWith("Realized-by edges skipped"))).toBe(true);
    // And wrote nothing under the rex, sourcevision or hench directories while trying.
    const layout = resolveLayout(root);
    expect(() => readFileSync(join(layout.rexDir, ".cache", "trailer-commits.json"))).toThrow();
  });
});
