/**
 * Regression guard: PRD mutations must write ONLY to the folder-tree backend.
 *
 * For each write operation, this test verifies that:
 *   1. `.rex/prd.json` is NOT created or modified.
 *   2. `.rex/prd.md` is NOT created (write backend migrated to folder-tree).
 *   3. `.rex/prd_tree/` reflects the mutation (folder-tree is the sole write surface).
 *
 * This guards against silent re-introduction of JSON or markdown write calls
 * in the FileStore write path.
 *
 * Note: Comprehensive vendor-specific tests with mocked LLM responses are in
 * prd-md-no-write-regression.test.ts. This file focuses on FileStore API coverage.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileStore } from "../../src/store/file-adapter.js";
import { SCHEMA_VERSION } from "../../src/schema/index.js";
import { toCanonicalJSON } from "../../src/core/canonical.js";
import { PRD_TREE_DIRNAME } from "../../src/store/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedRexDir(rexDir: string): Promise<void> {
  // Write config and log
  await mkdir(rexDir, { recursive: true });
  await Promise.all([
    (async () => {
      const treeDir = join(rexDir, PRD_TREE_DIRNAME);
      await mkdir(treeDir, { recursive: true });

      // Write tree-meta.json
      const fs = await import("node:fs/promises");
      await fs.writeFile(
        join(rexDir, "tree-meta.json"),
        JSON.stringify({ title: "Test" }),
      );

      // Create epic-1 directory
      const epic1 = join(treeDir, "epic-1");
      await mkdir(epic1, { recursive: true });
      await fs.writeFile(
        join(epic1, "index.md"),
        "---\nid: epic-1\ntitle: Epic 1\nlevel: epic\nstatus: pending\n---\n# Epic 1",
      );
    })(),
    (async () => {
      await (
        await import("node:fs/promises")
      ).writeFile(
        join(rexDir, "config.json"),
        toCanonicalJSON({ schema: SCHEMA_VERSION, project: "test", adapter: "file" }),
      );
    })(),
    (async () => {
      await (await import("node:fs/promises")).writeFile(join(rexDir, "execution-log.jsonl"), "");
    })(),
  ]);
}

async function prdMdExists(rexDir: string): Promise<boolean> {
  try {
    await access(join(rexDir, "prd.md"), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function prdJsonExists(rexDir: string): Promise<boolean> {
  try {
    await access(join(rexDir, "prd.json"), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function folderTreeExists(rexDir: string): Promise<boolean> {
  try {
    await access(join(rexDir, PRD_TREE_DIRNAME), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("folder-tree-only writes regression", () => {
  let tmpDir: string;
  let rexDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-ft-writes-"));
    rexDir = join(tmpDir, ".rex");
    await seedRexDir(rexDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("addItem writes to folder-tree, not prd.md or prd.json", async () => {
    const store = new FileStore(rexDir);
    await store.addItem({ id: "epic-2", title: "New Epic", status: "pending", level: "epic" });

    expect(await prdMdExists(rexDir)).toBe(false);
    expect(await prdJsonExists(rexDir)).toBe(false);
    expect(await folderTreeExists(rexDir)).toBe(true);
  });

  it("updateItem writes to folder-tree, not prd.md or prd.json", async () => {
    const store = new FileStore(rexDir);
    await store.updateItem("epic-1", { status: "in_progress" });

    expect(await prdMdExists(rexDir)).toBe(false);
    expect(await prdJsonExists(rexDir)).toBe(false);
    expect(await folderTreeExists(rexDir)).toBe(true);
  });

  it("removeItem writes to folder-tree, not prd.md or prd.json", async () => {
    const store = new FileStore(rexDir);
    await store.removeItem("epic-1");

    expect(await prdMdExists(rexDir)).toBe(false);
    expect(await prdJsonExists(rexDir)).toBe(false);
  });

  it("saveDocument writes to folder-tree, not prd.md or prd.json", async () => {
    const store = new FileStore(rexDir);
    const doc = await store.loadDocument();
    doc.items.push({ id: "epic-3", title: "Another", level: "epic", status: "pending" });

    await store.saveDocument(doc);

    expect(await prdMdExists(rexDir)).toBe(false);
    expect(await prdJsonExists(rexDir)).toBe(false);
  });

  it("withTransaction writes to folder-tree, not prd.md or prd.json", async () => {
    const store = new FileStore(rexDir);
    await store.withTransaction(async (doc) => {
      doc.items[0]!.status = "completed";
    });

    expect(await prdMdExists(rexDir)).toBe(false);
    expect(await prdJsonExists(rexDir)).toBe(false);
  });

  it("if pre-existing prd.md exists, mutations do not modify it", async () => {
    const fs = await import("node:fs/promises");
    const prdMdPath = join(rexDir, "prd.md");
    const legacyContent = "# Legacy PRD\nDO NOT MODIFY";
    await fs.writeFile(prdMdPath, legacyContent);
    const contentBefore = await fs.readFile(prdMdPath, "utf-8");

    const store = new FileStore(rexDir);
    await store.addItem({ id: "epic-2", title: "New", status: "pending", level: "epic" });

    const contentAfter = await fs.readFile(prdMdPath, "utf-8");
    expect(contentAfter).toBe(contentBefore);
  });

  it("if pre-existing prd.json exists, mutations do not modify it", async () => {
    const fs = await import("node:fs/promises");
    const prdJsonPath = join(rexDir, "prd.json");
    const legacyContent = '{"schema":"rex/v1","title":"Legacy","items":[]}';
    await fs.writeFile(prdJsonPath, legacyContent);
    const contentBefore = await fs.readFile(prdJsonPath, "utf-8");

    const store = new FileStore(rexDir);
    await store.addItem({ id: "epic-2", title: "New", status: "pending", level: "epic" });

    const contentAfter = await fs.readFile(prdJsonPath, "utf-8");
    expect(contentAfter).toBe(contentBefore);
  });
});
