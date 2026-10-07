/**
 * Dual-read loader: the v1 folder tree and the v2 product/changes roots read
 * into one model, with unknown schema majors refused unless the read-only
 * override is on.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  IGNORE_SCHEMA_SKEW_ENV,
  IGNORE_SCHEMA_SKEW_FLAG,
  SchemaSkewError,
  assertPrdModelWritable,
  ignoreSchemaSkewRequested,
  loadPrdModel,
  schemaMajor,
  type PrdModel,
} from "../../../src/store/prd-model-reader.js";
import { parseFolderTree } from "../../../src/store/folder-tree-parser.js";
import { FolderTreeStore } from "../../../src/store/folder-tree-store.js";
import { withLock } from "../../../src/store/file-lock.js";
import { PRD_TREE_DIRNAME, prdLockPath } from "../../../src/store/paths.js";
import { loadStateFile, saveStateFile } from "../../../src/store/state-writer.js";
import type { RuleNode } from "../../../src/schema/v2-rules.js";
import type { PRDItem } from "../../../src/schema/index.js";

const REPO_REX_DIR = resolve(import.meta.dirname, "../../../../../.rex");
const V1_FIXTURE = resolve(import.meta.dirname, "../../fixtures/folder-tree/known-prd");
const V2_FIXTURE = resolve(import.meta.dirname, "../../fixtures/v2-tree");
const AREA = "a0000000-0000-4000-8000-000000000001";
const CAPABILITY = "a0000000-0000-4000-8000-000000000002";
const CHANGE = "c0000000-0000-4000-8000-000000000001";
const TASK = "c0000000-0000-4000-8000-000000000002";

const quiet = { env: {}, warn: () => {} };

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "rex-model-reader-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function flatten<T extends { id: string; children?: T[] }>(nodes: T[], parent?: string): Array<{ node: T; parent?: string }> {
  return nodes.flatMap((node) => [{ node, parent }, ...flatten(node.children ?? [], node.id)]);
}

function find(model: PrdModel, id: string): RuleNode {
  const hit = flatten([...model.tree.product, ...model.tree.changes]).find(({ node }) => node.id === id);
  if (!hit) throw new Error(`node ${id} not in model`);
  return hit.node;
}

async function copyFixture(): Promise<string> {
  const rexDir = join(tmp, ".rex");
  await cp(V2_FIXTURE, rexDir, { recursive: true });
  return rexDir;
}

async function restamp(file: string, stamp: string): Promise<void> {
  const text = await readFile(file, "utf-8");
  await writeFile(file, text.replace(/^schema: .*$/m, `schema: "${stamp}"`));
}

describe("v1 tree", () => {
  it("parses this repository's tree to the same items as the v1 parser (golden)", async () => {
    const today = await parseFolderTree(join(REPO_REX_DIR, PRD_TREE_DIRNAME));
    const model = await loadPrdModel(REPO_REX_DIR, quiet);

    expect(model.layout).toBe("v1");
    expect(model.schema).toBe("rex/v1");
    expect(model.tree.product).toEqual([]);

    const before = flatten<PRDItem>(today.items);
    const after = flatten(model.tree.changes);
    expect(before.length).toBeGreaterThan(100);
    expect(after.map(({ node, parent }) => [node.id, parent])).toEqual(before.map(({ node, parent }) => [node.id, parent]));

    const expectedType = { epic: "change", feature: "change", task: "task", subtask: "subtask" } as const;
    after.forEach(({ node }, i) => {
      const { children: _a, type, slug, ...rest } = node;
      const { children: _b, ...item } = before[i].node;
      expect(rest).toEqual(item);
      expect(type).toBe(expectedType[item.level]);
      expect(slug).toBeTruthy();
    });
  });

  it("names each item by its stored folder or file", async () => {
    const model = await loadPrdModel(REPO_REX_DIR, quiet);
    // The epic this task belongs to, stored as product-map-and-change-layer/index.md.
    expect(find(model, "72fe1093-132e-46f1-ad46-af304a453612")).toMatchObject({
      type: "change",
      level: "epic",
      slug: "product-map-and-change-layer",
    });
  });
});

describe("v2 trees", () => {
  it("reads product and changes with intent and state merged", async () => {
    const model = await loadPrdModel(V2_FIXTURE, quiet);

    expect(model).toMatchObject({ layout: "v2", schema: "rex/v2", title: "Fixture shop", warnings: [] });
    expect(model.readOnly).toBeUndefined();

    const [area] = model.tree.product;
    expect(area).toMatchObject({ id: AREA, type: "area", slug: "checkout", status: "in_progress" });
    expect(area.body).toBe("Everything between the basket and the receipt.");
    expect(area.children?.map((n) => n.id)).toEqual([CAPABILITY]);
    expect(find(model, CAPABILITY)).toMatchObject({
      type: "capability",
      status: "completed",
      specReviewed: true,
      criteria: [{ id: "c1", text: "A valid card is charged once" }, { id: "c2", text: "A declined card shows why" }],
    });

    const [change] = model.tree.changes;
    expect(change).toMatchObject({
      id: CHANGE,
      type: "change",
      priority: "high",
      plannedRelease: "1.2.0",
      status: "in_progress",
      startedAt: "2026-10-01T09:00:00.000Z",
      prs: ["https://github.com/example/shop/pull/12"],
    });
    expect(change.amends?.[0]).toMatchObject({ target: CAPABILITY, delta: "modified" });
    // No state row: reads as pending with no stamps.
    expect(change.children).toEqual([
      expect.objectContaining({ id: TASK, type: "task", status: "pending", acceptanceCriteria: ["The button appears on Safari only"] }),
    ]);
    expect(find(model, TASK).startedAt).toBeUndefined();
  });

  it("skips an invalid node and reports orphan state rows", async () => {
    const rexDir = await copyFixture();
    const leaf = join(rexDir, "changes/add-apple-pay/wire-the-button.md");
    await writeFile(leaf, (await readFile(leaf, "utf-8")).replace('type: "task"', 'level: "task"'));

    const model = await loadPrdModel(rexDir, quiet);
    expect(find(model, CHANGE).children).toBeUndefined();
    expect(model.warnings.map((w) => w.message)).toEqual([expect.stringContaining("Invalid node intent")]);

    await writeFile(
      join(rexDir, "changes/add-apple-pay/state.yaml"),
      `schema: "rex/v2"\nitems:\n  "gone":\n    status: "completed"\n`,
    );
    const again = await loadPrdModel(rexDir, quiet);
    expect(again.warnings.map((w) => w.message)).toContainEqual('State row "gone" matches no node in this folder');
  });

  it("refuses a malformed state.yaml rather than reading its nodes as pending", async () => {
    const rexDir = await copyFixture();
    await writeFile(join(rexDir, "product/checkout/state.yaml"), `schema: "rex/v2"\nitems:\n  "x":\n    status: "nope"\n`);
    await expect(loadPrdModel(rexDir, quiet)).rejects.toThrow(/state\.yaml/);
  });
});

describe("schema skew", () => {
  it("refuses an unknown major, naming both versions and the fix", async () => {
    const rexDir = await copyFixture();
    await restamp(join(rexDir, "product/index.md"), "rex/v3");

    const err = await loadPrdModel(rexDir, quiet).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SchemaSkewError);
    const message = (err as Error).message;
    expect(message).toContain("PRD schema is rex/v3");
    expect(message).toContain("this ndx understands up to rex/v2");
    expect(message).toContain("upgrade ndx (or run ndx migrate on the other side)");
    expect(message).toContain(`${IGNORE_SCHEMA_SKEW_ENV}=1`);
    expect(message).toContain(IGNORE_SCHEMA_SKEW_FLAG);
  });

  it("refuses a v1 tree stamped with another major", async () => {
    const rexDir = join(tmp, ".rex");
    await mkdir(join(rexDir, PRD_TREE_DIRNAME), { recursive: true });
    await writeFile(join(rexDir, "tree-meta.json"), JSON.stringify({ title: "T", schema: "rex/v7", slugRule: 2 }));
    await expect(loadPrdModel(rexDir, quiet)).rejects.toThrow("PRD schema is rex/v7");
  });

  it("names a missing v2 stamp and how to add it", async () => {
    const rexDir = await copyFixture();
    const root = join(rexDir, "product/index.md");
    await writeFile(root, (await readFile(root, "utf-8")).replace(/^schema: .*\n/m, ""));
    await expect(loadPrdModel(rexDir, quiet)).rejects.toThrow('PRD schema is missing');
    await expect(loadPrdModel(rexDir, quiet)).rejects.toThrow('stamp it with schema: "rex/v2"');
  });

  it("parses stamps to majors", () => {
    expect(schemaMajor("rex/v2")).toBe(2);
    expect(schemaMajor("rex/v12.3")).toBe(12);
    expect(schemaMajor("v2")).toBeUndefined();
    expect(schemaMajor(undefined)).toBeUndefined();
  });

  it("takes the override from the flag or the environment", () => {
    expect(ignoreSchemaSkewRequested([IGNORE_SCHEMA_SKEW_FLAG], {})).toBe(true);
    expect(ignoreSchemaSkewRequested([], { [IGNORE_SCHEMA_SKEW_ENV]: "1" })).toBe(true);
    expect(ignoreSchemaSkewRequested([], { [IGNORE_SCHEMA_SKEW_ENV]: "0" })).toBe(false);
    expect(ignoreSchemaSkewRequested([], {})).toBe(false);
  });

  describe("with the override", () => {
    it("reads a newer v2 tree with a warning on stderr and refuses every write", async () => {
      const rexDir = await copyFixture();
      await restamp(join(rexDir, "product/index.md"), "rex/v3");
      await restamp(join(rexDir, "changes/add-apple-pay/state.yaml"), "rex/v3");
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      let model: PrdModel;
      try {
        model = await loadPrdModel(rexDir, { env: { [IGNORE_SCHEMA_SKEW_ENV]: "1" } });
        expect(stderr).toHaveBeenCalledWith(
          expect.stringMatching(/^Warning: PRD schema is rex\/v3 .*understands up to rex\/v2\. .*every write is refused\.\n$/),
        );
      } finally {
        stderr.mockRestore();
      }

      expect(model.schema).toBe("rex/v3");
      expect(find(model, CHANGE).status).toBe("in_progress");
      expect(() => assertPrdModelWritable(model)).toThrow(/Writes are refused.*rex\/v3/);

      // The state writer refuses the skewed stamp even inside the lock.
      const folder = join(rexDir, "changes/add-apple-pay");
      const state = await loadStateFile(folder, { ignoreSchemaStamp: true });
      expect(state.schema).toBe("rex/v3");
      await expect(
        withLock(prdLockPath(rexDir), () => saveStateFile(folder, state, { rexDir, specs: new Map() })),
      ).rejects.toThrow(/schema/);
    });

    it("reads a newer v1 tree and the v1 store still refuses to save it", async () => {
      const rexDir = join(tmp, ".rex");
      await cp(V1_FIXTURE, join(rexDir, PRD_TREE_DIRNAME), { recursive: true });
      await writeFile(join(rexDir, "tree-meta.json"), JSON.stringify({ title: "T", schema: "rex/v3", slugRule: 2 }));
      const warn = vi.fn();

      const model = await loadPrdModel(rexDir, { ignoreSchemaSkew: true, warn });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("PRD schema is rex/v3"));
      expect(model.tree.changes.length).toBeGreaterThan(0);
      expect(() => assertPrdModelWritable(model)).toThrow(/Writes are refused/);

      const store = new FolderTreeStore(rexDir);
      await expect(store.saveDocument(await store.loadDocument())).rejects.toThrow(/schema/i);
    });
  });
});
