import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleEditItem } from "../../../src/cli/mcp-tools.js";
import { FileStore, ensureRexDir } from "../../../src/store/index.js";
import { toCanonicalJSON } from "../../../src/core/canonical.js";
import { SCHEMA_VERSION } from "../../../src/schema/v1.js";
import type { PRDDocument, PRDItem } from "../../../src/schema/v1.js";

function makeItem(overrides: Partial<PRDItem> = {}): PRDItem {
  return {
    id: "item-1",
    title: "Original title",
    status: "pending",
    level: "task",
    description: "Original description",
    priority: "medium",
    tags: ["original"],
    acceptanceCriteria: ["criterion one"],
    ...overrides,
  };
}

function parseResult(result: { content: unknown[] }) {
  const text = (result.content[0] as { text: string }).text;
  return JSON.parse(text);
}

describe("handleEditItem", () => {
  let tmpDir: string;
  let rexDir: string;
  let store: FileStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-edit-test-"));
    rexDir = join(tmpDir, ".rex");
    await ensureRexDir(rexDir);

    const item1 = makeItem();
    const item2 = makeItem({
      id: "item-2",
      title: "Second item",
      level: "task",
    });
    const epic = makeItem({
      id: "epic-1",
      title: "Test Epic",
      level: "epic",
      children: [item1, item2],
    });

    const doc: PRDDocument = {
      schema: SCHEMA_VERSION,
      title: "Edit Test",
      items: [epic],
    };
    await writeFile(join(rexDir, "prd.json"), toCanonicalJSON(doc), "utf-8");
    await writeFile(
      join(rexDir, "config.json"),
      toCanonicalJSON({ schema: SCHEMA_VERSION, project: "test", adapter: "file" }),
      "utf-8",
    );
    await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
    await writeFile(join(rexDir, "workflow.md"), "# Test Workflow", "utf-8");

    store = new FileStore(rexDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── Field merging ────────────────────────────────────────────────

  it("updates only the specified fields, leaving others unchanged", async () => {
    const result = await handleEditItem(store, {
      id: "item-1",
      title: "Updated title",
    });

    expect(result.isError).toBeFalsy();
    const parsed = parseResult(result);
    expect(parsed.updatedFields).toEqual(["title"]);
    expect(parsed.item.title).toBe("Updated title");
    // Unchanged fields preserved
    expect(parsed.item.description).toBe("Original description");
    expect(parsed.item.priority).toBe("medium");
    expect(parsed.item.tags).toEqual(["original"]);
    expect(parsed.item.acceptanceCriteria).toEqual(["criterion one"]);
  });

  it("updates multiple fields at once", async () => {
    const result = await handleEditItem(store, {
      id: "item-1",
      title: "New title",
      description: "New description",
      priority: "high",
      tags: ["new-tag-1", "new-tag-2"],
    });

    expect(result.isError).toBeFalsy();
    const parsed = parseResult(result);
    expect(parsed.updatedFields.sort()).toEqual(
      ["title", "description", "priority", "tags"].sort(),
    );
    expect(parsed.item.title).toBe("New title");
    expect(parsed.item.description).toBe("New description");
    expect(parsed.item.priority).toBe("high");
    expect(parsed.item.tags).toEqual(["new-tag-1", "new-tag-2"]);
  });

  it("updates acceptanceCriteria", async () => {
    const result = await handleEditItem(store, {
      id: "item-1",
      acceptanceCriteria: ["new criterion A", "new criterion B"],
    });

    expect(result.isError).toBeFalsy();
    const parsed = parseResult(result);
    expect(parsed.updatedFields).toEqual(["acceptanceCriteria"]);
    expect(parsed.item.acceptanceCriteria).toEqual(["new criterion A", "new criterion B"]);
  });

  it("updates source field", async () => {
    const result = await handleEditItem(store, {
      id: "item-1",
      source: "manual",
    });

    expect(result.isError).toBeFalsy();
    const parsed = parseResult(result);
    expect(parsed.updatedFields).toEqual(["source"]);
    expect(parsed.item.source).toBe("manual");
  });

  it("persists changes to prd.json visible in subsequent reads", async () => {
    await handleEditItem(store, {
      id: "item-1",
      title: "Persisted title",
      priority: "critical",
    });

    // Re-read from store to verify persistence
    const item = await store.getItem("item-1");
    expect(item!.title).toBe("Persisted title");
    expect(item!.priority).toBe("critical");
    // Unchanged
    expect(item!.description).toBe("Original description");
  });

  // ── Unknown ID ───────────────────────────────────────────────────

  it("returns structured error for unknown item ID", async () => {
    const result = await handleEditItem(store, {
      id: "nonexistent-id",
      title: "Something",
    });

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("nonexistent-id");
    expect(text).toContain("not found");
  });

  // ── Invalid values ──────────────────────────────────────────────

  it("returns error when no fields are provided", async () => {
    const result = await handleEditItem(store, {
      id: "item-1",
    });

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("No fields to update");
  });

  // ── blockedBy validation ────────────────────────────────────────

  it("updates blockedBy with valid dependency", async () => {
    const result = await handleEditItem(store, {
      id: "item-2",
      blockedBy: ["item-1"],
    });

    expect(result.isError).toBeFalsy();
    const parsed = parseResult(result);
    expect(parsed.updatedFields).toEqual(["blockedBy"]);
    expect(parsed.item.blockedBy).toEqual(["item-1"]);
  });

  it("rejects circular blockedBy dependency", async () => {
    // First, set item-2 blocked by item-1
    await handleEditItem(store, {
      id: "item-2",
      blockedBy: ["item-1"],
    });

    // Now try to set item-1 blocked by item-2 (circular)
    const result = await handleEditItem(store, {
      id: "item-1",
      blockedBy: ["item-2"],
    });

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Invalid dependencies");
  });

  // ── Logging ─────────────────────────────────────────────────────

  it("appends an item_edited log entry", async () => {
    await handleEditItem(store, {
      id: "item-1",
      title: "Logged change",
    });

    const { readFile } = await import("node:fs/promises");
    const logContent = await readFile(join(rexDir, "execution-log.jsonl"), "utf-8");
    const lines = logContent.trim().split("\n").filter(Boolean);
    const lastEntry = JSON.parse(lines[lines.length - 1]);
    expect(lastEntry.event).toBe("item_edited");
    expect(lastEntry.itemId).toBe("item-1");
    expect(lastEntry.detail).toContain("title");
  });
});
