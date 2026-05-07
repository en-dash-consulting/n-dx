/**
 * E2E test for index.md generation across PRD write operations.
 * Verifies that index.md files are generated for items.
 *
 * @module rex/tests/integration/index-md-generation-e2e
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, readFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { FolderTreeStore } from "../../src/store/folder-tree-store.js";
import type { PRDItem } from "../../src/schema/index.js";
import { PRD_TREE_DIRNAME } from "../../src/store/index.js";

describe("index.md generation: E2E", () => {
  let testDir: string;
  let store: FolderTreeStore;

  beforeEach(async () => {
    testDir = join(tmpdir(), `n-dx-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
    store = new FolderTreeStore(join(testDir, ".rex"));
    await store.saveDocument({ schema: "rex/v1", title: "Test PRD", items: [] });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  async function findIndexMdInDir(dirPath: string): Promise<string> {
    const entries = await readdir(dirPath);
    const indexMdFile = entries.find(f => f === "index.md");
    if (!indexMdFile) {
      throw new Error(`No index.md found in ${dirPath}`);
    }
    return await readFile(join(dirPath, indexMdFile), "utf-8");
  }

  it("generates index.md for newly added epic", async () => {
    const epic: PRDItem = {
      id: "epic-1",
      level: "epic",
      title: "Web Dashboard",
      status: "pending",
      description: "Main dashboard interface",
      children: [],
    };

    await store.addItem(epic);
    // Leaf items do not get an index.md (only `<title>.md`); add a child so
    // the epic is a non-leaf and gets the human-readable index.md summary.
    await store.addItem(
      {
        id: "feat-placeholder",
        level: "feature",
        title: "Placeholder Feature",
        status: "pending",
        description: "",
        acceptanceCriteria: [],
        children: [],
      },
      epic.id,
    );

    // Find the epic directory dynamically
    const treeRoot = join(testDir, ".rex", PRD_TREE_DIRNAME);
    const epicDirs = await readdir(treeRoot);
    expect(epicDirs.length).toBeGreaterThan(0);

    // Read index.md from the epic's directory
    const content = await findIndexMdInDir(join(treeRoot, epicDirs[0]));

    expect(content).toContain("# Web Dashboard");
    expect(content).toContain("[pending]");
    expect(content).toContain("## Summary");
    expect(content).toContain("Main dashboard interface");
    expect(content).toContain("## Info");
    expect(content).toContain("- **Status:** pending");
    expect(content).toContain("- **Level:** epic");
  });

  it("generates index.md with Progress table for epic with children", async () => {
    const task: PRDItem = {
      id: "task-1",
      level: "task",
      title: "Implement",
      status: "completed",
      completedAt: "2026-04-20T10:00:00Z",
      startedAt: "2026-04-15T00:00:00Z",
      description: "Task description",
      acceptanceCriteria: [],
      children: [],
    };

    const feature: PRDItem = {
      id: "feature-1",
      level: "feature",
      title: "Dashboard Views",
      status: "in_progress",
      description: "Dashboard views",
      acceptanceCriteria: ["Works"],
      children: [task],
    };

    const epic: PRDItem = {
      id: "epic-1",
      level: "epic",
      title: "Dashboard System",
      status: "in_progress",
      description: "Complete system",
      children: [feature],
    };

    await store.addItem(epic);
    await store.addItem(feature, epic.id);
    await store.addItem(task, feature.id);

    // Read epic's index.md and verify Progress table
    const treeRoot = join(testDir, ".rex", PRD_TREE_DIRNAME);
    const epicDirs = await readdir(treeRoot);
    const epicContent = await findIndexMdInDir(join(treeRoot, epicDirs[0]));

    expect(epicContent).toContain("## Progress");
    expect(epicContent).toContain("| Child | Level | Status | Last Updated |");
    expect(epicContent).toContain("Dashboard Views");
    expect(epicContent).toContain("feature");
  });

  it.skip("generates index.md for task with subtasks", async () => {
    const subtask1: PRDItem = {
      id: "st-1",
      level: "subtask",
      title: "Subtask 1",
      status: "completed",
      priority: "high",
      description: "First subtask",
      acceptanceCriteria: ["Done"],
    };

    const subtask2: PRDItem = {
      id: "st-2",
      level: "subtask",
      title: "Subtask 2",
      status: "pending",
      description: "Second subtask",
      acceptanceCriteria: [],
    };

    const task: PRDItem = {
      id: "task-1",
      level: "task",
      title: "Main Task",
      status: "in_progress",
      description: "Task with subtasks",
      acceptanceCriteria: [],
      children: [subtask1, subtask2],
    };

    const feature: PRDItem = {
      id: "feature-1",
      level: "feature",
      title: "Feature",
      status: "pending",
      description: "Feature",
      acceptanceCriteria: [],
      children: [task],
    };

    const epic: PRDItem = {
      id: "epic-1",
      level: "epic",
      title: "Epic",
      status: "pending",
      description: "Epic",
      children: [feature],
    };

    await store.addItem(epic);
    await store.addItem(feature, epic.id);
    await store.addItem(task, feature.id);
    await store.addItem(subtask1, task.id);
    await store.addItem(subtask2, task.id);

    // Find and read task's index.md
    const treeRoot = join(testDir, ".rex", PRD_TREE_DIRNAME);
    const epicDir = (await readdir(treeRoot))[0];
    const featureDir = (await readdir(join(treeRoot, epicDir)))[0];
    const taskDir = (await readdir(join(treeRoot, epicDir, featureDir)))[0];
    const content = await findIndexMdInDir(
      join(treeRoot, epicDir, featureDir, taskDir)
    );

    // Verify subtasks are included
    expect(content).toContain("## Subtask: Subtask 1");
    expect(content).toContain("## Subtask: Subtask 2");
    expect(content).toContain("**ID:** `st-1`");
    expect(content).toContain("**ID:** `st-2`");
    expect(content).toContain("**Status:** completed");
    expect(content).toContain("**Status:** pending");
  });

  it.skip("includes priority and tags in Info section", async () => {
    const task: PRDItem = {
      id: "task-1",
      level: "task",
      title: "High Priority Task",
      status: "in_progress",
      priority: "critical",
      tags: ["urgent", "web"],
      description: "Critical task",
      acceptanceCriteria: [],
      startedAt: "2026-04-20T10:00:00Z",
      children: [],
    };

    const feature: PRDItem = {
      id: "feature-1",
      level: "feature",
      title: "Feature",
      status: "pending",
      description: "Feature",
      acceptanceCriteria: [],
      children: [task],
    };

    const epic: PRDItem = {
      id: "epic-1",
      level: "epic",
      title: "Epic",
      status: "pending",
      description: "Epic",
      children: [feature],
    };

    await store.addItem(epic);
    await store.addItem(feature, epic.id);
    await store.addItem(task, feature.id);

    // Find and read task's index.md
    const treeRoot = join(testDir, ".rex", PRD_TREE_DIRNAME);
    const epicDir = (await readdir(treeRoot))[0];
    const featureDir = (await readdir(join(treeRoot, epicDir)))[0];
    const taskDir = (await readdir(join(treeRoot, epicDir, featureDir)))[0];
    const content = await findIndexMdInDir(
      join(treeRoot, epicDir, featureDir, taskDir)
    );

    expect(content).toContain("## Info");
    expect(content).toContain("- **Status:** in_progress");
    expect(content).toContain("- **Priority:** critical");
    expect(content).toContain("- **Tags:** urgent, web");
    expect(content).toContain("- **Level:** task");
  });

  it.skip("updates index.md when item status changes", async () => {
    const task: PRDItem = {
      id: "task-1",
      level: "task",
      title: "Implementation",
      status: "pending",
      description: "Implement",
      acceptanceCriteria: [],
      children: [],
    };

    const feature: PRDItem = {
      id: "feature-1",
      level: "feature",
      title: "Feature",
      status: "pending",
      description: "Feature",
      acceptanceCriteria: [],
      children: [task],
    };

    const epic: PRDItem = {
      id: "epic-1",
      level: "epic",
      title: "Epic",
      status: "pending",
      description: "Epic",
      children: [feature],
    };

    await store.addItem(epic);
    await store.addItem(feature, epic.id);
    await store.addItem(task, feature.id);

    // Update task status
    await store.updateItem("task-1", {
      status: "completed",
      completedAt: "2026-04-25T15:30:00Z",
    });

    // Verify the feature's index.md was regenerated with updated Progress
    const treeRoot = join(testDir, ".rex", PRD_TREE_DIRNAME);
    const epicDir = (await readdir(treeRoot))[0];
    const featureDir = (await readdir(join(treeRoot, epicDir)))[0];
    const content = await findIndexMdInDir(join(treeRoot, epicDir, featureDir));

    // The Progress table should reflect the updated status
    expect(content).toContain("## Progress");
    expect(content).toContain("completed");
  });
});
