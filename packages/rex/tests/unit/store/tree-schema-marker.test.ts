/**
 * The folder tree records the schema version it was written at.
 *
 * Without it, `loadDocument` hardcoded the running `SCHEMA_VERSION` on the tree
 * path, so a document reported whatever version read it rather than whatever
 * wrote it. That defeats forward compatibility at one remove: the document
 * schema is a `.passthrough()` and `isCompatibleSchema` admits newer minors, so
 * a tree written by a future `rex/v1.1` loads here intact, unrecognised fields
 * and all — but claims to be `rex/v1`. Exporting it produces a bundle labelled
 * `rex/v1`, and `parseBundle`'s minor gate then compares equal minors and admits
 * those fields into another tree unvalidated. `buildBundle` was fixed to stamp
 * `doc.schema`; this is the other half, making `doc.schema` worth stamping.
 *
 * Both adapters are covered because `FileStore` and `FolderTreeStore` have
 * separate read and write paths over the same tree.
 *
 * @see packages/rex/src/store/tree-meta.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FolderTreeStore, ensureFolderTreeRexDir } from "../../../src/store/folder-tree-store.js";
import { FileStore } from "../../../src/store/file-adapter.js";
import { SCHEMA_VERSION } from "../../../src/schema/index.js";
import { toCanonicalJSON } from "../../../src/core/canonical.js";
import { buildBundle, parseBundle, BundleError } from "../../../src/core/prd-bundle.js";
import type { PRDStore } from "../../../src/store/contracts.js";
import type { PRDItem } from "../../../src/schema/index.js";

function seedItems(): PRDItem[] {
  return [
    {
      id: "epic-1",
      title: "Epic One",
      level: "epic",
      status: "pending",
      priority: "medium",
      acceptanceCriteria: [],
    } as PRDItem,
  ];
}

const STORES: Array<{ name: string; create: (rexDir: string) => PRDStore }> = [
  { name: "FolderTreeStore", create: (rexDir) => new FolderTreeStore(rexDir) },
  { name: "FileStore", create: (rexDir) => new FileStore(rexDir) },
];

describe.each(STORES)("$name tree schema marker", ({ create }) => {
  let tmpDir: string;
  let rexDir: string;
  let store: PRDStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-tree-schema-"));
    rexDir = join(tmpDir, ".rex");
    await ensureFolderTreeRexDir(rexDir);
    await writeFile(
      join(rexDir, "config.json"),
      toCanonicalJSON({ schema: SCHEMA_VERSION, project: "tree-schema", adapter: "folder-tree" }),
      "utf-8",
    );
    await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
    await writeFile(join(rexDir, "workflow.md"), "# Workflow", "utf-8");
    store = create(rexDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function readMeta(): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(join(rexDir, "tree-meta.json"), "utf-8")) as Record<string, unknown>;
  }

  it("writes the document's schema version alongside the title", async () => {
    await store.saveDocument({ schema: SCHEMA_VERSION, title: "Marked", items: seedItems() });

    const meta = await readMeta();
    expect(meta["title"]).toBe("Marked");
    expect(meta["schema"]).toBe(SCHEMA_VERSION);
  });

  it("round-trips a newer-minor schema instead of replacing it with the running one", async () => {
    // The case the marker exists for: a tree written by a future rex.
    await store.saveDocument({ schema: "rex/v1.1", title: "From The Future", items: seedItems() });

    const reloaded = await create(rexDir).loadDocument();
    expect(reloaded.schema).toBe("rex/v1.1");
  });

  it("falls back to the running version for a tree written before the marker existed", async () => {
    await store.saveDocument({ schema: SCHEMA_VERSION, title: "Legacy", items: seedItems() });
    // Exactly what an older rex left behind: a title and nothing else.
    await writeFile(join(rexDir, "tree-meta.json"), JSON.stringify({ title: "Legacy" }), "utf-8");

    const reloaded = await create(rexDir).loadDocument();
    expect(reloaded.schema).toBe(SCHEMA_VERSION);
    expect(reloaded.title).toBe("Legacy");
  });

  it("falls back when the marker is present but not a string", async () => {
    await store.saveDocument({ schema: SCHEMA_VERSION, title: "Odd", items: seedItems() });
    await writeFile(
      join(rexDir, "tree-meta.json"),
      JSON.stringify({ title: "Odd", schema: 11 }),
      "utf-8",
    );

    const reloaded = await create(rexDir).loadDocument();
    expect(reloaded.schema).toBe(SCHEMA_VERSION);
  });

  it("carries the marker through to a bundle a running rex would refuse", async () => {
    // End to end, and the reason the marker is worth persisting: the version
    // gate can only refuse what the document was honest about.
    await store.saveDocument({ schema: "rex/v1.1", title: "From The Future", items: seedItems() });

    const bundle = buildBundle(await create(rexDir).loadDocument());
    expect(bundle.schema).toBe("rex/v1.1");

    const roundTripped = JSON.parse(JSON.stringify(bundle)) as unknown;
    expect(() => parseBundle(roundTripped)).toThrow(BundleError);
    expect(() => parseBundle(roundTripped)).toThrow(/newer than this rex supports/);
  });
});
