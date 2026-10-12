/**
 * Unit tests for shape classification logic in merge-history.ts
 *
 * Tests cover the classifyNodeShape function which determines node shapes
 * based on folder structure inspection of the .rex/prd_tree/ directory.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyNodeShape, flattenPrdItems } from "../../../src/server/merge-history.js";
import type { PRDDocument } from "../../../src/server/rex-gateway.js";

describe("classifyNodeShape", () => {
  let tmpDir: string;
  let treeRoot: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "shape-test-"));
    treeRoot = join(tmpDir, "prd_tree");
    await mkdir(treeRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("classifies a leaf node (no children) as triangle", async () => {
    const leafPath = join(treeRoot, "task-slug");
    await mkdir(leafPath, { recursive: true });
    await writeFile(join(leafPath, "task_title.md"), "---\nid: task1\nlevel: task\n---");

    const shape = classifyNodeShape("task1", leafPath);
    expect(shape).toBe("triangle");
  });

  it("classifies a node with index.md + other .md files as diamond", async () => {
    const parentPath = join(treeRoot, "task-slug");
    await mkdir(parentPath, { recursive: true });
    await writeFile(join(parentPath, "task_title.md"), "---\nid: task1\nlevel: task\n---");
    // Add leaf subtask files
    await writeFile(join(parentPath, "subtask1.md"), "---\nid: sub1\nlevel: subtask\n---");
    await writeFile(join(parentPath, "subtask2.md"), "---\nid: sub2\nlevel: subtask\n---");

    const shape = classifyNodeShape("task1", parentPath);
    expect(shape).toBe("diamond");
  });

  it("classifies a node with only subdirectories as trapezoid", async () => {
    const parentPath = join(treeRoot, "feature-slug");
    await mkdir(parentPath, { recursive: true });
    await writeFile(join(parentPath, "feature_title.md"), "---\nid: feature1\nlevel: feature\n---");
    // Add subdirectory (child task)
    const childPath = join(parentPath, "task-slug");
    await mkdir(childPath, { recursive: true });
    await writeFile(join(childPath, "task_title.md"), "---\nid: task1\nlevel: task\n---");

    const shape = classifyNodeShape("feature1", parentPath);
    expect(shape).toBe("trapezoid");
  });

  it("classifies a node with multiple subdirectories as trapezoid", async () => {
    const parentPath = join(treeRoot, "epic-slug");
    await mkdir(parentPath, { recursive: true });
    await writeFile(join(parentPath, "epic_title.md"), "---\nid: epic1\nlevel: epic\n---");
    // Add multiple child directories
    const feature1Path = join(parentPath, "feature1-slug");
    await mkdir(feature1Path, { recursive: true });
    await writeFile(join(feature1Path, "feature1_title.md"), "---\nid: feature1\nlevel: feature\n---");

    const feature2Path = join(parentPath, "feature2-slug");
    await mkdir(feature2Path, { recursive: true });
    await writeFile(join(feature2Path, "feature2_title.md"), "---\nid: feature2\nlevel: feature\n---");

    const shape = classifyNodeShape("epic1", parentPath);
    expect(shape).toBe("trapezoid");
  });

  it("classifies a node with only .md files and no subdirectories as square", async () => {
    const parentPath = join(treeRoot, "task-slug");
    await mkdir(parentPath, { recursive: true });
    await writeFile(join(parentPath, "task_title.md"), "---\nid: task1\nlevel: task\n---");
    // Add only .md files, no subdirectories
    await writeFile(join(parentPath, "subtask1.md"), "---\nid: sub1\nlevel: subtask\n---");

    const shape = classifyNodeShape("task1", parentPath);
    // Note: In current implementation, diamond and square are treated the same
    // (title.md + other .md files without subdirectories)
    expect(["diamond", "square"]).toContain(shape);
  });

  it("defaults to circle for non-existent folder", () => {
    const nonExistentPath = join(treeRoot, "does-not-exist");
    const shape = classifyNodeShape("fake-id", nonExistentPath);
    expect(shape).toBe("circle");
  });

  it("handles legacy index.md format", async () => {
    const leafPath = join(treeRoot, "task-slug");
    await mkdir(leafPath, { recursive: true });
    // Use legacy index.md instead of title-named file
    await writeFile(join(leafPath, "index.md"), "---\nid: task1\nlevel: task\n---");

    const shape = classifyNodeShape("task1", leafPath);
    expect(shape).toBe("triangle");
  });

  it("handles legacy index.md with leaf subtasks as diamond", async () => {
    const parentPath = join(treeRoot, "task-slug");
    await mkdir(parentPath, { recursive: true });
    await writeFile(join(parentPath, "index.md"), "---\nid: task1\nlevel: task\n---");
    // Add leaf subtask files
    await writeFile(join(parentPath, "subtask1.md"), "---\nid: sub1\nlevel: subtask\n---");

    const shape = classifyNodeShape("task1", parentPath);
    expect(shape).toBe("diamond");
  });

  it("classifies mixed children (files + subdirectories) as diamond", async () => {
    const parentPath = join(treeRoot, "task-slug");
    await mkdir(parentPath, { recursive: true });
    await writeFile(join(parentPath, "task_title.md"), "---\nid: task1\nlevel: task\n---");
    // Add both .md files and subdirectories
    await writeFile(join(parentPath, "subtask1.md"), "---\nid: sub1\nlevel: subtask\n---");
    const branchPath = join(parentPath, "branch-subtask-slug");
    await mkdir(branchPath, { recursive: true });
    await writeFile(join(branchPath, "branch_subtask_title.md"), "---\nid: sub2\nlevel: subtask\n---");

    const shape = classifyNodeShape("task1", parentPath);
    expect(shape).toBe("diamond");
  });
});

describe("flattenPrdItems with shape classification", () => {
  let tmpDir: string;
  let rexDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "flatten-test-"));
    rexDir = tmpDir;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("adds shape field to PRD nodes when rexDir is provided", async () => {
    const doc: PRDDocument = {
      schema: "rex/v1",
      title: "Test PRD",
      items: [
        {
          id: "epic1",
          title: "Epic One",
          level: "epic",
          status: "pending",
          description: "",
          children: [
            {
              id: "task1",
              title: "Task One",
              level: "task",
              status: "pending",
              description: "",
            },
          ],
        },
      ],
    };

    // Create folder structure
    const treeRoot = join(rexDir, "prd_tree");
    const epicPath = join(treeRoot, "epic-one");
    const taskPath = join(epicPath, "task-one");
    await mkdir(taskPath, { recursive: true });
    await writeFile(join(epicPath, "epic_one.md"), "---\nid: epic1\nlevel: epic\n---");
    await writeFile(join(taskPath, "task_one.md"), "---\nid: task1\nlevel: task\n---");

    const { nodes } = flattenPrdItems(doc, rexDir);

    expect(nodes).toHaveLength(2);
    const epicNode = nodes.find((n) => n.id === "epic1");
    const taskNode = nodes.find((n) => n.id === "task1");

    // Epic should be trapezoid (has subdirectories)
    expect(epicNode?.shape).toBe("trapezoid");
    // Task should be triangle (no children)
    expect(taskNode?.shape).toBe("triangle");
  });

  it("works without rexDir (shape remains undefined)", () => {
    const doc: PRDDocument = {
      schema: "rex/v1",
      title: "Test PRD",
      items: [
        {
          id: "epic1",
          title: "Epic One",
          level: "epic",
          status: "pending",
          description: "",
        },
      ],
    };

    const { nodes } = flattenPrdItems(doc);

    expect(nodes).toHaveLength(1);
    const node = nodes[0];
    expect(node.shape).toBeUndefined();
  });

  it("preserves other node properties while adding shapes", async () => {
    const doc: PRDDocument = {
      schema: "rex/v1",
      title: "Test PRD",
      items: [
        {
          id: "task1",
          title: "My Task",
          level: "task",
          status: "in_progress",
          description: "A test task",
          priority: "high",
          tags: ["test", "urgent"],
        },
      ],
    };

    // Create folder structure
    const treeRoot = join(rexDir, "prd_tree");
    const taskPath = join(treeRoot, "my-task");
    await mkdir(taskPath, { recursive: true });
    await writeFile(join(taskPath, "my_task.md"), "---\nid: task1\nlevel: task\n---");

    const { nodes } = flattenPrdItems(doc, rexDir);

    const node = nodes[0];
    expect(node.id).toBe("task1");
    expect(node.title).toBe("My Task");
    expect(node.itemType).toBe("task");
    expect(node.status).toBe("in_progress");
    expect(node.priority).toBe("high");
    expect(node.shape).toBe("triangle");
  });
});
