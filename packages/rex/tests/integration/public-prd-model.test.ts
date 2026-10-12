/**
 * The v2 PRD model reaches consumers through `src/public.ts` alone.
 *
 * The dashboard's Product and Changes views and the Graview projection both
 * read the product layer, and neither may import `dist/*` or a src path. This
 * test imports nothing but the public surface and loads both layouts through
 * it: a v1 folder tree reads as changes only, a v2 tree gives the product
 * layer with its derived edges and status.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  loadPrdModel,
  prdLayout,
  V1_LEVEL_TYPES,
  indexTree,
  computeEdges,
  computeProductStatus,
  deriveChangeKind,
  productReport,
  prdStatusReport,
  PRODUCT_NODE_TYPES,
  PRD_TREE_DIRNAME,
  type PrdModel,
  type RuleNode,
  type ChangeNode,
} from "../../src/public.js";
import { copyV2Fixture } from "../helpers/v2-fixture.js";

const V1_FIXTURE = resolve(import.meta.dirname, "../fixtures/folder-tree/known-prd");

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "rex-public-model-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const quiet = { warn: () => {} };

function flatten(nodes: readonly RuleNode[]): RuleNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

describe("public API: the PRD model", () => {
  it("reads a v1 folder tree as a changes-only model", async () => {
    const rexDir = join(tmp, ".rex");
    await cp(V1_FIXTURE, join(rexDir, PRD_TREE_DIRNAME), { recursive: true });

    expect(await prdLayout(rexDir)).toBe("v1");
    const model: PrdModel = await loadPrdModel(rexDir, quiet);
    expect(model.layout).toBe("v1");
    expect(model.tree.product).toEqual([]);
    expect(model.tree.changes.length).toBeGreaterThan(0);

    const all = flatten(model.tree.changes);
    for (const node of all) expect(PRODUCT_NODE_TYPES.has(node.type as never)).toBe(false);
    const epic = model.tree.changes[0]!;
    expect(epic.type).toBe(V1_LEVEL_TYPES.epic);
    expect(epic.type).toBe("change");
    const feature = epic.children?.[0];
    expect(feature?.type).toBe(V1_LEVEL_TYPES.feature);

    // The derived computations accept the same model without a product layer.
    expect(computeEdges(model.tree)).toEqual({ changedBy: {}, boundBy: {}, coChanges: {} });
    expect(computeProductStatus(model.tree)).toEqual({});
    expect(productReport(model.tree)).toEqual([]);
    expect(indexTree(model.tree).resolve(epic.id)?.id).toBe(epic.id);
  });

  it("reads a v2 tree with its product layer, edges and status", async () => {
    const rexDir = join(tmp, ".rex");
    await copyV2Fixture(rexDir, "lf");

    expect(await prdLayout(rexDir)).toBe("v2");
    const model = await loadPrdModel(rexDir, quiet);
    expect(model.layout).toBe("v2");
    expect(model.tree.product.length).toBeGreaterThan(0);

    const index = indexTree(model.tree);
    const capabilities = index.entries.filter((e) => e.node.type === "capability");
    expect(capabilities.length).toBeGreaterThan(0);

    const edges = computeEdges(model.tree);
    const status = computeProductStatus(model.tree);
    for (const { node } of capabilities) {
      expect(status[node.id]).toBeDefined();
      expect(Array.isArray(edges.boundBy[node.id] ?? [])).toBe(true);
    }

    const changes = flatten(model.tree.changes).filter((n): n is RuleNode & ChangeNode => n.type === "change");
    expect(changes.length).toBeGreaterThan(0);
    for (const change of changes) expect(deriveChangeKind(change, index)).toBeDefined();

    const report = prdStatusReport(model.tree);
    expect(report).toHaveProperty("changes");
    expect(productReport(model.tree).length).toBe(model.tree.product.length);
  });
});
