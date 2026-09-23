/**
 * `tree-meta.json` is rewritten wholesale on every save, so a writer that only
 * knows its own fields deletes everyone else's.
 *
 * Observed live, and the reason this file exists: a rex MCP server started
 * before `slugRule` shipped saved the PRD and rewrote the sidecar from a
 * `TreeMeta` that had no such field. No path moved and no item changed — the
 * two builds shared a slug rule — but the marker was gone, and with it the
 * guard, for whoever wrote next.
 *
 * A build cannot be taught to keep a field it predates, so this cannot be
 * fixed backwards. What it can do is stop the *next* such loss: from here on
 * every writer carries forward the keys it does not recognise. The tests below
 * pin that for each of the three mechanisms that write this file, because the
 * mechanisms differ (`writeFile`, `atomicWrite`, `atomicWriteJSON`) and the
 * preservation has to live in the shape builder they share rather than in any
 * one of them.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FolderTreeStore, ensureFolderTreeRexDir } from "../../../src/store/folder-tree-store.js";
import { FileStore } from "../../../src/store/file-adapter.js";
import { treeMetaContents } from "../../../src/store/tree-meta.js";
import { SLUG_RULE_VERSION } from "../../../src/store/folder-tree-serializer.js";
import { SCHEMA_VERSION } from "../../../src/schema/index.js";
import { toCanonicalJSON } from "../../../src/core/canonical.js";
import type { PRDDocument, PRDItem, PRDStore } from "../../../src/store/index.js";

const TREE_META = "tree-meta.json";

const ITEMS: PRDItem[] = [
  {
    id: "aaaaaaaa-1111-4111-8111-111111111111",
    title: "Add SSO Support",
    status: "pending",
    level: "task",
    description: "",
    priority: "medium",
  } as PRDItem,
];

function doc(): PRDDocument {
  return { schema: SCHEMA_VERSION, title: "Guarded PRD", items: ITEMS };
}

/** Both local stores write this file; a fix in only one leaves the other lossy. */
const STORES: ReadonlyArray<{ name: string; make: (rexDir: string) => PRDStore }> = [
  { name: "FolderTreeStore", make: (rexDir) => new FolderTreeStore(rexDir) },
  { name: "FileStore", make: (rexDir) => new FileStore(rexDir) },
];

describe("tree-meta.json preserves unknown keys", () => {
  let tmpDir: string;
  let rexDir: string;
  let metaPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-tree-meta-"));
    rexDir = join(tmpDir, ".rex");
    metaPath = join(rexDir, TREE_META);
    await ensureFolderTreeRexDir(rexDir);
    await writeFile(
      join(rexDir, "config.json"),
      toCanonicalJSON({ schema: SCHEMA_VERSION, project: "meta-test", adapter: "folder-tree" }),
      "utf-8",
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe.each(STORES)("$name", ({ make }) => {
    /**
     * A field only a *newer* build knows about, standing in for whatever the
     * 1.0.0 sidecar adds next. The test cannot import such a field — it does
     * not exist yet — which is the point: the guarantee has to hold for keys
     * this build has never heard of.
     */
    it("carries a field from a newer build through an ordinary save", async () => {
      await make(rexDir).saveDocument(doc());
      const written = JSON.parse(await readFile(metaPath, "utf-8"));
      await writeFile(
        metaPath,
        JSON.stringify({ ...written, futureField: { depth: 3 }, retention: "90d" }),
        "utf-8",
      );

      await make(rexDir).saveDocument(doc());

      const after = JSON.parse(await readFile(metaPath, "utf-8"));
      expect(after.futureField).toEqual({ depth: 3 });
      expect(after.retention).toBe("90d");
      // And the fields this build does own are still written, not merely left.
      expect(after).toMatchObject({
        title: "Guarded PRD",
        schema: SCHEMA_VERSION,
        slugRule: SLUG_RULE_VERSION,
      });
    });

    it("carries it through a transaction as well as a full save", async () => {
      await make(rexDir).saveDocument(doc());
      const written = JSON.parse(await readFile(metaPath, "utf-8"));
      await writeFile(metaPath, JSON.stringify({ ...written, futureField: 7 }), "utf-8");

      await make(rexDir).withTransaction(async (d) => {
        d.items[0]!.priority = "high";
      });

      expect(JSON.parse(await readFile(metaPath, "utf-8")).futureField).toBe(7);
    });

    // The owned fields must win outright. A stale `slugRule` left in the file
    // by a crashed writer, carried forward instead of overwritten, would be a
    // marker that describes a rule the paths beside it no longer follow.
    it("does not let a carried key shadow a field this build owns", async () => {
      await make(rexDir).saveDocument(doc());
      await writeFile(
        metaPath,
        JSON.stringify({ title: "Stale", schema: "rex/v0", slugRule: SLUG_RULE_VERSION, keep: 1 }),
        "utf-8",
      );

      await make(rexDir).saveDocument(doc());

      const after = JSON.parse(await readFile(metaPath, "utf-8"));
      expect(after).toEqual({
        title: "Guarded PRD",
        schema: SCHEMA_VERSION,
        slugRule: SLUG_RULE_VERSION,
        keep: 1,
      });
    });
  });

  describe("treeMetaContents", () => {
    it("returns the owned fields alone when the file is absent", async () => {
      expect(await treeMetaContents(metaPath, { title: "Fresh" })).toEqual({
        title: "Fresh",
        schema: SCHEMA_VERSION,
        slugRule: SLUG_RULE_VERSION,
      });
    });

    // A sidecar too damaged to parse has no keys worth rescuing, and guessing
    // at them would be worse than losing them. The write replaces it either way.
    it("carries nothing out of a malformed file rather than throwing", async () => {
      await writeFile(metaPath, "{ not json", "utf-8");

      expect(await treeMetaContents(metaPath, { title: "Fresh" })).toEqual({
        title: "Fresh",
        schema: SCHEMA_VERSION,
        slugRule: SLUG_RULE_VERSION,
      });
    });

    it("carries nothing out of a file holding a non-object", async () => {
      await writeFile(metaPath, JSON.stringify(["a", "b"]), "utf-8");

      expect(await treeMetaContents(metaPath, { title: "Fresh" })).toEqual({
        title: "Fresh",
        schema: SCHEMA_VERSION,
        slugRule: SLUG_RULE_VERSION,
      });
    });
  });
});
