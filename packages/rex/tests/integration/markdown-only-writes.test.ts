/**
 * Regression guard: PRD mutations must write ONLY to prd.md.
 *
 * For each write operation, this test verifies that:
 *   1. `.rex/prd.json` is NOT created or modified.
 *   2. `.rex/prd.md` reflects the mutation.
 *
 * This guards against silent re-introduction of JSON write calls in the
 * FileStore write path.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, stat, writeFile, readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileStore } from "../../src/store/file-adapter.js";
import { SCHEMA_VERSION } from "../../src/schema/index.js";
import { toCanonicalJSON } from "../../src/core/canonical.js";
import { parseDocument } from "../../src/store/markdown-parser.js";
import { moveItem } from "../../src/core/move.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedRexDir(rexDir: string): Promise<void> {
  await mkdir(rexDir, { recursive: true });
  await writeFile(
    join(rexDir, "prd.md"),
    [
      "---",
      `schema: ${SCHEMA_VERSION}`,
      "title: Regression Test",
      "items:",
      "  - id: epic-1",
      "    title: Initial Epic",
      "    level: epic",
      "    status: pending",
      "  - id: epic-2",
      "    title: Target Epic",
      "    level: epic",
      "    status: pending",
      "    children:",
      "      - id: feat-1",
      "        title: Feature",
      "        level: feature",
      "        status: pending",
      "---",
      "",
      "# Regression Test",
    ].join("\n"),
    "utf-8",
  );
  await writeFile(
    join(rexDir, "config.json"),
    toCanonicalJSON({ schema: SCHEMA_VERSION, project: "test", adapter: "file" }),
    "utf-8",
  );
  await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
}

async function jsonExists(rexDir: string): Promise<boolean> {
  try {
    await access(join(rexDir, "prd.json"), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function jsonMtimeMs(rexDir: string): Promise<number | null> {
  try {
    return (await stat(join(rexDir, "prd.json"))).mtimeMs;
  } catch {
    return null;
  }
}

async function prdMarkdownContent(rexDir: string): Promise<string> {
  return readFile(join(rexDir, "prd.md"), "utf-8");
}

async function prdItemIds(rexDir: string): Promise<string[]> {
  const raw = await prdMarkdownContent(rexDir);
  const parsed = parseDocument(raw);
  if (!parsed.ok) throw parsed.error;
  const ids: string[] = [];
  function collect(items: typeof parsed.data.items): void {
    for (const item of items) {
      ids.push(item.id);
      if (item.children) collect(item.children);
    }
  }
  collect(parsed.data.items);
  return ids;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("markdown-only writes regression", () => {
  let tmpDir: string;
  let rexDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-md-writes-"));
    rexDir = join(tmpDir, ".rex");
    await seedRexDir(rexDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("addItem does not create prd.json", async () => {
    const store = new FileStore(rexDir);

    await store.addItem({ id: "epic-3", title: "New Epic", status: "pending", level: "epic" });

    expect(await jsonExists(rexDir)).toBe(false);
    expect(await prdItemIds(rexDir)).toContain("epic-3");
  });

  it("updateItem (status) does not create prd.json", async () => {
    const store = new FileStore(rexDir);

    await store.updateItem("epic-1", { status: "in_progress" });

    expect(await jsonExists(rexDir)).toBe(false);
    expect(await prdMarkdownContent(rexDir)).toContain("in_progress");
  });

  it("updateItem (title edit) does not create prd.json", async () => {
    const store = new FileStore(rexDir);

    await store.updateItem("epic-1", { title: "Renamed Epic" });

    expect(await jsonExists(rexDir)).toBe(false);
    expect(await prdMarkdownContent(rexDir)).toContain("Renamed Epic");
  });

  it("removeItem does not create prd.json", async () => {
    const store = new FileStore(rexDir);

    await store.removeItem("feat-1");

    expect(await jsonExists(rexDir)).toBe(false);
    expect(await prdItemIds(rexDir)).not.toContain("feat-1");
  });

  it("saveDocument (simulating move/merge) does not create prd.json", async () => {
    const store = new FileStore(rexDir);
    const doc = await store.loadDocument();

    // Simulate a move: reparent feat-1 from epic-2 to epic-1
    moveItem(doc.items, "feat-1", "epic-1");
    await store.saveDocument(doc);

    expect(await jsonExists(rexDir)).toBe(false);
    // feat-1 still exists
    expect(await prdItemIds(rexDir)).toContain("feat-1");
  });

  it("withTransaction does not create prd.json", async () => {
    const store = new FileStore(rexDir);

    await store.withTransaction(async (doc) => {
      doc.items[0]!.status = "completed";
    });

    expect(await jsonExists(rexDir)).toBe(false);
    expect(await prdMarkdownContent(rexDir)).toContain("completed");
  });

  it("prd.json is not modified if it pre-exists before a write", async () => {
    // A legacy prd.json present on disk should not be touched by any mutation.
    const jsonPath = join(rexDir, "prd.json");
    const legacyContent = toCanonicalJSON({ schema: SCHEMA_VERSION, title: "Legacy", items: [] });
    await writeFile(jsonPath, legacyContent, "utf-8");
    const mtimeBefore = (await stat(jsonPath)).mtimeMs;

    // Small delay so mtime would differ if written
    await new Promise((r) => setTimeout(r, 10));

    const store = new FileStore(rexDir);
    await store.addItem({ id: "epic-5", title: "Post-JSON Epic", status: "pending", level: "epic" });

    const mtimeAfter = (await stat(jsonPath)).mtimeMs;
    expect(mtimeAfter).toBe(mtimeBefore);
    expect(await prdItemIds(rexDir)).toContain("epic-5");
  });
});
