import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileStore } from "../../../src/store/file-adapter.js";
import { parseDocument } from "../../../src/store/markdown-parser.js";
import { PRD_MARKDOWN_FILENAME } from "../../../src/store/prd-md-migration.js";
import { SCHEMA_VERSION, type PRDDocument } from "../../../src/schema/index.js";
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
    const doc: PRDDocument = {
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
    const jsonPath = join(rexDir, "prd.json");
    const jsonBefore = toCanonicalJSON(doc);
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

  it("prefers prd.md on subsequent loads after migration", async () => {
    const doc: PRDDocument = {
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
    await writeFile(join(rexDir, "prd.json"), toCanonicalJSON(doc), "utf-8");

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
