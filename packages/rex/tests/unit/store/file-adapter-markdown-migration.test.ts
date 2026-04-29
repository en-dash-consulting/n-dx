import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileStore } from "../../../src/store/file-adapter.js";
import { parseDocument } from "../../../src/store/markdown-parser.js";
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

  it("creates prd.md on load when only prd.json exists", async () => {
    const docBefore: PRDDocument = {
      schema: SCHEMA_VERSION,
      title: "Auto Migration",
      items: [
        {
          id: "epic-1",
          title: "Epic",
          level: "epic",
          status: "pending",
          duration: { totalMs: 10, runningMs: 0 },
          tokenUsage: { input: 5, output: 2 },
        },
      ],
    };
    // Migration stamps sourceFile on items; the returned document reflects that.
    const doc: PRDDocument = {
      ...docBefore,
      items: docBefore.items.map((i) => ({ ...i, sourceFile: ".rex/prd.md" })),
    };
    const jsonPath = join(rexDir, "prd.json");
    const jsonBefore = toCanonicalJSON(docBefore);
    await writeFile(jsonPath, jsonBefore, "utf-8");

    const store = new FileStore(rexDir);
    const loaded = await store.loadDocument();
    expect(loaded).toEqual(doc);

    const markdownPath = join(rexDir, PRD_MARKDOWN_FILENAME);
    await access(markdownPath);
    const markdown = await readFile(markdownPath, "utf-8");
    const parsed = parseDocument(markdown);
    if (!parsed.ok) throw parsed.error;
    expect(parsed.data).toEqual(doc);

    const jsonAfter = await readFile(jsonPath, "utf-8");
    expect(jsonAfter).toBe(jsonBefore);
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

  it("prefers prd.md on subsequent loads after migration", async () => {
    const docBefore: PRDDocument = {
      schema: SCHEMA_VERSION,
      title: "Markdown Primary",
      items: [
        {
          id: "task-1",
          title: "Task",
          level: "task",
          status: "pending",
        },
      ],
    };
    // Migration stamps sourceFile; subsequent loads read it from prd.md.
    const doc: PRDDocument = {
      ...docBefore,
      items: docBefore.items.map((i) => ({ ...i, sourceFile: ".rex/prd.md" })),
    };
    await writeFile(join(rexDir, "prd.json"), toCanonicalJSON(docBefore), "utf-8");

    const store = new FileStore(rexDir);
    const firstLoad = await store.loadDocument();
    expect(firstLoad).toEqual(doc);

    await writeFile(
      join(rexDir, "prd.json"),
      toCanonicalJSON({
        schema: SCHEMA_VERSION,
        title: "JSON Drift",
        items: [],
      }),
      "utf-8",
    );

    const secondLoad = await store.loadDocument();
    expect(secondLoad).toEqual(doc);
  });
});
