/**
 * Integration tests for MCP write-tool handlers.
 *
 * Asserts folder-tree state (directory count, parent summary) after
 * `add_item`, `edit_item`, `update_task_status`, `move_item`, and
 * `merge_items` tool calls.
 *
 * All tests use isolated temporary directories and clean up on exit.
 * No test references prd.md paths; all assertions target .rex/prd_tree/ via
 * parseFolderTree.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStore, ensureRexDir } from "../../src/store/index.js";
import { toCanonicalJSON } from "../../src/core/canonical.js";
import { SCHEMA_VERSION } from "../../src/schema/index.js";
import { parseFolderTree } from "../../src/store/folder-tree-parser.js";
import { slugify } from "../../src/store/folder-tree-serializer.js";
import {
  handleAddItem,
  handleEditItem,
  handleUpdateTaskStatus,
  handleMoveItem,
  handleMergeItems,
} from "../../src/cli/mcp-tools.js";
import type { PRDDocument, PRDItem } from "../../src/schema/index.js";
import { PRD_TREE_DIRNAME } from "../../src/store/index.js";

// ── Setup helpers ─────────────────────────────────────────────────────────────

async function setupRexDir(tmpDir: string) {
  const rexDir = join(tmpDir, ".rex");
  await ensureRexDir(rexDir);
  const store = createStore("file", rexDir);
  const doc: PRDDocument = { schema: SCHEMA_VERSION, title: "MCP Tree Test", items: [] };
  await store.saveDocument(doc);
  return { rexDir, store };
}

/** Parse the folder tree and return all items flattened in traversal order. */
async function flatTreeItems(rexDir: string): Promise<PRDItem[]> {
  const treeRoot = join(rexDir, PRD_TREE_DIRNAME);
  const { items } = await parseFolderTree(treeRoot);
  const flat: PRDItem[] = [];
  function collect(list: PRDItem[]) {
    for (const item of list) {
      flat.push(item);
      if (item.children) collect(item.children);
    }
  }
  collect(items);
  return flat;
}

/** Parse the folder tree and return the top-level epic items (with children). */
async function treeEpics(rexDir: string): Promise<PRDItem[]> {
  const treeRoot = join(rexDir, PRD_TREE_DIRNAME);
  const { items, warnings } = await parseFolderTree(treeRoot);
  expect(warnings).toHaveLength(0);
  return items;
}

/**
 * Read the markdown file for an item given its directory path. Uses the same
 * discovery rule as the production parser: prefer a single non-`index.md`
 * markdown file, falling back to `index.md`.
 */
async function readIndexMd(rexDir: string, ...pathParts: string[]): Promise<string> {
  const itemDir = join(rexDir, PRD_TREE_DIRNAME, ...pathParts);
  const entries = await readdir(itemDir);
  const titleNamed = entries.filter((f) => f.endsWith(".md") && f !== "index.md");
  if (titleNamed.length === 1) return readFile(join(itemDir, titleNamed[0]), "utf-8");
  return readFile(join(itemDir, "index.md"), "utf-8");
}

/** Resolve the slug directory name for an item. */
function slug(title: string, id: string): string {
  return slugify(title, id);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MCP write tools — folder tree state", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-mcp-tree-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── add_item ────────────────────────────────────────────────────────────────

  it("add_item epic creates one epic directory in the tree", async () => {
    const { rexDir, store } = await setupRexDir(tmpDir);

    const res = await handleAddItem(store, tmpDir, rexDir, { title: "My Epic", level: "epic" });
    expect(res.isError).toBeFalsy();
    const { id } = JSON.parse(res.content[0].text) as { id: string };

    const epics = await treeEpics(rexDir);
    expect(epics).toHaveLength(1);
    expect(epics[0].id).toBe(id);
    expect(epics[0].title).toBe("My Epic");
    expect(epics[0].level).toBe("epic");
  });

  it("add_item epic → feature → task produces 3-level nesting", async () => {
    const { rexDir, store } = await setupRexDir(tmpDir);

    const epicRes = await handleAddItem(store, tmpDir, rexDir, { title: "Epic A", level: "epic" });
    const { id: epicId } = JSON.parse(epicRes.content[0].text) as { id: string };

    const featRes = await handleAddItem(store, tmpDir, rexDir, {
      title: "Feature B",
      level: "feature",
      parentId: epicId,
    });
    const { id: featId } = JSON.parse(featRes.content[0].text) as { id: string };

    const taskRes = await handleAddItem(store, tmpDir, rexDir, {
      title: "Task C",
      level: "task",
      parentId: featId,
    });
    const { id: taskId } = JSON.parse(taskRes.content[0].text) as { id: string };

    const epics = await treeEpics(rexDir);
    expect(epics).toHaveLength(1);
    expect(epics[0].id).toBe(epicId);
    expect(epics[0].children).toHaveLength(1);
    expect(epics[0].children![0].id).toBe(featId);
    expect(epics[0].children![0].children).toHaveLength(1);
    expect(epics[0].children![0].children![0].id).toBe(taskId);
  });

  it("add_item parent index.md contains ## Children table listing children", async () => {
    const { rexDir, store } = await setupRexDir(tmpDir);

    const epicRes = await handleAddItem(store, tmpDir, rexDir, { title: "Parent Epic", level: "epic" });
    const { id: epicId } = JSON.parse(epicRes.content[0].text) as { id: string };

    const featRes = await handleAddItem(store, tmpDir, rexDir, {
      title: "Child Feature",
      level: "feature",
      parentId: epicId,
    });
    const { id: featId } = JSON.parse(featRes.content[0].text) as { id: string };

    const epicSlug = slug("Parent Epic", epicId);
    const epicIndexMd = await readIndexMd(rexDir, epicSlug);
    expect(epicIndexMd).toContain("## Children");
    expect(epicIndexMd).toContain("Child Feature");
    // Children table links to feature subdirectory
    const featSlug = slug("Child Feature", featId);
    expect(epicIndexMd).toContain(`./${featSlug}/index.md`);
  });

  it("add_item three epics produces three directories, each with correct id", async () => {
    const { rexDir, store } = await setupRexDir(tmpDir);

    const ids: string[] = [];
    for (const title of ["Alpha", "Beta", "Gamma"]) {
      const res = await handleAddItem(store, tmpDir, rexDir, { title, level: "epic" });
      const { id } = JSON.parse(res.content[0].text) as { id: string };
      ids.push(id);
    }

    const epics = await treeEpics(rexDir);
    expect(epics).toHaveLength(3);
    const treeIds = epics.map((e) => e.id);
    for (const id of ids) {
      expect(treeIds).toContain(id);
    }
  });

  // ── edit_item ────────────────────────────────────────────────────────────────

  it("edit_item title update renames slug and writes new title in index.md", async () => {
    const { rexDir, store } = await setupRexDir(tmpDir);

    const addRes = await handleAddItem(store, tmpDir, rexDir, { title: "Original Title", level: "epic" });
    const { id } = JSON.parse(addRes.content[0].text) as { id: string };

    const editRes = await handleEditItem(store, tmpDir, { id, title: "Renamed Title" });
    expect(editRes.isError).toBeFalsy();

    const epics = await treeEpics(rexDir);
    expect(epics).toHaveLength(1);
    expect(epics[0].title).toBe("Renamed Title");

    // New slug directory exists with updated index.md
    const newSlug = slug("Renamed Title", id);
    const indexMd = await readIndexMd(rexDir, newSlug);
    expect(indexMd).toContain(`"Renamed Title"`);
  });

  it("edit_item description update reflects in index.md", async () => {
    const { rexDir, store } = await setupRexDir(tmpDir);

    const addRes = await handleAddItem(store, tmpDir, rexDir, { title: "Desc Epic", level: "epic" });
    const { id } = JSON.parse(addRes.content[0].text) as { id: string };

    await handleEditItem(store, tmpDir, { id, description: "Updated description text" });

    const epicSlug = slug("Desc Epic", id);
    const indexMd = await readIndexMd(rexDir, epicSlug);
    expect(indexMd).toContain("Updated description text");
  });

  it("edit_item priority update reflects in index.md", async () => {
    const { rexDir, store } = await setupRexDir(tmpDir);

    const epicRes = await handleAddItem(store, tmpDir, rexDir, { title: "Prio Epic", level: "epic" });
    const { id: epicId } = JSON.parse(epicRes.content[0].text) as { id: string };
    const featRes = await handleAddItem(store, tmpDir, rexDir, {
      title: "Prio Feature",
      level: "feature",
      parentId: epicId,
    });
    const { id: featId } = JSON.parse(featRes.content[0].text) as { id: string };
    const taskRes = await handleAddItem(store, tmpDir, rexDir, {
      title: "Prio Task",
      level: "task",
      parentId: featId,
    });
    const { id: taskId } = JSON.parse(taskRes.content[0].text) as { id: string };

    await handleEditItem(store, tmpDir, { id: taskId, priority: "critical" });

    const flat = await flatTreeItems(rexDir);
    const task = flat.find((i) => i.id === taskId);
    expect(task?.priority).toBe("critical");

    // The feature has a single child (the task) so single-child compaction
    // collapses its directory. The task's file is written directly under the
    // epic's directory with __parent* metadata embedded.
    const epicSlug = slug("Prio Epic", epicId);
    const taskSlug = slug("Prio Task", taskId);
    const taskIndexMd = await readIndexMd(rexDir, epicSlug, taskSlug);
    expect(taskIndexMd).toContain(`"critical"`);
  });

  // ── update_task_status ───────────────────────────────────────────────────────

  it("update_task_status completed updates status in tree index.md", async () => {
    const { rexDir, store } = await setupRexDir(tmpDir);

    const epicRes = await handleAddItem(store, tmpDir, rexDir, { title: "Status Epic", level: "epic" });
    const { id: epicId } = JSON.parse(epicRes.content[0].text) as { id: string };
    const featRes = await handleAddItem(store, tmpDir, rexDir, {
      title: "Status Feature",
      level: "feature",
      parentId: epicId,
    });
    const { id: featId } = JSON.parse(featRes.content[0].text) as { id: string };
    const taskRes = await handleAddItem(store, tmpDir, rexDir, {
      title: "Status Task",
      level: "task",
      parentId: featId,
    });
    const { id: taskId } = JSON.parse(taskRes.content[0].text) as { id: string };

    const updateRes = await handleUpdateTaskStatus(store, tmpDir, {
      id: taskId,
      status: "completed",
      resolutionType: "code-change",
    });
    expect(updateRes.isError).toBeFalsy();

    const flat = await flatTreeItems(rexDir);
    const task = flat.find((i) => i.id === taskId);
    expect(task?.status).toBe("completed");

    // Feature is single-child-compacted — its directory does not exist on disk.
    const epicSlug = slug("Status Epic", epicId);
    const taskSlug = slug("Status Task", taskId);
    const taskIndexMd = await readIndexMd(rexDir, epicSlug, taskSlug);
    expect(taskIndexMd).toContain(`"completed"`);
  });

  it("update_task_status in_progress updates parent summary in ## Children table", async () => {
    const { rexDir, store } = await setupRexDir(tmpDir);

    const epicRes = await handleAddItem(store, tmpDir, rexDir, { title: "Parent Epic", level: "epic" });
    const { id: epicId } = JSON.parse(epicRes.content[0].text) as { id: string };
    const featRes = await handleAddItem(store, tmpDir, rexDir, {
      title: "Feat X",
      level: "feature",
      parentId: epicId,
    });
    const { id: featId } = JSON.parse(featRes.content[0].text) as { id: string };
    const taskRes = await handleAddItem(store, tmpDir, rexDir, {
      title: "Task X",
      level: "task",
      parentId: featId,
    });
    const { id: taskId } = JSON.parse(taskRes.content[0].text) as { id: string };
    // Add a sibling task so the feature has 2 children and is not collapsed
    // by single-child compaction. Without this the feature directory would
    // not exist on disk.
    await handleAddItem(store, tmpDir, rexDir, {
      title: "Task Y",
      level: "task",
      parentId: featId,
    });

    await handleUpdateTaskStatus(store, tmpDir, { id: taskId, status: "in_progress" });

    // Feature index.md (parent summary) should show updated status for its task
    const epicSlug = slug("Parent Epic", epicId);
    const featSlug = slug("Feat X", featId);
    const featIndexMd = await readIndexMd(rexDir, epicSlug, featSlug);
    // ## Children table lists tasks with their current status
    expect(featIndexMd).toContain("## Children");
    expect(featIndexMd).toContain("Task X");
    expect(featIndexMd).toContain("in_progress");
  });

  it("update_task_status deleted removes item directory from tree", async () => {
    const { rexDir, store } = await setupRexDir(tmpDir);

    const epicRes = await handleAddItem(store, tmpDir, rexDir, { title: "Del Epic", level: "epic" });
    const { id: epicId } = JSON.parse(epicRes.content[0].text) as { id: string };

    // Verify epic exists in tree
    const epicsBefore = await treeEpics(rexDir);
    expect(epicsBefore.map((e) => e.id)).toContain(epicId);

    const deleteRes = await handleUpdateTaskStatus(store, tmpDir, {
      id: epicId,
      status: "deleted",
      force: true,
    });
    expect(deleteRes.isError).toBeFalsy();

    // Epic directory should be removed
    const epicsAfter = await treeEpics(rexDir);
    expect(epicsAfter.map((e) => e.id)).not.toContain(epicId);
  });

  // ── move_item ────────────────────────────────────────────────────────────────

  it("move_item feature to another epic updates tree directory structure", async () => {
    const { rexDir, store } = await setupRexDir(tmpDir);

    const epic1Res = await handleAddItem(store, tmpDir, rexDir, { title: "Epic One", level: "epic" });
    const { id: epic1Id } = JSON.parse(epic1Res.content[0].text) as { id: string };
    const epic2Res = await handleAddItem(store, tmpDir, rexDir, { title: "Epic Two", level: "epic" });
    const { id: epic2Id } = JSON.parse(epic2Res.content[0].text) as { id: string };
    const featRes = await handleAddItem(store, tmpDir, rexDir, {
      title: "Moving Feature",
      level: "feature",
      parentId: epic1Id,
    });
    const { id: featId } = JSON.parse(featRes.content[0].text) as { id: string };

    // Verify feature is under epic1 before move
    const epicsBefore = await treeEpics(rexDir);
    const epic1Before = epicsBefore.find((e) => e.id === epic1Id)!;
    expect(epic1Before.children?.map((c) => c.id)).toContain(featId);

    const moveRes = await handleMoveItem(store, rexDir, { id: featId, parentId: epic2Id });
    expect(moveRes.isError).toBeFalsy();

    // After move: feature under epic2, not epic1
    const epicsAfter = await treeEpics(rexDir);
    const epic1After = epicsAfter.find((e) => e.id === epic1Id)!;
    const epic2After = epicsAfter.find((e) => e.id === epic2Id)!;
    expect(epic1After.children?.map((c) => c.id) ?? []).not.toContain(featId);
    expect(epic2After.children?.map((c) => c.id) ?? []).toContain(featId);
  });

  it("move_item updates parent ## Children tables after move", async () => {
    const { rexDir, store } = await setupRexDir(tmpDir);

    const srcRes = await handleAddItem(store, tmpDir, rexDir, { title: "Source Epic", level: "epic" });
    const { id: srcId } = JSON.parse(srcRes.content[0].text) as { id: string };
    const dstRes = await handleAddItem(store, tmpDir, rexDir, { title: "Dest Epic", level: "epic" });
    const { id: dstId } = JSON.parse(dstRes.content[0].text) as { id: string };
    const featRes = await handleAddItem(store, tmpDir, rexDir, {
      title: "Migrating Feature",
      level: "feature",
      parentId: srcId,
    });
    const { id: featId } = JSON.parse(featRes.content[0].text) as { id: string };

    await handleMoveItem(store, rexDir, { id: featId, parentId: dstId });

    const srcSlug = slug("Source Epic", srcId);
    const dstSlug = slug("Dest Epic", dstId);
    const srcIndexMd = await readIndexMd(rexDir, srcSlug);
    const dstIndexMd = await readIndexMd(rexDir, dstSlug);

    // Source epic no longer lists the moved feature in its Children table
    expect(srcIndexMd).not.toContain("Migrating Feature");
    // Destination epic lists the moved feature
    expect(dstIndexMd).toContain("Migrating Feature");
  });

  // ── merge_items ──────────────────────────────────────────────────────────────

  it("merge_items removes source epic directory from tree", async () => {
    const { rexDir, store } = await setupRexDir(tmpDir);

    const targetRes = await handleAddItem(store, tmpDir, rexDir, {
      title: "Target Epic",
      level: "epic",
    });
    const { id: targetId } = JSON.parse(targetRes.content[0].text) as { id: string };
    const sourceRes = await handleAddItem(store, tmpDir, rexDir, {
      title: "Source Epic",
      level: "epic",
    });
    const { id: sourceId } = JSON.parse(sourceRes.content[0].text) as { id: string };

    // Both epics visible before merge
    expect((await treeEpics(rexDir)).map((e) => e.id)).toContain(sourceId);
    expect((await treeEpics(rexDir)).map((e) => e.id)).toContain(targetId);

    // sourceIds must include targetId; items not equal to targetId are absorbed
    const mergeRes = await handleMergeItems(store, rexDir, {
      sourceIds: [sourceId, targetId],
      targetId,
    });
    expect(mergeRes.isError).toBeFalsy();

    // Source epic directory removed; target retained
    const epicsAfter = await treeEpics(rexDir);
    const ids = epicsAfter.map((e) => e.id);
    expect(ids).not.toContain(sourceId);
    expect(ids).toContain(targetId);
  });

  // ── item count assertions ────────────────────────────────────────────────────

  it("tree item count matches store item count after a sequence of mutations", async () => {
    const { rexDir, store } = await setupRexDir(tmpDir);

    // Add 2 epics, 1 feature, 2 tasks
    const e1Res = await handleAddItem(store, tmpDir, rexDir, { title: "Epic 1", level: "epic" });
    const { id: e1Id } = JSON.parse(e1Res.content[0].text) as { id: string };
    const e2Res = await handleAddItem(store, tmpDir, rexDir, { title: "Epic 2", level: "epic" });
    const { id: e2Id } = JSON.parse(e2Res.content[0].text) as { id: string };
    const fRes = await handleAddItem(store, tmpDir, rexDir, {
      title: "Feature",
      level: "feature",
      parentId: e1Id,
    });
    const { id: fId } = JSON.parse(fRes.content[0].text) as { id: string };
    const t1Res = await handleAddItem(store, tmpDir, rexDir, {
      title: "Task 1",
      level: "task",
      parentId: fId,
    });
    const { id: t1Id } = JSON.parse(t1Res.content[0].text) as { id: string };
    const t2Res = await handleAddItem(store, tmpDir, rexDir, {
      title: "Task 2",
      level: "task",
      parentId: fId,
    });
    const { id: t2Id } = JSON.parse(t2Res.content[0].text) as { id: string };

    const flat = await flatTreeItems(rexDir);
    // tree should contain all 5 items
    expect(flat).toHaveLength(5);
    const treeIds = flat.map((i) => i.id);
    for (const id of [e1Id, e2Id, fId, t1Id, t2Id]) {
      expect(treeIds).toContain(id);
    }

    // Remove task 1 — tree should now have 4 items
    await handleUpdateTaskStatus(store, tmpDir, { id: t1Id, status: "deleted", force: true });
    const flatAfterDelete = await flatTreeItems(rexDir);
    expect(flatAfterDelete).toHaveLength(4);
    expect(flatAfterDelete.map((i) => i.id)).not.toContain(t1Id);
  });
});
