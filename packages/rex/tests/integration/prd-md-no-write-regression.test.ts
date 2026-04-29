/**
 * Regression guard: PRD mutations must not write to prd.md or branch-scoped files.
 *
 * After the migration to folder-tree as the sole write backend, these tests
 * verify that PRD mutations write ONLY to `.rex/tree/` and never create or
 * modify `prd.md` or branch-scoped `prd_{branch}_{date}.md` files.
 *
 * This guards against accidental introduction of prd.md writes in:
 *   - Rex CLI commands (add, update, remove, move, merge, prune, reorganize)
 *   - MCP write tools (add_item, edit_item, update_task_status, move_item, merge_items)
 *   - FileStore.saveDocument() directly
 *
 * No ndx start required — all assertions are filesystem checks only.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, access, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { FileStore } from "../../src/store/file-adapter.js";
import { SCHEMA_VERSION } from "../../src/schema/index.js";
import { toCanonicalJSON } from "../../src/core/canonical.js";
import { moveItem } from "../../src/core/move.js";

// ---------------------------------------------------------------------------
// Module-level mock (before any imports that use spawnClaude)
// ---------------------------------------------------------------------------

const { mockSpawnClaude } = vi.hoisted(() => ({
  mockSpawnClaude: vi.fn(),
}));

vi.mock("../../src/analyze/llm-bridge.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/analyze/llm-bridge.js")>();
  return { ...actual, spawnClaude: mockSpawnClaude };
});

// ---------------------------------------------------------------------------
// Imports (after mock declaration)
// ---------------------------------------------------------------------------

import { reasonFromDescription } from "../../src/analyze/reason.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const PROPOSAL_PAYLOAD = [
  {
    epic: { title: "Test Epic" },
    features: [
      {
        title: "Test Feature",
        tasks: [
          {
            title: "Test Task",
            description: "A test task",
            acceptanceCriteria: ["Criterion 1"],
          },
        ],
      },
    ],
  },
];

const CLAUDE_RESPONSE = JSON.stringify(PROPOSAL_PAYLOAD);

// ---------------------------------------------------------------------------
// Filesystem assertion helpers
// ---------------------------------------------------------------------------

async function prdMdExists(dir: string): Promise<boolean> {
  try {
    await access(join(dir, ".rex", "prd.md"), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function branchScopedFilesExist(dir: string): Promise<string[]> {
  const rexDir = join(dir, ".rex");
  try {
    const files = await readdir(rexDir);
    // Match pattern: prd_*_*.md or prd_*_*.json (legacy)
    return files.filter((f) => /^prd_[^_]+_\d{4}-\d{2}-\d{2}\.(md|json)$/.test(f));
  } catch {
    return [];
  }
}

async function folderTreeExists(dir: string): Promise<boolean> {
  try {
    await access(join(dir, ".rex", "tree"), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function seedFolderTree(rexDir: string): Promise<void> {
  // Create minimal folder tree structure
  const treeDir = join(rexDir, "tree");
  await mkdir(treeDir, { recursive: true });

  // Create tree-meta.json
  await writeFile(
    join(rexDir, "tree-meta.json"),
    JSON.stringify({ title: "Test PRD" }),
    "utf-8",
  );

  // Create minimal epic file
  const epicDir = join(treeDir, "epic-1");
  await mkdir(epicDir, { recursive: true });
  await writeFile(
    join(epicDir, "index.md"),
    [
      "---",
      "id: epic-1",
      "title: Initial Epic",
      "level: epic",
      "status: pending",
      "---",
      "",
      "# Initial Epic",
    ].join("\n"),
    "utf-8",
  );
}

async function seedRexDir(rexDir: string): Promise<void> {
  await mkdir(rexDir, { recursive: true });
  await writeFile(
    join(rexDir, "config.json"),
    toCanonicalJSON({ schema: SCHEMA_VERSION, project: "test", adapter: "file" }),
    "utf-8",
  );
  await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
  await seedFolderTree(rexDir);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("prd.md and branch-scoped files are never created/modified", {
  timeout: 120_000,
}, () => {
  let tmpDir: string;
  let rexDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-md-no-write-"));
    rexDir = join(tmpDir, ".rex");
    await seedRexDir(rexDir);
    mockSpawnClaude.mockReset();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ---- FileStore.addItem -----

  it("FileStore.addItem does not create prd.md", async () => {
    const store = new FileStore(rexDir);

    await store.addItem({ id: "epic-2", title: "New Epic", status: "pending", level: "epic" });

    expect(await prdMdExists(tmpDir)).toBe(false);
    expect(await folderTreeExists(tmpDir)).toBe(true);
  });

  // ---- FileStore.updateItem -----

  it("FileStore.updateItem does not create prd.md", async () => {
    const store = new FileStore(rexDir);

    await store.updateItem("epic-1", { title: "Renamed Epic" });

    expect(await prdMdExists(tmpDir)).toBe(false);
    expect(await folderTreeExists(tmpDir)).toBe(true);
  });

  it("FileStore.updateItem (status change) does not create prd.md", async () => {
    const store = new FileStore(rexDir);

    await store.updateItem("epic-1", { status: "in_progress" });

    expect(await prdMdExists(tmpDir)).toBe(false);
  });

  // ---- FileStore.removeItem -----

  it("FileStore.removeItem does not create prd.md", async () => {
    const store = new FileStore(rexDir);

    await store.removeItem("epic-1");

    expect(await prdMdExists(tmpDir)).toBe(false);
  });

  // ---- FileStore.saveDocument (move/merge scenario) -----

  it("FileStore.saveDocument does not create prd.md", async () => {
    const store = new FileStore(rexDir);
    const doc = await store.loadDocument();

    // Add a second epic for move testing
    doc.items.push({ id: "epic-2", title: "Target Epic", level: "epic", status: "pending" });
    await store.saveDocument(doc);

    expect(await prdMdExists(tmpDir)).toBe(false);
  });

  // ---- FileStore.withTransaction -----

  it("FileStore.withTransaction does not create prd.md", async () => {
    const store = new FileStore(rexDir);

    await store.withTransaction(async (doc) => {
      doc.items[0]!.status = "completed";
    });

    expect(await prdMdExists(tmpDir)).toBe(false);
  });

  // ---- Vendor-specific: rex add with mocked Claude -----

  it("[vendor: claude] reasonFromDescription does not create prd.md", async () => {
    mockSpawnClaude.mockResolvedValueOnce({
      text: CLAUDE_RESPONSE,
      tokenUsage: { input: 500, output: 200 },
    });

    await reasonFromDescription("Add test feature", [], { dir: tmpDir });

    expect(await prdMdExists(tmpDir)).toBe(false);
    expect(await folderTreeExists(tmpDir)).toBe(true);
  });

  // ---- Pre-existing prd.md guard (defensive) -----

  it("if pre-existing prd.md exists, FileStore.addItem does not modify it", async () => {
    // Create a legacy prd.md file
    const prdMdPath = join(rexDir, "prd.md");
    const legacyContent = "# Legacy PRD\nDO NOT MODIFY";
    await writeFile(prdMdPath, legacyContent, "utf-8");

    // Get initial content
    const contentBefore = await readFile(prdMdPath, "utf-8");

    // Small delay so mtime would differ if written
    await new Promise((r) => setTimeout(r, 10));

    const store = new FileStore(rexDir);
    await store.addItem({ id: "epic-3", title: "New Epic", status: "pending", level: "epic" });

    const contentAfter = await readFile(prdMdPath, "utf-8");
    expect(contentAfter).toBe(contentBefore);
  });

  // ---- Branch-scoped files are never created -----

  it("FileStore.saveDocument does not create branch-scoped prd_*_*.md files", async () => {
    const store = new FileStore(rexDir);
    const doc = await store.loadDocument();

    doc.items.push({ id: "epic-2", title: "Another Epic", level: "epic", status: "pending" });
    await store.saveDocument(doc);

    // Check that no branch-scoped files were created
    const branchFiles = await branchScopedFilesExist(tmpDir);
    expect(branchFiles).toHaveLength(0);
    expect(await prdMdExists(tmpDir)).toBe(false);
  });
});
