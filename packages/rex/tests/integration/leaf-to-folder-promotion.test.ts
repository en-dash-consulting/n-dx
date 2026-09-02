/**
 * Integration test: when a leaf `<slug>.md` item gains its first child it is
 * promoted to a folder containing `index.md` (frontmatter from the original
 * leaf is preserved) and the child is written into that folder. Reversing
 * (removing the last child) demotes the folder back to a bare `<slug>.md`.
 *
 * This is the third PRD-storage rule in user-facing terms: "if a subtask is
 * to be brought off a task which is a .md file, the contents would then be
 * transferred to an index.md file within a folder in the place of the task's
 * .md file" — verified end-to-end through `addItem` and `removeItem`, not
 * just through the serializer in isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FolderTreeStore } from "../../src/store/folder-tree-store.js";
import { PRD_TREE_DIRNAME } from "../../src/store/index.js";
import { slugify } from "../../src/store/folder-tree-serializer.js";
import type { PRDItem } from "../../src/schema/index.js";

let testDir: string;
let rexDir: string;
let treeRoot: string;
let store: FolderTreeStore;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "leaf-to-folder-"));
  rexDir = join(testDir, ".rex");
  treeRoot = join(rexDir, PRD_TREE_DIRNAME);
  store = new FolderTreeStore(rexDir);
  await store.saveDocument({ schema: "rex/v1", title: "Promotion Test", items: [] });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("Leaf-to-folder promotion via addItem", () => {
  it("promotes a leaf task to a folder when its first subtask is added", async () => {
    // Seed an epic > feature > leaf task. The task starts as a bare
    // `<slug>.md` next to the feature's `index.md`.
    const epic: PRDItem = {
      id: "11111111-1111-1111-1111-111111111111",
      level: "epic",
      title: "Epic",
      status: "pending",
      children: [
        {
          id: "22222222-2222-2222-2222-222222222222",
          level: "feature",
          title: "Feature",
          status: "pending",
          acceptanceCriteria: [],
          children: [
            {
              id: "33333333-3333-3333-3333-333333333333",
              level: "task",
              title: "Original Task",
              status: "in_progress",
              priority: "high",
              description: "Distinctive task description for promotion test.",
              acceptanceCriteria: ["Original criterion"],
            } as PRDItem,
          ],
        } as PRDItem,
      ],
    };
    await store.saveDocument({ schema: "rex/v1", title: "Promotion Test", items: [epic] });

    const featureDir = join(treeRoot, slugify(epic.title), slugify("Feature", epic.children![0].id));
    const taskSlug = slugify("Original Task", epic.children![0].children![0].id);
    const leafTaskPath = join(featureDir, `${taskSlug}.md`);

    // Pre-condition: the task is a bare `<slug>.md` next to the feature's
    // `index.md`. There is no folder for it yet.
    const taskStat = await stat(leafTaskPath);
    expect(taskStat.isFile()).toBe(true);
    await expect(stat(join(featureDir, taskSlug))).rejects.toThrow();
    const originalLeafContent = await readFile(leafTaskPath, "utf-8");
    expect(originalLeafContent).toContain('id: "33333333-3333-3333-3333-333333333333"');
    expect(originalLeafContent).toContain('"Original Task"');
    expect(originalLeafContent).toContain('"in_progress"');
    expect(originalLeafContent).toContain('"high"');
    expect(originalLeafContent).toContain("Distinctive task description for promotion test.");
    expect(originalLeafContent).toContain('"Original criterion"');

    // Add a subtask under the leaf task — this should trigger promotion.
    await store.addItem(
      {
        id: "44444444-4444-4444-4444-444444444444",
        level: "subtask",
        title: "First Subtask",
        status: "pending",
      } as PRDItem,
      "33333333-3333-3333-3333-333333333333",
    );

    // Post-condition (Rule 2): the bare `.md` file is gone, replaced with
    // a folder of the same slug containing `index.md` (carrying the task's
    // original frontmatter unchanged) plus the new subtask's leaf `.md`.
    await expect(stat(leafTaskPath)).rejects.toThrow();
    const newTaskDir = join(featureDir, taskSlug);
    const taskDirStat = await stat(newTaskDir);
    expect(taskDirStat.isDirectory()).toBe(true);

    const newIndexContent = await readFile(join(newTaskDir, "index.md"), "utf-8");
    // Original frontmatter survives intact.
    expect(newIndexContent).toContain('id: "33333333-3333-3333-3333-333333333333"');
    expect(newIndexContent).toContain('"Original Task"');
    expect(newIndexContent).toContain('"in_progress"');
    expect(newIndexContent).toContain('"high"');
    expect(newIndexContent).toContain("Distinctive task description for promotion test.");
    expect(newIndexContent).toContain('"Original criterion"');
    // And the new index.md now lists the new child.
    expect(newIndexContent).toContain("## Children");
    expect(newIndexContent).toContain("First Subtask");
    expect(newIndexContent).not.toContain("__parent");

    // The new child is a leaf itself (no grandchildren) and lives inside
    // the promoted folder as `<sub-slug>.md`.
    const subSlug = slugify("First Subtask", "44444444-4444-4444-4444-444444444444");
    const subPath = join(newTaskDir, `${subSlug}.md`);
    const subStat = await stat(subPath);
    expect(subStat.isFile()).toBe(true);
    const subContent = await readFile(subPath, "utf-8");
    expect(subContent).toContain('id: "44444444-4444-4444-4444-444444444444"');
    expect(subContent).toContain('"subtask"');

    // Round-trip parse confirms the new child is visible in the doc.
    const reloaded = await store.loadDocument();
    const task = reloaded.items[0].children![0].children![0];
    expect(task.id).toBe("33333333-3333-3333-3333-333333333333");
    expect(task.children).toHaveLength(1);
    expect(task.children![0].id).toBe("44444444-4444-4444-4444-444444444444");
  });

  it("demotes a folder back to a bare `<slug>.md` when its last child is removed", async () => {
    const epic: PRDItem = {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      level: "epic",
      title: "Epic",
      status: "pending",
      children: [
        {
          id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          level: "feature",
          title: "Feature",
          status: "pending",
          acceptanceCriteria: [],
          children: [
            {
              id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
              level: "task",
              title: "Branch Task",
              status: "pending",
              acceptanceCriteria: [],
              description: "A branch task that will lose its only child.",
              children: [
                {
                  id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
                  level: "subtask",
                  title: "Lone Subtask",
                  status: "pending",
                } as PRDItem,
              ],
            } as PRDItem,
          ],
        } as PRDItem,
      ],
    };
    await store.saveDocument({ schema: "rex/v1", title: "Promotion Test", items: [epic] });

    const featureDir = join(treeRoot, slugify(epic.title), slugify("Feature", epic.children![0].id));
    const taskSlug = slugify("Branch Task", "cccccccc-cccc-cccc-cccc-cccccccccccc");
    const taskDir = join(featureDir, taskSlug);

    // Pre-condition: branch task is a folder with `index.md` and one leaf child.
    expect((await stat(taskDir)).isDirectory()).toBe(true);
    const beforeIndex = await readFile(join(taskDir, "index.md"), "utf-8");
    expect(beforeIndex).toContain("Lone Subtask");

    await store.removeItem("dddddddd-dddd-dddd-dddd-dddddddddddd");

    // Post-condition: the now-childless task collapses to a bare `<slug>.md`
    // file, and the original folder is gone.
    await expect(stat(taskDir)).rejects.toThrow();
    const taskFile = join(featureDir, `${taskSlug}.md`);
    const taskFileStat = await stat(taskFile);
    expect(taskFileStat.isFile()).toBe(true);
    const afterContent = await readFile(taskFile, "utf-8");
    expect(afterContent).toContain('id: "cccccccc-cccc-cccc-cccc-cccccccccccc"');
    expect(afterContent).toContain('"Branch Task"');
    expect(afterContent).toContain("A branch task that will lose its only child.");
    // No `## Children` section — the leaf shape carries only frontmatter.
    expect(afterContent).not.toContain("## Children");
  });

  it("preserves the leaf's frontmatter byte-for-byte through the round-trip", async () => {
    // Verify that promotion is a pure shape change — every field present on
    // the leaf is present on the promoted `index.md` with the same value.
    const epic: PRDItem = {
      id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
      level: "epic",
      title: "Epic",
      status: "pending",
      children: [
        {
          id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
          level: "task",
          title: "Detail-Heavy Task",
          status: "completed",
          priority: "critical",
          tags: ["alpha", "beta"],
          source: "manual",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-02T00:00:00.000Z",
          resolutionType: "code-change",
          resolutionDetail: "Did the work.",
          acceptanceCriteria: ["Crit one", "Crit two"],
          description: "Body text with: punctuation. And newlines.\n\nAnd a blank line.",
        } as PRDItem,
      ],
    };
    await store.saveDocument({ schema: "rex/v1", title: "Promotion Test", items: [epic] });

    const epicDir = join(treeRoot, slugify(epic.title));
    const taskSlug = slugify("Detail-Heavy Task", "ffffffff-ffff-ffff-ffff-ffffffffffff");
    const beforeContent = await readFile(join(epicDir, `${taskSlug}.md`), "utf-8");

    await store.addItem(
      {
        id: "f0f0f0f0-f0f0-f0f0-f0f0-f0f0f0f0f0f0",
        level: "subtask",
        title: "Promoter",
        status: "pending",
      } as PRDItem,
      "ffffffff-ffff-ffff-ffff-ffffffffffff",
    );

    const afterContent = await readFile(join(epicDir, taskSlug, "index.md"), "utf-8");

    // Every frontmatter field that was on the leaf is still on the index.md.
    const fieldsToPreserve = [
      'id: "ffffffff-ffff-ffff-ffff-ffffffffffff"',
      'level: "task"',
      'title: "Detail-Heavy Task"',
      'status: "completed"',
      'priority: "critical"',
      '"alpha"',
      '"beta"',
      'source: "manual"',
      'startedAt: "2026-01-01T00:00:00.000Z"',
      'completedAt: "2026-01-02T00:00:00.000Z"',
      'resolutionType: "code-change"',
      'resolutionDetail: "Did the work."',
      '"Crit one"',
      '"Crit two"',
    ];
    for (const field of fieldsToPreserve) {
      expect(afterContent).toContain(field);
      expect(beforeContent).toContain(field);
    }

    // Description body is preserved.
    expect(afterContent).toContain("Body text with");
    expect(afterContent).toContain("punctuation");
    expect(afterContent).toContain("blank line");

    // The promotion adds a `## Children` block but does not introduce any
    // `__parent*` shim fields.
    expect(afterContent).toContain("## Children");
    expect(afterContent).not.toContain("__parent");
  });
});
