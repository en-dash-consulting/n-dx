import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileStore } from "../../../src/store/file-adapter.js";
import { PRD_MARKDOWN_FILENAME } from "../../../src/store/prd-md-migration.js";
import { serializeDocument } from "../../../src/store/markdown-serializer.js";
import { SCHEMA_VERSION, type PRDDocument, type PRDItem } from "../../../src/schema/index.js";
import { toCanonicalJSON } from "../../../src/core/canonical.js";

describe("FileStore markdown auto-migration", () => {
  let tmpDir: string;
  let rexDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-file-store-md-"));
    rexDir = join(tmpDir, ".rex");
    await mkdir(rexDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("saveDocument does not create prd.json when only prd.md exists", async () => {
    const doc: PRDDocument = { schema: SCHEMA_VERSION, title: "MD Only", items: [] };
    await writeFile(join(rexDir, PRD_MARKDOWN_FILENAME), serializeDocument(doc), "utf-8");

    const store = new FileStore(rexDir);
    const loaded = await store.loadDocument();
    loaded.items.push({ id: "e1", title: "Epic", status: "pending", level: "epic" } as PRDItem);
    await store.saveDocument(loaded);

    await expect(access(join(rexDir, "prd.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("addItem does not create prd.json when only prd.md exists", async () => {
    const doc: PRDDocument = { schema: SCHEMA_VERSION, title: "MD Only", items: [] };
    await writeFile(join(rexDir, PRD_MARKDOWN_FILENAME), serializeDocument(doc), "utf-8");

    const store = new FileStore(rexDir);
    await store.addItem({ id: "e1", title: "Epic", status: "pending", level: "epic" });

    await expect(access(join(rexDir, "prd.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("saveDocument does not modify a pre-existing prd.json", async () => {
    const doc: PRDDocument = { schema: SCHEMA_VERSION, title: "MD Primary", items: [] };
    await writeFile(join(rexDir, PRD_MARKDOWN_FILENAME), serializeDocument(doc), "utf-8");

    const legacyJson = toCanonicalJSON({ schema: SCHEMA_VERSION, title: "Legacy JSON", items: [] });
    const jsonPath = join(rexDir, "prd.json");
    await writeFile(jsonPath, legacyJson, "utf-8");

    const store = new FileStore(rexDir);
    const loaded = await store.loadDocument();
    loaded.items.push({ id: "e1", title: "Epic", status: "pending", level: "epic" } as PRDItem);
    await store.saveDocument(loaded);

    const jsonAfter = await readFile(jsonPath, "utf-8");
    expect(jsonAfter).toBe(legacyJson);
  });

});
