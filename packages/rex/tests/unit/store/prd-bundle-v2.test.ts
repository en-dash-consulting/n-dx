/**
 * Bundle envelope v2: a v2 tree round-trips export then import, a v1 bundle
 * imports into a v2 tree's change layer, and every rejection happens before
 * a write.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { BundleError, buildBundle } from "../../../src/core/prd-bundle.js";
import { loadPrdModel } from "../../../src/store/prd-model-reader.js";
import {
  BUNDLE_VERSION_V2,
  exportV2Bundle,
  hasV2Tree,
  importBundleIntoV2,
  mergeV2Tree,
  parseAnyBundle,
  v1ItemsToNodes,
  type BundleNodeV2,
  type PRDBundleV2,
} from "../../../src/store/prd-bundle-v2.js";
import type { PRDItem } from "../../../src/schema/index.js";
import type { RuleNode, V2Tree } from "../../../src/schema/v2-rules.js";
import { copyV2Fixture, editText } from "../../helpers/v2-fixture.js";

const AREA = "a0000000-0000-4000-8000-000000000001";
const CAPABILITY = "a0000000-0000-4000-8000-000000000002";
const CHANGE = "c0000000-0000-4000-8000-000000000001";
const TASK = "c0000000-0000-4000-8000-000000000002";

const EPIC = "11111111-1111-4111-8111-111111111111";
const FEATURE = "22222222-2222-4222-8222-222222222222";
const V1_TASK = "33333333-3333-4333-8333-333333333333";
const SUBTASK = "44444444-4444-4444-8444-444444444444";

const quiet = { env: {}, warn: () => {} };

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "rex-bundle-v2-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/** An empty v2 tree: a root header and nothing else. */
async function emptyV2Tree(name: string): Promise<string> {
  const rexDir = join(tmp, name);
  await mkdir(join(rexDir, "product"), { recursive: true });
  await writeFile(join(rexDir, "product", "index.md"), '---\ntitle: "Empty"\nschema: "rex/v2"\n---\n');
  return rexDir;
}

/** Every tree file under `dir`, relative, with its text. The lock and other dotfiles are skipped. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (d: string): Promise<void> => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "prd.lock") continue;
      const p = join(d, entry.name);
      if (entry.isDirectory()) await walk(p);
      else out[relative(dir, p).split("\\").join("/")] = await readFile(p, "utf-8");
    }
  };
  await walk(dir);
  return out;
}

/** Export as a file would carry it: through JSON and back. */
async function exportedJson(rexDir: string): Promise<unknown> {
  const { bundle } = await exportV2Bundle(rexDir, { exportedAt: "2026-10-08T00:00:00.000Z" });
  return JSON.parse(JSON.stringify(bundle));
}

function v1Items(): PRDItem[] {
  return [
    {
      id: EPIC,
      level: "epic",
      title: "Gift cards",
      status: "in_progress",
      children: [
        {
          id: FEATURE,
          level: "feature",
          title: "Redeem a card",
          status: "pending",
          children: [
            {
              id: V1_TASK,
              level: "task",
              title: "Validate the code",
              status: "completed",
              priority: "high",
              acceptanceCriteria: ["Rejects an unknown code"],
              children: [{ id: SUBTASK, level: "subtask", title: "Checksum", status: "pending" }],
            },
          ],
        },
      ],
    },
  ] as PRDItem[];
}

function v1Bundle(): unknown {
  const bundle = buildBundle({ schema: "rex/v1", title: "Gift shop", items: v1Items() }, { exportedAt: "2026-10-08T00:00:00.000Z" });
  return JSON.parse(JSON.stringify(bundle));
}

function v2Bundle(tree: { product?: BundleNodeV2[]; changes?: BundleNodeV2[] }, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    bundle: "rex/prd-bundle",
    bundleVersion: BUNDLE_VERSION_V2,
    schema: "rex/v2",
    title: "T",
    exportedAt: "2026-10-08T00:00:00.000Z",
    product: tree.product ?? [],
    changes: tree.changes ?? [],
    ...extra,
  };
}

function node(fields: Partial<RuleNode> & { id: string; type: RuleNode["type"]; slug: string }): RuleNode {
  return { title: fields.slug, ...fields } as RuleNode;
}

function find(nodes: readonly RuleNode[], id: string): RuleNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = find(n.children ?? [], id);
    if (hit) return hit;
  }
  return undefined;
}

function findBundled(nodes: readonly BundleNodeV2[], id: string): BundleNodeV2 | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findBundled(n.children ?? [], id);
    if (hit) return hit;
  }
  return undefined;
}

describe("envelope v2 round trip", () => {
  it("exports both layers and the header", async () => {
    const src = await copyV2Fixture(join(tmp, "src"), "lf");
    const bundle = (await exportedJson(src)) as PRDBundleV2;
    expect(bundle).toMatchObject({ bundle: "rex/prd-bundle", bundleVersion: 2, schema: "rex/v2", title: "Fixture shop" });
    expect(bundle.header).toEqual({ stewards: ["@shop/core"], body: "The product layer of a small shop." });
    expect(bundle.product.map((n) => n.id)).toEqual([AREA]);
    expect(bundle.changes.map((n) => n.id)).toEqual([CHANGE]);
    const capability = findBundled(bundle.product, CAPABILITY);
    expect(capability).toMatchObject({ statement: expect.any(String), state: { status: "completed", reviewedHash: expect.any(String) } });
    expect(capability).not.toHaveProperty("status");
  });

  it("imports into an empty v2 tree byte-identically to the source", async () => {
    const src = await copyV2Fixture(join(tmp, "src"), "lf");
    const dest = await emptyV2Tree("dest");
    const outcome = await importBundleIntoV2(dest, parseAnyBundle(await exportedJson(src)), "merge");
    expect(outcome).toMatchObject({ added: 4, replaced: 0, collisions: [] });
    expect(await snapshot(dest)).toEqual(await snapshot(src));
  });

  it("replace swaps both layers and adopts the title and header", async () => {
    const src = await copyV2Fixture(join(tmp, "src"), "lf");
    const dest = await emptyV2Tree("dest");
    await importBundleIntoV2(dest, parseAnyBundle(v1Bundle()), "merge");
    const outcome = await importBundleIntoV2(dest, parseAnyBundle(await exportedJson(src)), "replace");
    expect(outcome).toMatchObject({ added: 4, replaced: 4 });
    expect(await snapshot(dest)).toEqual(await snapshot(src));
  });

  it("keeps a state.yaml key this build does not declare in state.yaml, not frontmatter", async () => {
    const src = await copyV2Fixture(join(tmp, "src"), "lf");
    // After the declared keys, where the canonical writer puts an unknown one.
    await editText(join(src, "changes", "add-apple-pay", "state.yaml"), (text) =>
      text.replace(/( {4}prs: .*\n)/, '$1    futureField: "x"\n'),
    );
    const bundle = (await exportedJson(src)) as PRDBundleV2;
    expect(bundle.changes[0]).toMatchObject({ id: CHANGE, state: { futureField: "x", status: "in_progress" } });
    expect(bundle.changes[0]).not.toHaveProperty("futureField");

    const dest = await emptyV2Tree("dest");
    await importBundleIntoV2(dest, parseAnyBundle(bundle), "merge");
    const files = await snapshot(dest);
    expect(files["changes/add-apple-pay/state.yaml"]).toContain('futureField: "x"');
    expect(files["changes/add-apple-pay/index.md"]).not.toContain("futureField");
    expect(files).toEqual(await snapshot(src));
  });

  it("keeps a state.yaml's own top-level keys in the same folder's file", async () => {
    const src = await copyV2Fixture(join(tmp, "src"), "lf");
    // At indentation zero, after items: a folder node's file and a layer root's.
    await editText(join(src, "changes", "add-apple-pay", "state.yaml"), (text) => `${text}futureTop: {"retain":true}\n`);
    await writeFile(join(src, "product", "state.yaml"), 'schema: "rex/v2"\nitems: {}\nlayerTop: 1\n');
    const bundle = (await exportedJson(src)) as PRDBundleV2;
    expect(bundle.folderState).toEqual({
      layers: { product: { layerTop: 1 } },
      nodes: { [CHANGE]: { futureTop: { retain: true } } },
    });

    const dest = await emptyV2Tree("dest");
    await importBundleIntoV2(dest, parseAnyBundle(bundle), "merge");
    const files = await snapshot(dest);
    expect(files["changes/add-apple-pay/state.yaml"]).toContain('futureTop: {"retain":true}');
    expect(files["product/state.yaml"]).toContain("layerTop: 1");
    expect(files).toEqual(await snapshot(src));
  });

  it("refuses to export top-level keys from a childless area folder, which the writer stores as a leaf", async () => {
    const src = await copyV2Fixture(join(tmp, "src"), "lf");
    await rm(join(src, "product", "checkout", "pay-by-card.md"));
    await editText(join(src, "product", "checkout", "state.yaml"), (text) => `${text}futureTop: 1\n`);
    await expect(exportV2Bundle(src)).rejects.toThrow(/product\/checkout\/ \(futureTop\).*Add a child back/s);
  });

  it("carries top-level keys from a childless change, which is always a folder", async () => {
    const src = await copyV2Fixture(join(tmp, "src"), "lf");
    await rm(join(src, "changes", "add-apple-pay", "wire-the-button.md"));
    await editText(join(src, "changes", "add-apple-pay", "state.yaml"), (text) => `${text}futureTop: 1\n`);
    const bundle = (await exportedJson(src)) as PRDBundleV2;
    expect(bundle.folderState).toEqual({ nodes: { [CHANGE]: { futureTop: 1 } } });

    const dest = await emptyV2Tree("dest");
    await importBundleIntoV2(dest, parseAnyBundle(bundle), "merge");
    expect(await snapshot(dest)).toEqual(await snapshot(src));
  });

  it("omits folderState when no state.yaml has extra top-level keys", async () => {
    const bundle = (await exportedJson(await copyV2Fixture(join(tmp, "src"), "lf"))) as PRDBundleV2;
    expect(bundle).not.toHaveProperty("folderState");
  });

  it("keeps a local folder's top-level keys over the bundle's on merge", async () => {
    const src = await copyV2Fixture(join(tmp, "src"), "lf");
    const before = await snapshot(src);
    const bundle = { ...(await exportedJson(src) as PRDBundleV2), folderState: { nodes: { [CHANGE]: { futureTop: 1 } } } };
    await importBundleIntoV2(src, parseAnyBundle(bundle), "merge");
    expect(await snapshot(src)).toEqual(before);
  });

  it("round-trips a root header key this build does not declare", async () => {
    const src = await copyV2Fixture(join(tmp, "src"), "lf");
    await editText(join(src, "product", "index.md"), (text) => text.replace('---\n\n', 'futureHeader: {"x":1}\n---\n\n'));
    const bundle = (await exportedJson(src)) as PRDBundleV2;
    expect(bundle.header).toMatchObject({ futureHeader: { x: 1 } });

    const dest = await emptyV2Tree("dest");
    await importBundleIntoV2(dest, parseAnyBundle(bundle), "merge");
    expect(await snapshot(dest)).toEqual(await snapshot(src));
  });

  it("refuses to export a node whose own field is named state, which the envelope reserves", async () => {
    const src = await copyV2Fixture(join(tmp, "src"), "lf");
    await editText(join(src, "changes", "add-apple-pay", "index.md"), (text) =>
      text.replace('priority: "high"\n', 'priority: "high"\nstate: "draft"\n'),
    );
    await expect(exportV2Bundle(src)).rejects.toThrow(/"state".*reserve/);
  });

  it("re-importing reports identical collisions and writes nothing new", async () => {
    const src = await copyV2Fixture(join(tmp, "src"), "lf");
    const before = await snapshot(src);
    const outcome = await importBundleIntoV2(src, parseAnyBundle(await exportedJson(src)), "merge");
    expect(outcome.added).toBe(0);
    expect(outcome.collisions.map((c) => c.kind)).toEqual(["identical", "identical", "identical", "identical"]);
    expect(await snapshot(src)).toEqual(before);
  });
});

describe("a v1 bundle into a v2 tree", () => {
  it("lands in the change layer with types mapped, state kept, product untouched", async () => {
    const dest = await copyV2Fixture(join(tmp, "dest"), "lf");
    const outcome = await importBundleIntoV2(dest, parseAnyBundle(v1Bundle()), "merge");
    expect(outcome).toMatchObject({ added: 4, collisions: [] });

    const model = await loadPrdModel(dest, quiet);
    expect(model.warnings).toEqual([]);
    expect(model.title).toBe("Fixture shop");
    expect(model.tree.product.map((n) => n.id)).toEqual([AREA]);
    expect(model.tree.changes.map((n) => n.id).sort()).toEqual([CHANGE, EPIC].sort());
    expect(find(model.tree.changes, EPIC)).toMatchObject({ type: "change", slug: "gift-cards", status: "in_progress", level: "epic" });
    expect(find(model.tree.changes, FEATURE)).toMatchObject({ type: "change", slug: "redeem-a-card" });
    expect(find(model.tree.changes, V1_TASK)).toMatchObject({
      type: "task",
      status: "completed",
      priority: "high",
      acceptanceCriteria: ["Rejects an unknown code"],
    });
    expect(find(model.tree.changes, SUBTASK)).toMatchObject({ type: "subtask", slug: "checksum" });
  });

  it("adopts the bundle title into an empty v2 tree", async () => {
    const dest = await emptyV2Tree("dest");
    await importBundleIntoV2(dest, parseAnyBundle(v1Bundle()), "merge");
    expect((await loadPrdModel(dest, quiet)).title).toBe("Gift shop");
  });

  it("replace swaps the change layer only, keeping the product layer and title", async () => {
    const dest = await copyV2Fixture(join(tmp, "dest"), "lf");
    const outcome = await importBundleIntoV2(dest, parseAnyBundle(v1Bundle()), "replace");
    expect(outcome).toMatchObject({ added: 4, replaced: 2 });

    const model = await loadPrdModel(dest, quiet);
    expect(model.title).toBe("Fixture shop");
    expect(find(model.tree.product, CAPABILITY)).toBeDefined();
    expect(model.tree.changes.map((n) => n.id)).toEqual([EPIC]);
    expect(find(model.tree.changes, TASK)).toBeUndefined();
  });

  it("maps levels to types and resolves sibling slugs by the v1 rule", () => {
    const twins = [
      { id: EPIC, level: "epic", title: "Same", status: "pending" },
      { id: FEATURE, level: "epic", title: "Same", status: "pending" },
    ] as PRDItem[];
    const nodes = v1ItemsToNodes(twins);
    expect(nodes.map((n) => n.type)).toEqual(["change", "change"]);
    expect(new Set(nodes.map((n) => n.slug)).size).toBe(2);
  });
});

describe("parseAnyBundle", () => {
  it("hands envelope v1 to the v1 parser", () => {
    const parsed = parseAnyBundle(v1Bundle());
    expect(parsed.version).toBe(1);
  });

  it("refuses a newer envelope, naming the newest this rex reads", () => {
    expect(() => parseAnyBundle({ ...v2Bundle({}), bundleVersion: 3 })).toThrow(/version 3 is newer than this rex supports \(2\)/);
  });

  it("refuses a newer v2 schema and a non-v2 schema", () => {
    expect(() => parseAnyBundle(v2Bundle({}, { schema: "rex/v2.1" }))).toThrow(/newer than this rex supports/);
    expect(() => parseAnyBundle(v2Bundle({}, { schema: "rex/v1" }))).toThrow(/incompatible PRD schema/);
  });

  it("refuses a node with invalid intent or state", () => {
    expect(() => parseAnyBundle(v2Bundle({ changes: [{ id: CHANGE, type: "change", title: "x" } as RuleNode] }))).toThrow(BundleError);
    const bogus = { ...node({ id: CHANGE, type: "change", slug: "x" }), state: { status: "bogus" } };
    expect(() => parseAnyBundle(v2Bundle({ changes: [bogus] }))).toThrow(/invalid node/);
  });

  it("refuses a declared state field outside the state block", () => {
    const misplaced = node({ id: CHANGE, type: "change", slug: "x", status: "completed" });
    expect(() => parseAnyBundle(v2Bundle({ changes: [misplaced] }))).toThrow(/state field "status" outside "state"/);
  });

  it("refuses an intent field inside the state block", () => {
    const misplaced = { ...node({ id: CHANGE, type: "change", slug: "x" }), state: { title: "Moved" } };
    expect(() => parseAnyBundle(v2Bundle({ changes: [misplaced] }))).toThrow(/field "title" inside "state"/);
  });

  it("refuses a node in the wrong layer", () => {
    expect(() => parseAnyBundle(v2Bundle({ product: [node({ id: TASK, type: "task", slug: "t" })] }))).toThrow(/layer/);
  });

  it("refuses a header with invalid root fields", () => {
    expect(() => parseAnyBundle(v2Bundle({}, { header: { requirements: "not-an-array", stewards: 42 } }))).toThrow(
      /not a valid root header: requirements: .*; stewards: /,
    );
    expect(() => parseAnyBundle(v2Bundle({}, { header: { stewards: ["@a", 7] } }))).toThrow(/stewards\.1/);
    expect(() => parseAnyBundle(v2Bundle({}, { header: { body: 3 } }))).toThrow(/"body" that is not a string/);
  });

  it("refuses folderState keys that cannot land back in a state.yaml", () => {
    const change = node({ id: CHANGE, type: "change", slug: "c", children: [node({ id: TASK, type: "task", slug: "t" })] });
    const parse = (folderState: unknown) => () => parseAnyBundle(v2Bundle({ changes: [change] }, { folderState }));
    expect(parse({ nodes: { [TASK]: { x: 1 } } })).toThrow(/not folder nodes in this bundle: c0000000-0000-4000-8000-000000000002/);
    expect(parse({ nodes: { [EPIC]: { x: 1 } } })).toThrow(/not folder nodes/);
    expect(parse({ layers: { roadmap: { x: 1 } } })).toThrow(/names no layer: roadmap/);
    expect(parse({ layers: { changes: { items: {} } } })).toThrow(/holds items, which state.yaml owns/);
    expect(parse({ nodes: { [CHANGE]: "x" } })).toThrow(/must be an object/);
    expect(parse({ other: {} })).toThrow(/unknown keys: other/);
    expect(parseAnyBundle(v2Bundle({ changes: [change] }, { folderState: { nodes: { [CHANGE]: { x: 1 } } } }))).toMatchObject({
      bundle: { folderState: { nodes: { [CHANGE]: { x: 1 } } } },
    });
  });

  it("refuses an id used twice across the layers", () => {
    const bundle = v2Bundle({
      product: [node({ id: AREA, type: "area", slug: "a" })],
      changes: [node({ id: AREA, type: "change", slug: "c" })],
    });
    expect(() => parseAnyBundle(bundle)).toThrow(/same item id twice/);
  });
});

describe("mergeV2Tree", () => {
  const local = (): V2Tree => ({
    product: [node({ id: AREA, type: "area", slug: "checkout" })],
    changes: [node({ id: CHANGE, type: "change", slug: "apple-pay", children: [node({ id: TASK, type: "task", slug: "button" })] })],
  });

  it("grafts unseen children under a known parent and reports differing content", () => {
    const incoming: V2Tree = {
      product: [],
      changes: [
        node({
          id: CHANGE,
          type: "change",
          slug: "apple-pay",
          title: "Renamed",
          children: [node({ id: V1_TASK, type: "task", slug: "new-task" })],
        }),
      ],
    };
    const outcome = mergeV2Tree(local(), incoming, "merge");
    expect(outcome.collisions).toEqual([{ id: CHANGE, title: "Renamed", kind: "differing" }]);
    expect(outcome.tree.changes[0].children?.map((n) => n.id)).toEqual([TASK, V1_TASK]);
    expect(outcome.added).toBe(1);
  });

  it("refuses a grafted node whose slug a sibling already uses", () => {
    const incoming: V2Tree = { product: [], changes: [node({ id: EPIC, type: "change", slug: "Apple-Pay" })] };
    expect(() => mergeV2Tree(local(), incoming, "merge")).toThrow(/already uses the slug/);
  });

  it("refuses a graft that would cross layers under a local node", () => {
    // The bundle's change shares an id with the local area, so its task would land under the area.
    const incoming: V2Tree = {
      product: [],
      changes: [node({ id: AREA, type: "change", slug: "x", children: [node({ id: V1_TASK, type: "task", slug: "t" })] })],
    };
    expect(() => mergeV2Tree(local(), incoming, "merge")).toThrow(/layer/);
  });

  it("replace lists every discarded id for the writer", () => {
    const outcome = mergeV2Tree(local(), { product: [], changes: [] }, "replace", ["changes"]);
    expect([...outcome.removed].sort()).toEqual([CHANGE, TASK].sort());
    expect(outcome.tree.product.map((n) => n.id)).toEqual([AREA]);
  });
});

describe("rejected imports write nothing", () => {
  it("leaves the tree untouched when a merge is refused", async () => {
    const dest = await copyV2Fixture(join(tmp, "dest"), "lf");
    const before = await snapshot(dest);
    const clash = v2Bundle({ changes: [node({ id: EPIC, type: "change", slug: "add-apple-pay" })] });
    await expect(importBundleIntoV2(dest, parseAnyBundle(clash), "merge")).rejects.toThrow(BundleError);
    expect(await snapshot(dest)).toEqual(before);
  });

  it("refuses a bundle with an invalid root header before writing", async () => {
    const src = await copyV2Fixture(join(tmp, "src"), "lf");
    const bundle = { ...(await exportedJson(src) as PRDBundleV2), header: { requirements: "not-an-array", stewards: 42 } };
    const dest = await emptyV2Tree("dest");
    const before = await snapshot(dest);
    await expect(async () => importBundleIntoV2(dest, parseAnyBundle(bundle), "merge")).rejects.toThrow(/not a valid root header/);
    expect(await snapshot(dest)).toEqual(before);
  });
});

describe("hasV2Tree", () => {
  it("reads product/ as the v2 marker", async () => {
    expect(hasV2Tree(join(tmp, "nothing"))).toBe(false);
    expect(hasV2Tree(await emptyV2Tree("v2"))).toBe(true);
  });
});
