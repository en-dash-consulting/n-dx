/**
 * Integration tests: reshape creates a generated parent for hash-suffixed siblings.
 *
 * Verifies that when the reshape pipeline encounters three sibling items whose
 * titles share the same base with only a hash suffix distinguishing them, it:
 *   1. Creates a new parent item (folder-tree write path) with the stripped title
 *   2. Reparents all three siblings under the new parent
 *   3. Preserves IDs, status, tags, LoE, and child subtrees
 *   4. Records a group audit-trail entry in archive.json
 *   5. Single-child compaction: no parent created when only one member
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { applyReshape } from "../../src/core/reshape.js";
import { detectHashSuffixDuplicatesInTree } from "../../src/cli/commands/add-reshape.js";
import { serializeFolderTree } from "../../src/store/folder-tree-serializer.js";
import { parseFolderTree } from "../../src/store/folder-tree-parser.js";
import { loadArchive, ARCHIVE_FILE } from "../../src/core/archive.js";
import { toCanonicalJSON } from "../../src/core/canonical.js";
import type { PRDItem } from "../../src/schema/index.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEpic(id: string, title: string, children?: PRDItem[]): PRDItem {
  return { id, title, level: "epic", status: "pending", children };
}

function makeFeature(id: string, title: string, children?: PRDItem[]): PRDItem {
  return { id, title, level: "feature", status: "pending", children };
}

function makeTask(id: string, title: string, extra?: Partial<PRDItem>): PRDItem {
  return { id, title, level: "task", status: "pending", ...extra };
}

function findById(arr: PRDItem[], id: string): PRDItem | undefined {
  for (const item of arr) {
    if (item.id === id) return item;
    const found = item.children ? findById(item.children, id) : undefined;
    if (found) return found;
  }
  return undefined;
}

// ── detectHashSuffixDuplicatesInTree — always-group strategy ──────────────────

describe("detectHashSuffixDuplicatesInTree — always-group for reshape", () => {
  it("emits GroupAction for three hash-suffixed tasks under an epic", () => {
    const items: PRDItem[] = [
      makeEpic("epic-1", "Code Health", [
        makeTask("t1", "Fix observation in global"),
        makeTask("t2", "Fix observation in global (a3f2)"),
        makeTask("t3", "Fix observation in global (b91c)"),
      ]),
    ];

    const groups = detectHashSuffixDuplicatesInTree(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(3);
    expect(groups[0].proposals).toHaveLength(1);
    expect(groups[0].proposals[0].action.action).toBe("group");
  });

  it("emits GroupAction for two hash-suffixed features under an epic (alwaysGroup overrides allHaveChildren)", () => {
    // Items have NO children — previously this would have been a merge, now it's a group
    const items: PRDItem[] = [
      makeEpic("epic-1", "Auth", [
        makeFeature("f1", "Implement login (abc)"),
        makeFeature("f2", "Implement login (def)"),
      ]),
    ];

    const groups = detectHashSuffixDuplicatesInTree(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].proposals[0].action.action).toBe("group");
  });

  it("skips singleton groups (single-child compaction rule)", () => {
    const items: PRDItem[] = [
      makeEpic("epic-1", "Work", [
        makeTask("t1", "Fix observation in global"),
        makeTask("t2", "Unrelated task"),
      ]),
    ];

    const groups = detectHashSuffixDuplicatesInTree(items);
    expect(groups).toHaveLength(0);
  });
});

// ── applyReshape — GroupAction materializes parent and reparents children ─────

describe("applyReshape — GroupAction creates parent and reparents hash-suffixed siblings", () => {
  it("groups three hash-suffixed tasks under new feature parent within an epic", () => {
    const epicId = "epic-1";
    const t1Id = "task-1";
    const t2Id = "task-2";
    const t3Id = "task-3";

    const items: PRDItem[] = [
      makeEpic(epicId, "Code Health", [
        makeTask(t1Id, "Fix observation in global"),
        makeTask(t2Id, "Fix observation in global (a3f2)"),
        makeTask(t3Id, "Fix observation in global (b91c)"),
      ]),
    ];

    const groups = detectHashSuffixDuplicatesInTree(items);
    const reshapeResult = applyReshape(items, groups.flatMap((g) => g.proposals));

    expect(reshapeResult.errors).toHaveLength(0);
    expect(reshapeResult.applied).toHaveLength(1);
    expect(reshapeResult.applied[0].action.action).toBe("group");

    // Epic should have one child: the new feature container
    const epic = findById(items, epicId);
    expect(epic?.children).toHaveLength(1);

    const container = epic!.children![0];
    expect(container.title).toBe("Fix observation in global");
    expect(container.level).toBe("feature"); // getContainerLevel("task") === "feature"

    // All three tasks are now under the container
    const childIds = container.children?.map((c) => c.id) ?? [];
    expect(childIds).toContain(t1Id);
    expect(childIds).toContain(t2Id);
    expect(childIds).toContain(t3Id);
  });

  it("preserves item IDs, status, tags, loe, and child subtrees through the move", () => {
    const epicId = "epic-1";
    const t1Id = "task-1";
    const t2Id = "task-2";
    const subtaskId = "subtask-a";

    const items: PRDItem[] = [
      makeEpic(epicId, "Work", [
        makeTask(t1Id, "Refactor module (abc)", {
          status: "in_progress",
          tags: ["backend", "perf"],
          loe: "M",
          children: [
            { id: subtaskId, title: "Sub-step", level: "subtask", status: "pending" },
          ],
        }),
        makeTask(t2Id, "Refactor module (def)", {
          status: "completed",
          tags: ["frontend"],
          loe: "S",
        }),
      ]),
    ];

    const groups = detectHashSuffixDuplicatesInTree(items);
    const reshapeResult = applyReshape(items, groups.flatMap((g) => g.proposals));

    expect(reshapeResult.errors).toHaveLength(0);

    const movedT1 = findById(items, t1Id);
    expect(movedT1).toBeDefined();
    expect(movedT1!.id).toBe(t1Id);
    expect(movedT1!.status).toBe("in_progress");
    expect(movedT1!.tags).toEqual(["backend", "perf"]);
    expect(movedT1!.loe).toBe("M");
    expect(movedT1!.children?.find((c) => c.id === subtaskId)).toBeDefined();

    const movedT2 = findById(items, t2Id);
    expect(movedT2!.status).toBe("completed");
    expect(movedT2!.tags).toEqual(["frontend"]);
    expect(movedT2!.loe).toBe("S");
  });

  it("records group audit trail", () => {
    const epicId = "epic-1";
    const items: PRDItem[] = [
      makeEpic(epicId, "Work", [
        makeTask("t1", "Fix bug (abc)"),
        makeTask("t2", "Fix bug (def)"),
        makeTask("t3", "Fix bug (ghi)"),
      ]),
    ];

    const groups = detectHashSuffixDuplicatesInTree(items);
    const reshapeResult = applyReshape(items, groups.flatMap((g) => g.proposals));

    expect(reshapeResult.groupAuditTrail).toHaveLength(1);
    const auditEntry = reshapeResult.groupAuditTrail[0];
    expect(auditEntry.originalParentId).toBe(epicId);
    expect(auditEntry.movedItemIds).toHaveLength(3);
    expect(auditEntry.movedItemIds).toContain("t1");
    expect(auditEntry.movedItemIds).toContain("t2");
    expect(auditEntry.movedItemIds).toContain("t3");
    expect(auditEntry.containerTitle).toBe("Fix bug");
    expect(typeof auditEntry.containerId).toBe("string");
    expect(auditEntry.reasoning).toBeTruthy();
  });
});

// ── Folder-tree write path: serialize → parse roundtrip ───────────────────────

describe("folder-tree write path — group operation produces correct on-disk structure", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `rex-reshape-group-${randomUUID()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    try { await rm(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it("serializes grouped items to folder tree and parses them back correctly", async () => {
    const epicId = "epic-1";
    const t1Id = "task-1";
    const t2Id = "task-2";
    const t3Id = "task-3";

    const items: PRDItem[] = [
      makeEpic(epicId, "Code Health", [
        makeTask(t1Id, "Fix observation in global"),
        makeTask(t2Id, "Fix observation in global (a3f2)"),
        makeTask(t3Id, "Fix observation in global (b91c)"),
      ]),
    ];

    // Apply reshape
    const groups = detectHashSuffixDuplicatesInTree(items);
    const reshapeResult = applyReshape(items, groups.flatMap((g) => g.proposals));
    expect(reshapeResult.errors).toHaveLength(0);

    // Serialize to folder tree
    const treeRoot = join(tmpDir, "prd_tree");
    await serializeFolderTree(items, treeRoot);

    // Parse back from disk
    const { items: parsed } = await parseFolderTree(treeRoot);

    // Verify structure matches in-memory result
    const parsedEpic = parsed.find((i) => i.id === epicId);
    expect(parsedEpic).toBeDefined();

    // Epic has exactly one child (the new feature container)
    const epicChildren = parsedEpic!.children ?? [];
    expect(epicChildren).toHaveLength(1);

    const container = epicChildren[0];
    expect(container.title).toBe("Fix observation in global");
    expect(container.level).toBe("feature");

    // Container has all three tasks
    const containerChildIds = (container.children ?? []).map((c) => c.id);
    expect(containerChildIds).toContain(t1Id);
    expect(containerChildIds).toContain(t2Id);
    expect(containerChildIds).toContain(t3Id);
  });
});

// ── Archive audit trail ───────────────────────────────────────────────────────

describe("archive audit trail for group operations", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `rex-reshape-group-archive-${randomUUID()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    try { await rm(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it("appends a groupAuditTrail entry to archive.json with pre-reshape commit, reasoning, and ID list", async () => {
    const epicId = "epic-1";
    const t1Id = "task-1";
    const t2Id = "task-2";
    const t3Id = "task-3";

    const items: PRDItem[] = [
      makeEpic(epicId, "Work", [
        makeTask(t1Id, "Fix observation in global"),
        makeTask(t2Id, "Fix observation in global (a3f2)"),
        makeTask(t3Id, "Fix observation in global (b91c)"),
      ]),
    ];

    const groups = detectHashSuffixDuplicatesInTree(items);
    const reshapeResult = applyReshape(items, groups.flatMap((g) => g.proposals));
    expect(reshapeResult.errors).toHaveLength(0);
    expect(reshapeResult.groupAuditTrail).toHaveLength(1);

    const groupRecord = reshapeResult.groupAuditTrail[0];

    // Simulate what cmdReshape writes to the archive
    const archivePath = join(tmpDir, ARCHIVE_FILE);
    const preReshapeCommit = "no-git";
    const batchTimestamp = new Date().toISOString();

    const { loadArchive: _load, trimArchive } = await import("../../src/core/archive.js");
    const archive = await _load(archivePath);

    archive.batches.push({
      timestamp: batchTimestamp,
      source: "reshape",
      items: reshapeResult.archivedItems,
      count: reshapeResult.archivedItems.length,
      reason: "Reshape: group",
      actions: groups.flatMap((g) => g.proposals),
      mergeAuditTrail: undefined,
      groupAuditTrail: [
        {
          containerId: groupRecord.containerId,
          containerTitle: groupRecord.containerTitle,
          originalParentId: groupRecord.originalParentId,
          movedItemIds: groupRecord.movedItemIds,
          reasoning: groupRecord.reasoning,
          preReshapeCommit,
          timestamp: batchTimestamp,
        },
      ],
    });
    trimArchive(archive);
    await writeFile(archivePath, toCanonicalJSON(archive), "utf-8");

    // Read back and verify
    const saved = await loadArchive(archivePath);
    expect(saved.batches).toHaveLength(1);
    const batch = saved.batches[0];
    expect(batch.groupAuditTrail).toBeDefined();
    expect(batch.groupAuditTrail!).toHaveLength(1);

    const entry = batch.groupAuditTrail![0];
    expect(entry.preReshapeCommit).toBe("no-git");
    expect(entry.reasoning).toBeTruthy();
    expect(entry.movedItemIds).toEqual(expect.arrayContaining([t1Id, t2Id, t3Id]));
    expect(entry.originalParentId).toBe(epicId);
    expect(entry.containerTitle).toBe("Fix observation in global");

    // No JSON PRD files produced — only archive.json (audit) and folder-tree (PRD state)
    const archiveContent = await readFile(archivePath, "utf-8");
    const parsed = JSON.parse(archiveContent);
    expect(parsed.schema).toBe("rex/archive/v1");
  });
});
