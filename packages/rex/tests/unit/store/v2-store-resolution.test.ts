/**
 * Store resolution on a v2 tree, and the v1 store's refusal of one.
 *
 * `resolveStore` dispatches on layout: the change-layer store on a v2 tree,
 * FileStore on v1. FileStore itself refuses a v2 tree, so nothing that holds
 * one can read an empty v1 view of it or scaffold `prd_tree/` beside it.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SCHEMA_VERSION } from "../../../src/schema/index.js";
import { toCanonicalJSON } from "../../../src/core/canonical.js";
import { FileStore, PRD_TREE_DIRNAME, resolveStore, resolveV1Store } from "../../../src/store/index.js";
import { ChangeLayerStore, resolveLayerStore } from "../../../src/store/change-layer-store.js";
import { V1StoreOnV2TreeError } from "../../../src/store/file-adapter.js";
import { handleGetCapabilities } from "../../../src/cli/mcp-tools/get-capabilities.js";
import { copyV2Fixture } from "../../helpers/v2-fixture.js";

describe("store resolution on a v2 tree", () => {
  let tmp: string;
  let rexDir: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "rex-v2-resolve-"));
    rexDir = await copyV2Fixture(join(tmp, ".rex"), "lf");
    await writeFile(join(rexDir, "config.json"), toCanonicalJSON({ schema: SCHEMA_VERSION, project: "t", adapter: "file" }));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("resolveStore returns the change-layer store", async () => {
    const store = await resolveStore(rexDir);
    expect(store).toBeInstanceOf(ChangeLayerStore);
    const doc = await store.loadDocument();
    expect(doc.items.map((i) => i.title)).toContain("Add Apple Pay");
  });

  it("the change-layer store still reads config and writes the log", async () => {
    const store = await resolveStore(rexDir);
    expect((await store.loadConfig()).project).toBe("t");
    await store.appendLog({ timestamp: new Date().toISOString(), event: "test" });
    expect(await store.readLog()).toHaveLength(1);
  });

  it("get_capabilities reports rex/v2 for the resolved store", async () => {
    const store = await resolveStore(rexDir);
    expect(store.capabilities().schemaVersion).toBe("rex/v2");
    const result = await handleGetCapabilities(store);
    expect(JSON.parse(result.content[0].text).schemaVersion).toBe("rex/v2");
  });

  it("resolveLayerStore does not wrap the resolved store twice", async () => {
    const base = await resolveStore(rexDir);
    const { store, v2 } = await resolveLayerStore(rexDir, base);
    expect(v2).toBe(true);
    expect(store).toBe(base);
  });

  it("resolveV1Store returns a FileStore, which refuses to load, naming the v2 layout", async () => {
    const store = await resolveV1Store(rexDir);
    expect(store).toBeInstanceOf(FileStore);
    await expect(store.loadDocument()).rejects.toThrow(V1StoreOnV2TreeError);
    await expect(store.loadDocument()).rejects.toThrow(/v2 layout/);
  });

  it("FileStore refuses every write and scaffolds no prd_tree/", async () => {
    const store = new FileStore(rexDir);
    const doc = { schema: SCHEMA_VERSION, title: "x", items: [] };
    await expect(store.saveDocument(doc)).rejects.toThrow(/v2 layout/);
    await expect(store.withTransaction(async () => {})).rejects.toThrow(/v2 layout/);
    await expect(
      store.addItem({ id: "a", title: "A", level: "epic", status: "pending" }),
    ).rejects.toThrow(/v2 layout/);
    expect(existsSync(join(rexDir, PRD_TREE_DIRNAME))).toBe(false);
  });
});

describe("store resolution on a v1 tree", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "rex-v1-resolve-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("resolveStore and resolveV1Store both return a FileStore", async () => {
    const rexDir = join(tmp, ".rex");
    expect(await resolveStore(rexDir)).toBeInstanceOf(FileStore);
    expect(await resolveV1Store(rexDir)).toBeInstanceOf(FileStore);
  });
});
