/**
 * FolderTreeStore mutation-stamping tests.
 *
 * FolderTreeStore.addItem/updateItem/removeItem must stamp an ISO
 * `lastModified` on every mutation path — otherwise SyncEngine's
 * `isModifiedSinceSync()` never observes a change and locally edited items
 * are silently skipped on push (see packages/rex/src/core/sync.ts).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FolderTreeStore, ensureFolderTreeRexDir } from "../../../src/store/folder-tree-store.js";
import { SCHEMA_VERSION } from "../../../src/schema/index.js";
import { toCanonicalJSON } from "../../../src/core/canonical.js";
import type { PRDItem } from "../../../src/schema/index.js";

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe("FolderTreeStore lastModified stamping", () => {
  let tmpDir: string;
  let rexDir: string;
  let store: FolderTreeStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-ft-stamp-"));
    rexDir = join(tmpDir, ".rex");
    await ensureFolderTreeRexDir(rexDir);

    await writeFile(
      join(rexDir, "config.json"),
      toCanonicalJSON({ schema: SCHEMA_VERSION, project: "stamp-test", adapter: "folder-tree" }),
      "utf-8",
    );
    await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
    await writeFile(join(rexDir, "workflow.md"), "# Workflow", "utf-8");

    store = new FolderTreeStore(rexDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("addItem stamps a fresh ISO lastModified", async () => {
    await store.addItem({
      id: "stamp-epic",
      title: "Stamped Epic",
      status: "pending",
      level: "epic",
    });

    const item = await store.getItem("stamp-epic");
    expect(item).not.toBeNull();
    expect(typeof item!.lastModified).toBe("string");
    expect(item!.lastModified as string).toMatch(ISO_TIMESTAMP);
  });

  it("addItem stamps lastModified for items added under a parent", async () => {
    await store.addItem({ id: "stamp-parent", title: "Parent", status: "pending", level: "epic" });
    await store.addItem(
      { id: "stamp-child", title: "Child", status: "pending", level: "feature" },
      "stamp-parent",
    );

    const child = await store.getItem("stamp-child");
    expect(child!.lastModified as string).toMatch(ISO_TIMESTAMP);
  });

  it("updateItem refreshes lastModified even when updates omit it", async () => {
    await store.addItem({
      id: "stamp-upd",
      title: "Before",
      status: "pending",
      level: "task",
    });
    const before = await store.getItem("stamp-upd");
    const firstStamp = before!.lastModified as string;

    // Ensure the clock advances so a later stamp is observably different.
    await new Promise((resolve) => setTimeout(resolve, 5));

    await store.updateItem("stamp-upd", { status: "completed" });

    const after = await store.getItem("stamp-upd");
    expect(after!.status).toBe("completed");
    expect(after!.lastModified as string).toMatch(ISO_TIMESTAMP);
    expect((after!.lastModified as string) > firstStamp).toBe(true);
  });

  it("updateItem stamps lastModified on an item with no prior stamp", async () => {
    // Simulate a pre-existing tree item written before this fix landed
    // (saveDocument bypasses addItem's stamping).
    const doc = await store.loadDocument();
    doc.items.push({
      id: "legacy-item",
      title: "Legacy",
      status: "pending",
      level: "task",
    } as PRDItem);
    await store.saveDocument(doc);

    const before = await store.getItem("legacy-item");
    expect(before!.lastModified).toBeUndefined();

    await store.updateItem("legacy-item", { title: "Updated" });

    const after = await store.getItem("legacy-item");
    expect(after!.lastModified as string).toMatch(ISO_TIMESTAMP);
  });

  it("removeItem stamps the parent's lastModified when a child is removed", async () => {
    await store.addItem({ id: "rm-parent", title: "Parent", status: "pending", level: "epic" });
    await store.addItem(
      { id: "rm-child", title: "Child", status: "pending", level: "feature" },
      "rm-parent",
    );

    const parentBefore = await store.getItem("rm-parent");
    const parentStampBefore = parentBefore!.lastModified as string;

    await new Promise((resolve) => setTimeout(resolve, 5));
    await store.removeItem("rm-child");

    const child = await store.getItem("rm-child");
    expect(child).toBeNull();

    const parentAfter = await store.getItem("rm-parent");
    expect(parentAfter!.lastModified as string).toMatch(ISO_TIMESTAMP);
    expect((parentAfter!.lastModified as string) > parentStampBefore).toBe(true);
  });

  it("removeItem on a root-level item does not throw when there is no parent to stamp", async () => {
    await store.addItem({ id: "rm-root", title: "Root", status: "pending", level: "epic" });

    await expect(store.removeItem("rm-root")).resolves.toBeUndefined();
    expect(await store.getItem("rm-root")).toBeNull();
  });

  it("removeItem still throws when the item does not exist", async () => {
    await expect(store.removeItem("does-not-exist")).rejects.toThrow();
  });
});
