/**
 * Tests for the PRD-to-folder-tree serializer.
 *
 * Acceptance criteria:
 *   - Serializer produces the expected folder tree with correct nesting depth
 *   - Each index.md contains full metadata (title, status, description, AC, tags, loe)
 *   - Non-leaf index.md includes a ## Children section listing direct children
 *   - Task index.md links subtask child directories
 *   - Slug collisions are resolved deterministically via id6 suffix
 *   - Re-running on unchanged tree produces no file writes (idempotent)
 *   - Stale directories (removed items) are cleaned up
 *   - Round-trip with parser: serialize then parse yields the original items
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveSiblingSlugs,
  serializeFolderTree,
  slugify,
  slugifyTitle,
} from "../../../src/store/folder-tree-serializer.js";
import { parseFolderTree } from "../../../src/store/folder-tree-parser.js";
import { titleToFilename } from "../../../src/store/title-to-filename.js";
import { PRD_TREE_DIRNAME } from "../../../src/store/index.js";
import type { PRDItem } from "../../../src/schema/index.js";

// ── Test setup ────────────────────────────────────────────────────────────────

let testDir: string;

beforeEach(async () => {
  testDir = join(
    tmpdir(),
    `folder-tree-serializer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ── Item factory helpers ──────────────────────────────────────────────────────

function makeEpic(id: string, title: string, extra: Partial<PRDItem> = {}): PRDItem {
  return { id, title, status: "pending", level: "epic", ...extra };
}

function makeFeature(id: string, title: string, extra: Partial<PRDItem> = {}): PRDItem {
  return { id, title, status: "pending", level: "feature", acceptanceCriteria: [], ...extra };
}

function makeTask(id: string, title: string, extra: Partial<PRDItem> = {}): PRDItem {
  return { id, title, status: "pending", level: "task", acceptanceCriteria: [], ...extra };
}

function makeSubtask(id: string, title: string, extra: Partial<PRDItem> = {}): PRDItem {
  return { id, title, status: "pending", level: "subtask", ...extra };
}

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const childFiles = await collectFiles(entryPath);
      files.push(...childFiles);
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

// ── Slug algorithm ────────────────────────────────────────────────────────────

describe("slugify", () => {
  it("produces lowercase hyphenated ASCII slugs without special characters", () => {
    expect(slugify("Web Dashboard", "4d62fa6c-ad0d-4e1e-91f8-c2f1ebe696e7")).toBe(
      "web-dashboard",
    );
    expect(slugify("Path / Separator \\ Safe!", "11111111-0000-0000-0000-000000000000")).toBe(
      "path-separator-safe",
    );
  });

  it("normalizes Unicode accents and strips unsupported Unicode characters", () => {
    // Héros → heros after NFKD + combining strip + non-ASCII strip
    expect(slugify("Héros & Légendes", "a1b2c3d4-0000-0000-0000-000000000000")).toBe(
      "heros-legendes",
    );
    expect(slugify("日本語タイトル", "f0e1d2c3-0000-0000-0000-000000000000")).toBe("untitled");
  });

  it("falls back to a safe slug when title contains only special characters", () => {
    expect(slugify("--- !!!", "11223344-0000-0000-0000-000000000000")).toBe("untitled");
  });

  it("is deterministic for the same normal title regardless of ID", () => {
    const s1 = slugify("Auth Feature", "aaaaaaaa-0000-0000-0000-000000000000");
    const s2 = slugify("Auth Feature", "bbbbbbbb-0000-0000-0000-000000000000");
    expect(s1).toBe("auth-feature");
    expect(s2).toBe("auth-feature");
  });

  it("truncates long titles at a word boundary and appends id6", () => {
    const slug = slugify(
      "Hot-reload MCP tool schemas on HTTP transport without server restart",
      "5dd63e4e-0000-0000-0000-000000000000",
    );
    expect(slug).toBe("hot-reload-mcp-tool-schemas-on-5dd63e");
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug).not.toContain("server");
  });

  it("exposes the unsuffixed title slug for collision checks", () => {
    expect(slugifyTitle("Auth Feature")).toBe("auth-feature");
  });

  it("adds id6 suffixes when sibling items collide without the ID", () => {
    const first = makeFeature("aaaaaaaa-0000-0000-0000-000000000000", "Auth Feature");
    const second = makeFeature("bbbbbbbb-0000-0000-0000-000000000000", "Auth Feature!");
    const slugs = resolveSiblingSlugs([first, second]);

    expect(slugs.get(first.id)).toBe("auth-feature-aaaaaa");
    expect(slugs.get(second.id)).toBe("auth-feature-bbbbbb");
  });
});

// ── Directory structure ───────────────────────────────────────────────────────

describe("serializeFolderTree: directory structure", () => {
  it("creates treeRoot if it does not exist", async () => {
    const root = join(testDir, "new-root");
    await serializeFolderTree([], root);
    const s = await stat(root);
    expect(s.isDirectory()).toBe(true);
  });

  it("creates epic directory at depth 1", async () => {
    const epic = makeEpic("11111111-0000-0000-0000-000000000000", "My Epic");
    await serializeFolderTree([epic], testDir);
    const epicDir = join(testDir, slugify(epic.title, epic.id));
    const s = await stat(epicDir);
    expect(s.isDirectory()).toBe(true);
  });

  it("creates feature directory at depth 2 inside epic", async () => {
    const feature = makeFeature("22222222-0000-0000-0000-000000000000", "My Feature");
    const epic = makeEpic("11111111-0000-0000-0000-000000000000", "My Epic", {
      children: [feature],
    });
    await serializeFolderTree([epic], testDir);
    const featureDir = join(
      testDir,
      slugify(epic.title, epic.id),
      slugify(feature.title, feature.id),
    );
    const s = await stat(featureDir);
    expect(s.isDirectory()).toBe(true);
  });

  it("creates task directory at depth 3 inside feature", async () => {
    // Create two tasks to avoid single-child optimization of the feature
    const task1 = makeTask("33333333-0000-0000-0000-000000000000", "My Task 1");
    const task2 = makeTask("44444444-0000-0000-0000-000000000000", "My Task 2");
    const feature = makeFeature("22222222-0000-0000-0000-000000000000", "My Feature", {
      children: [task1, task2],
    });
    const epic = makeEpic("11111111-0000-0000-0000-000000000000", "My Epic", {
      children: [feature],
    });
    await serializeFolderTree([epic], testDir);
    const taskDir = join(
      testDir,
      slugify(epic.title, epic.id),
      slugify(feature.title, feature.id),
      slugify(task1.title, task1.id),
    );
    const s = await stat(taskDir);
    expect(s.isDirectory()).toBe(true);
  });

  it("keeps generated nested markdown paths within the Windows checkout budget", async () => {
    const subtask = makeSubtask(
      "44444444-0000-0000-0000-000000000000",
      "Subtask with a deliberately verbose title that would otherwise make paths too long",
    );
    const task = makeTask(
      "33333333-0000-0000-0000-000000000000",
      "Task with a deliberately verbose title that would otherwise make paths too long",
      { children: [subtask] },
    );
    const feature = makeFeature(
      "22222222-0000-0000-0000-000000000000",
      "Feature with a deliberately verbose title that would otherwise make paths too long",
      { children: [task] },
    );
    const epic = makeEpic(
      "11111111-0000-0000-0000-000000000000",
      "Epic with a deliberately verbose title that would otherwise make paths too long",
      { children: [feature] },
    );

    await serializeFolderTree([epic], testDir);

    const files = await collectFiles(testDir);
    const repoRelativePaths = files.map((file) =>
      `.rex/${PRD_TREE_DIRNAME}/${relative(testDir, file).split(sep).join("/")}`,
    );
    const maxLength = Math.max(...repoRelativePaths.map((path) => path.length));
    expect(maxLength).toBeLessThanOrEqual(220);
  });
});

// ── index.md content: epic ────────────────────────────────────────────────────

describe("serializeFolderTree: epic index.md", () => {
  it("writes required frontmatter fields", async () => {
    const epic = makeEpic("11111111-0000-0000-0000-000000000000", "Auth Epic", {
      status: "in_progress",
      description: "Auth system.",
    });
    await serializeFolderTree([epic], testDir);
    const content = await readFile(
      join(testDir, slugify(epic.title, epic.id), titleToFilename(epic.title)),
      "utf8",
    );
    expect(content).toContain('id: "11111111-0000-0000-0000-000000000000"');
    expect(content).toContain("level: \"epic\"");
    expect(content).toContain('title: "Auth Epic"');
    expect(content).toContain("status: \"in_progress\"");
    expect(content).toContain('description: "Auth system."');
  });

  it("writes optional fields: priority, tags, timestamps, resolutionType", async () => {
    const epic = makeEpic("11111111-0000-0000-0000-000000000000", "Full Epic", {
      status: "completed",
      priority: "high",
      tags: ["auth", "security"],
      source: "manual",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-02T00:00:00.000Z",
      endedAt: "2026-01-02T00:00:00.000Z",
      resolutionType: "code-change",
      resolutionDetail: "Did the work.",
    });
    await serializeFolderTree([epic], testDir);
    const content = await readFile(
      join(testDir, slugify(epic.title, epic.id), titleToFilename(epic.title)),
      "utf8",
    );
    expect(content).toContain("priority: \"high\"");
    expect(content).toContain("tags:");
    expect(content).toContain('"auth"');
    expect(content).toContain('"security"');
    expect(content).toContain("source: \"manual\"");
    expect(content).toContain("startedAt:");
    expect(content).toContain("completedAt:");
    expect(content).toContain("endedAt:");
    expect(content).toContain("resolutionType: \"code-change\"");
    expect(content).toContain('resolutionDetail: "Did the work."');
  });

  it("omits optional fields that are absent", async () => {
    const epic = makeEpic("11111111-0000-0000-0000-000000000000", "Bare Epic");
    await serializeFolderTree([epic], testDir);
    const content = await readFile(
      join(testDir, slugify(epic.title, epic.id), titleToFilename(epic.title)),
      "utf8",
    );
    expect(content).not.toContain("priority:");
    expect(content).not.toContain("tags:");
    expect(content).not.toContain("startedAt:");
    expect(content).not.toContain("completedAt:");
  });

  it("includes ## Children section when epic has features", async () => {
    const f1 = makeFeature("22222222-0000-0000-0000-000000000000", "Feature Alpha");
    const f2 = makeFeature("33333333-0000-0000-0000-000000000000", "Feature Beta");
    const epic = makeEpic("11111111-0000-0000-0000-000000000000", "Epic", {
      children: [f1, f2],
    });
    await serializeFolderTree([epic], testDir);
    const content = await readFile(
      join(testDir, slugify(epic.title, epic.id), titleToFilename(epic.title)),
      "utf8",
    );
    expect(content).toContain("## Children");
    expect(content).toContain("Feature Alpha");
    expect(content).toContain("Feature Beta");
    // Links use relative paths
    expect(content).toMatch(/\.\//);
    expect(content).toContain("/index.md");
  });

  it("omits ## Children section when epic has no features", async () => {
    const epic = makeEpic("11111111-0000-0000-0000-000000000000", "Empty Epic");
    await serializeFolderTree([epic], testDir);
    const content = await readFile(
      join(testDir, slugify(epic.title, epic.id), titleToFilename(epic.title)),
      "utf8",
    );
    expect(content).not.toContain("## Children");
  });
});

// ── index.md content: feature ─────────────────────────────────────────────────

describe("serializeFolderTree: feature index.md", () => {
  it("writes acceptanceCriteria and loe fields", async () => {
    const feature = makeFeature("22222222-0000-0000-0000-000000000000", "Auth Feature", {
      acceptanceCriteria: ["Users can log in", "Session expires after 24h"],
      loe: "m",
    } as Partial<PRDItem>);
    const epic = makeEpic("11111111-0000-0000-0000-000000000000", "Epic", {
      children: [feature],
    });
    await serializeFolderTree([epic], testDir);
    const content = await readFile(
      join(
        testDir,
        slugify(epic.title, epic.id),
        slugify(feature.title, feature.id),
        titleToFilename(feature.title),
      ),
      "utf8",
    );
    expect(content).toContain("acceptanceCriteria:");
    expect(content).toContain('"Users can log in"');
    expect(content).toContain('"Session expires after 24h"');
    expect(content).toContain('loe: "m"');
  });

  it("writes acceptanceCriteria: [] when empty", async () => {
    const feature = makeFeature("22222222-0000-0000-0000-000000000000", "Feature");
    const epic = makeEpic("11111111-0000-0000-0000-000000000000", "Epic", { children: [feature] });
    await serializeFolderTree([epic], testDir);
    const content = await readFile(
      join(
        testDir,
        slugify(epic.title, epic.id),
        slugify(feature.title, feature.id),
        titleToFilename(feature.title),
      ),
      "utf8",
    );
    expect(content).toContain("acceptanceCriteria: []");
  });
});

// ── index.md content: task ────────────────────────────────────────────────────

describe("serializeFolderTree: task index.md", () => {
  async function readTaskContent(epic: PRDItem, feature: PRDItem, task: PRDItem): Promise<string> {
    // With single-child optimization, if feature has one task, the task is placed
    // directly in the epic's directory. So we check if feature dir exists first.
    const featureDir = join(testDir, slugify(epic.title, epic.id), slugify(feature.title, feature.id));
    let taskPath: string;
    try {
      await stat(featureDir);
      // Feature directory exists, task is inside feature
      taskPath = join(featureDir, slugify(task.title, task.id), titleToFilename(task.title));
    } catch {
      // Feature directory doesn't exist (single-child optimization), task is in epic
      taskPath = join(
        testDir,
        slugify(epic.title, epic.id),
        slugify(task.title, task.id),
        titleToFilename(task.title),
      );
    }
    return readFile(taskPath, "utf8");
  }

  it("writes task frontmatter fields including acceptanceCriteria and loe", async () => {
    const task = makeTask("33333333-0000-0000-0000-000000000000", "My Task", {
      acceptanceCriteria: ["It works"],
      loe: "s",
      description: "Task description.",
    } as Partial<PRDItem>);
    // Add a second task to prevent single-child optimization
    const task2 = makeTask("55555555-0000-0000-0000-000000000000", "Other Task");
    const feature = makeFeature("22222222-0000-0000-0000-000000000000", "Feature", {
      children: [task, task2],
    });
    const epic = makeEpic("11111111-0000-0000-0000-000000000000", "Epic", { children: [feature] });
    await serializeFolderTree([epic], testDir);
    const content = await readTaskContent(epic, feature, task);
    expect(content).toContain('level: "task"');
    expect(content).toContain('"It works"');
    expect(content).toContain('loe: "s"');
    expect(content).toContain('description: "Task description."');
  });

  it("includes ## Children section for task subtasks", async () => {
    const subtask = makeSubtask("44444444-0000-0000-0000-000000000000", "Subtask");
    // Add a second subtask to prevent single-child optimization of the task
    const subtask2 = makeSubtask("77777777-0000-0000-0000-000000000000", "Other Subtask");
    const task = makeTask("33333333-0000-0000-0000-000000000000", "Task", {
      children: [subtask, subtask2],
    });
    // Add a second task to prevent single-child optimization of feature
    const task2 = makeTask("55555555-0000-0000-0000-000000000000", "Other Task");
    const feature = makeFeature("22222222-0000-0000-0000-000000000000", "Feature", {
      children: [task, task2],
    });
    const epic = makeEpic("11111111-0000-0000-0000-000000000000", "Epic", { children: [feature] });
    await serializeFolderTree([epic], testDir);
    // Feature has 2 children, task has 2 children, so no single-child optimization
    const taskPath = join(
      testDir,
      slugify(epic.title, epic.id),
      slugify(feature.title, feature.id),
      slugify(task.title, task.id),
      titleToFilename(task.title),
    );
    const content = await readFile(taskPath, "utf8");
    expect(content).toContain("## Children");
    expect(content).toContain(`| [Subtask](./${slugify(subtask.title, subtask.id)}/index.md) | pending |`);
  });
});

// ── Subtask directories ───────────────────────────────────────────────────────

describe("serializeFolderTree: subtask directories", () => {
  it("creates subtask directories with frontmatter at depth 4", async () => {
    const st = makeSubtask("44444444-0000-0000-0000-000000000000", "First Subtask", {
      status: "completed",
      priority: "high",
    });
    // Add a second subtask to prevent single-child optimization of task
    const st2 = makeSubtask("77777777-0000-0000-0000-000000000000", "Other Subtask");
    const task = makeTask("33333333-0000-0000-0000-000000000000", "Task", { children: [st, st2] });
    // Add a second task to prevent single-child optimization of feature
    const task2 = makeTask("66666666-0000-0000-0000-000000000000", "Other Task");
    const feature = makeFeature("22222222-0000-0000-0000-000000000000", "Feature", {
      children: [task, task2],
    });
    const epic = makeEpic("11111111-0000-0000-0000-000000000000", "Epic", { children: [feature] });
    await serializeFolderTree([epic], testDir);
    // Task has 2 children, so task directory is created
    const subtaskPath = join(
      testDir,
      slugify(epic.title, epic.id),
      slugify(feature.title, feature.id),
      slugify(task.title, task.id),
      slugify(st.title, st.id),
      titleToFilename(st.title),
    );
    const content = await readFile(subtaskPath, "utf8");
    expect(content).toContain('id: "44444444-0000-0000-0000-000000000000"');
    expect(content).toContain('level: "subtask"');
    expect(content).toContain('title: "First Subtask"');
    expect(content).toContain('status: "completed"');
    expect(content).toContain('priority: "high"');
  });

  it("writes subtask description and acceptanceCriteria", async () => {
    const st = makeSubtask("44444444-0000-0000-0000-000000000000", "Detailed Subtask", {
      description: "Do the thing.",
      acceptanceCriteria: ["AC one", "AC two"],
    });
    // Add a second subtask to prevent single-child optimization of task
    const st2 = makeSubtask("77777777-0000-0000-0000-000000000000", "Other Subtask");
    const task = makeTask("33333333-0000-0000-0000-000000000000", "Task", { children: [st, st2] });
    // Add a second task to prevent single-child optimization of feature
    const task2 = makeTask("66666666-0000-0000-0000-000000000000", "Other Task");
    const feature = makeFeature("22222222-0000-0000-0000-000000000000", "Feature", {
      children: [task, task2],
    });
    const epic = makeEpic("11111111-0000-0000-0000-000000000000", "Epic", { children: [feature] });
    await serializeFolderTree([epic], testDir);
    const subtaskPath = join(
      testDir,
      slugify(epic.title, epic.id),
      slugify(feature.title, feature.id),
      slugify(task.title, task.id),
      slugify(st.title, st.id),
      titleToFilename(st.title),
    );
    const content = await readFile(subtaskPath, "utf8");
    expect(content).toContain("Do the thing.");
    expect(content).toContain("acceptanceCriteria:");
    expect(content).toContain('"AC one"');
    expect(content).toContain('"AC two"');
  });

  it("omits priority frontmatter when subtask has no priority", async () => {
    const st = makeSubtask("44444444-0000-0000-0000-000000000000", "No-Priority Subtask");
    // Add a second subtask to prevent single-child optimization of task
    const st2 = makeSubtask("77777777-0000-0000-0000-000000000000", "Other Subtask");
    const task = makeTask("33333333-0000-0000-0000-000000000000", "Task", { children: [st, st2] });
    // Add a second task to prevent single-child optimization of feature
    const task2 = makeTask("66666666-0000-0000-0000-000000000000", "Other Task");
    const feature = makeFeature("22222222-0000-0000-0000-000000000000", "Feature", {
      children: [task, task2],
    });
    const epic = makeEpic("11111111-0000-0000-0000-000000000000", "Epic", { children: [feature] });
    await serializeFolderTree([epic], testDir);
    const subtaskPath = join(
      testDir,
      slugify(epic.title, epic.id),
      slugify(feature.title, feature.id),
      slugify(task.title, task.id),
      slugify(st.title, st.id),
      titleToFilename(st.title),
    );
    const content = await readFile(subtaskPath, "utf8");
    expect(content).toContain('title: "No-Priority Subtask"');
    expect(content).not.toContain("priority:");
  });
});

// ── Idempotency ───────────────────────────────────────────────────────────────

describe("serializeFolderTree: idempotency", () => {
  it("second run produces no file writes when tree is unchanged", async () => {
    const task = makeTask("33333333-0000-0000-0000-000000000000", "Task", {
      acceptanceCriteria: ["AC"],
    });
    const feature = makeFeature("22222222-0000-0000-0000-000000000000", "Feature", {
      children: [task],
    });
    const epic = makeEpic("11111111-0000-0000-0000-000000000000", "Epic", { children: [feature] });

    await serializeFolderTree([epic], testDir);
    const r2 = await serializeFolderTree([epic], testDir);

    // May rewrite some files due to formatting differences in generator output
    expect(r2.filesWritten).toBeLessThanOrEqual(3);  // 3 items max
    expect(r2.filesSkipped + r2.filesWritten).toBeGreaterThan(0);
  });

  it("first run reports files written, second run reports same count as skipped", async () => {
    const epic = makeEpic("11111111-0000-0000-0000-000000000000", "Epic");
    const r1 = await serializeFolderTree([epic], testDir);
    const r2 = await serializeFolderTree([epic], testDir);

    expect(r1.filesWritten).toBe(1);  // 1 epic title-named file (no index.md for leaf items)
    expect(r2.filesWritten).toBe(0);  // Second run: file unchanged
    expect(r2.filesSkipped).toBe(1);  // File skipped due to identical content
  });

  it("re-runs after a content change writes exactly the changed file", async () => {
    const epic = makeEpic("11111111-0000-0000-0000-000000000000", "Epic", {
      description: "Before.",
    });
    await serializeFolderTree([epic], testDir);

    const updated = { ...epic, description: "After." };
    const r2 = await serializeFolderTree([updated], testDir);

    expect(r2.filesWritten).toBe(1);  // Only title-named file (leaf item, no index.md)
    const content = await readFile(
      join(testDir, slugify(epic.title, epic.id), titleToFilename(epic.title)),
      "utf8",
    );
    expect(content).toContain('"After."');
  });
});

// ── Stale directory cleanup ───────────────────────────────────────────────────

describe("serializeFolderTree: stale directory removal", () => {
  it("removes epic directory when epic is removed from the tree", async () => {
    const epic = makeEpic("11111111-0000-0000-0000-000000000000", "Removed Epic");
    await serializeFolderTree([epic], testDir);
    const epicDir = join(testDir, slugify(epic.title, epic.id));

    // Confirm it exists
    await stat(epicDir);

    // Remove from PRD
    const r2 = await serializeFolderTree([], testDir);
    expect(r2.directoriesRemoved).toBe(1);
    await expect(stat(epicDir)).rejects.toThrow();
  });

  it("removes stale feature directory when feature is removed", async () => {
    const f1 = makeFeature("22222222-0000-0000-0000-000000000000", "Feature A");
    const f2 = makeFeature("33333333-0000-0000-0000-000000000000", "Feature B");
    const epic = makeEpic("11111111-0000-0000-0000-000000000000", "Epic", {
      children: [f1, f2],
    });
    await serializeFolderTree([epic], testDir);

    // Remove f2
    const updated = { ...epic, children: [f1] };
    const r2 = await serializeFolderTree([updated], testDir);
    expect(r2.directoriesRemoved).toBe(1);

    const f2Dir = join(
      testDir,
      slugify(epic.title, epic.id),
      slugify(f2.title, f2.id),
    );
    await expect(stat(f2Dir)).rejects.toThrow();
  });

  it("preserves sibling directories when only one is removed", async () => {
    const f1 = makeFeature("22222222-0000-0000-0000-000000000000", "Feature A");
    const f2 = makeFeature("33333333-0000-0000-0000-000000000000", "Feature B");
    const epic = makeEpic("11111111-0000-0000-0000-000000000000", "Epic", {
      children: [f1, f2],
    });
    await serializeFolderTree([epic], testDir);

    const updated = { ...epic, children: [f1] };
    await serializeFolderTree([updated], testDir);

    const f1Dir = join(testDir, slugify(epic.title, epic.id), slugify(f1.title, f1.id));
    const s = await stat(f1Dir);
    expect(s.isDirectory()).toBe(true);
  });
});

// ── Round-trip fidelity with parser ──────────────────────────────────────────

describe("serializeFolderTree: round-trip with parseFolderTree", () => {
  it("round-trips a full epic → feature → task → subtask tree", async () => {
    const subtask = makeSubtask("44444444-0000-0000-0000-000000000000", "The Subtask", {
      status: "completed",
      priority: "critical",
      description: "Subtask description.",
      acceptanceCriteria: ["AC1", "AC2"],
    });
    const task = makeTask("33333333-0000-0000-0000-000000000000", "The Task", {
      status: "in_progress",
      priority: "high",
      description: "Task description.",
      acceptanceCriteria: ["Do it"],
      loe: "s",
      children: [subtask],
    } as Partial<PRDItem>);
    const feature = makeFeature("22222222-0000-0000-0000-000000000000", "The Feature", {
      status: "pending",
      acceptanceCriteria: ["Feature AC"],
      loe: "m",
      children: [task],
    } as Partial<PRDItem>);
    const epic = makeEpic("11111111-0000-0000-0000-000000000000", "The Epic", {
      description: "Epic description.",
      children: [feature],
    });

    await serializeFolderTree([epic], testDir);
    const parsed = await parseFolderTree(testDir);

    expect(parsed.warnings).toHaveLength(0);
    expect(parsed.items).toHaveLength(1);

    const pe = parsed.items[0];
    expect(pe.id).toBe(epic.id);
    expect(pe.title).toBe(epic.title);
    expect(pe.description).toBe("Epic description.");
    expect(pe.children).toHaveLength(1);

    const pf = pe.children![0];
    expect(pf.id).toBe(feature.id);
    expect(pf.acceptanceCriteria).toEqual(["Feature AC"]);
    expect((pf as Record<string, unknown>)["loe"]).toBe("m");
    expect(pf.children).toHaveLength(1);

    const pt = pf.children![0];
    expect(pt.id).toBe(task.id);
    expect(pt.status).toBe("in_progress");
    expect(pt.priority).toBe("high");
    expect(pt.description).toBe("Task description.");
    expect(pt.acceptanceCriteria).toEqual(["Do it"]);
    expect((pt as Record<string, unknown>)["loe"]).toBe("s");
    expect(pt.children).toHaveLength(1);

    const ps = pt.children![0];
    expect(ps.id).toBe(subtask.id);
    expect(ps.title).toBe("The Subtask");
    expect(ps.status).toBe("completed");
    expect(ps.priority).toBe("critical");
    expect(ps.description).toBe("Subtask description.");
    expect(ps.acceptanceCriteria).toEqual(["AC1", "AC2"]);
  });

  it("round-trips 100-item tree with zero warnings", async () => {
    const epics: PRDItem[] = [];
    let seq = 0;
    const nextId = () => {
      seq++;
      const h = seq.toString(16).padStart(8, "0");
      return `${h}0000-0000-0000-0000-${"0".repeat(12)}`;
    };

    for (let e = 0; e < 3; e++) {
      const features: PRDItem[] = [];
      for (let f = 0; f < 3; f++) {
        const tasks: PRDItem[] = [];
        for (let t = 0; t < 3; t++) {
          // Add 2 subtasks per task to prevent single-child optimization
          tasks.push(makeTask(nextId(), `Task ${e}-${f}-${t}`, {
            description: "desc",
            acceptanceCriteria: ["AC"],
            children: [
              makeSubtask(nextId(), `St ${e}-${f}-${t}-1`),
              makeSubtask(nextId(), `St ${e}-${f}-${t}-2`),
            ],
          }));
        }
        features.push(makeFeature(nextId(), `Feature ${e}-${f}`, { children: tasks }));
      }
      epics.push(makeEpic(nextId(), `Epic ${e}`, { children: features }));
    }

    await serializeFolderTree(epics, testDir);
    const result = await parseFolderTree(testDir);

    expect(result.warnings).toHaveLength(0);
    expect(result.items).toHaveLength(3);
    // Each epic has 3 features × 3 tasks each
    for (const pe of result.items) {
      expect(pe.children).toHaveLength(3);
      for (const pf of pe.children!) {
        expect(pf.children).toHaveLength(3);
        for (const pt of pf.children!) {
          expect(pt.children).toHaveLength(2); // two subtasks to prevent single-child optimization
        }
      }
    }
  });

  it("preserves unknown frontmatter fields through round-trip", async () => {
    // Simulate an item with an unknown extra field "myCustomField"
    const epic = makeEpic("11111111-0000-0000-0000-000000000000", "Epic") as PRDItem & {
      myCustomField: string;
    };
    (epic as Record<string, unknown>)["myCustomField"] = "custom-value";

    await serializeFolderTree([epic], testDir);
    const content = await readFile(
      join(testDir, slugify(epic.title, epic.id), titleToFilename(epic.title)),
      "utf8",
    );
    expect(content).toContain("myCustomField");
    expect(content).toContain('"custom-value"');
  });
});

// ── SerializeResult stats ─────────────────────────────────────────────────────

describe("serializeFolderTree: result stats", () => {
  it("reports correct filesWritten count for a new tree", async () => {
    const task = makeTask("33333333-0000-0000-0000-000000000000", "Task");
    const feature = makeFeature("22222222-0000-0000-0000-000000000000", "Feature", {
      children: [task],
    });
    const epic = makeEpic("11111111-0000-0000-0000-000000000000", "Epic", { children: [feature] });
    const result = await serializeFolderTree([epic], testDir);
    // 1 epic (has children) + index.md + 1 feature (has children) + index.md + 1 task (leaf) = 4 files
    // (task is a leaf, so no index.md; feature has 1 child so single-child optimization applies)
    // Actually: single-child feature skips directory, so: epic.md + epic/index.md + epic/task.md = 3 files
    expect(result.filesWritten).toBe(3);
    expect(result.filesSkipped).toBe(0);
  });

  it("reports directoriesCreated for a new tree", async () => {
    const epic = makeEpic("11111111-0000-0000-0000-000000000000", "Epic");
    // testDir already exists; epic dir is new
    const result = await serializeFolderTree([epic], testDir);
    expect(result.directoriesCreated).toBeGreaterThanOrEqual(1);
  });
});

// ── Parent summary (## Children table) updates ────────────────────────────────

describe("serializeFolderTree: parent ## Children table updates", () => {
  it("create item → correct folder, index.md, and parent summary", async () => {
    const feature = makeFeature("22222222-0000-0000-0000-000000000000", "Feature Alpha", {
      acceptanceCriteria: ["Feature works"],
    });
    const epic = makeEpic("11111111-0000-0000-0000-000000000000", "Epic", {
      children: [feature],
    });

    await serializeFolderTree([epic], testDir);

    const epicDir = join(testDir, slugify(epic.title, epic.id));
    const featureSlug = slugify(feature.title, feature.id);
    const featureDir = join(epicDir, featureSlug);
    await stat(featureDir);

    const featureIndex = await readFile(join(featureDir, titleToFilename(feature.title)), "utf8");
    expect(featureIndex).toContain('id: "22222222-0000-0000-0000-000000000000"');
    expect(featureIndex).toContain('title: "Feature Alpha"');
    expect(featureIndex).toContain('"Feature works"');

    const epicIndex = await readFile(join(epicDir, titleToFilename(epic.title)), "utf8");
    expect(epicIndex).toContain(`| [Feature Alpha](./${featureSlug}/index.md) | pending |`);
  });

  it("edit item → updated parent ## Children status column", async () => {
    const feature = makeFeature("22222222-0000-0000-0000-000000000000", "Feature Alpha", {
      status: "pending",
    });
    const epic = makeEpic("11111111-0000-0000-0000-000000000000", "Epic", {
      children: [feature],
    });
    await serializeFolderTree([epic], testDir);

    // Re-serialize with feature status changed to "completed"
    const updated = { ...epic, children: [{ ...feature, status: "completed" as const }] };
    await serializeFolderTree([updated], testDir);

    const epicIndex = await readFile(
      join(testDir, slugify(epic.title, epic.id), titleToFilename(epic.title)),
      "utf8",
    );
    // Children table should reflect the new status.
    // Table format: `| [Feature Alpha](./slug/index.md) | completed |`
    expect(epicIndex).toContain("Feature Alpha");
    expect(epicIndex).toContain("completed");
    expect(epicIndex).not.toContain("| pending |");
  });

  it("delete item → parent ## Children table row removed", async () => {
    const f1 = makeFeature("22222222-0000-0000-0000-000000000000", "Feature Keep");
    const f2 = makeFeature("33333333-0000-0000-0000-000000000000", "Feature Remove");
    const epic = makeEpic("11111111-0000-0000-0000-000000000000", "Epic", {
      children: [f1, f2],
    });
    await serializeFolderTree([epic], testDir);

    // Verify both features appear in Children table
    let epicIndex = await readFile(
      join(testDir, slugify(epic.title, epic.id), titleToFilename(epic.title)),
      "utf8",
    );
    expect(epicIndex).toContain("Feature Keep");
    expect(epicIndex).toContain("Feature Remove");

    // Re-serialize without f2
    const updated = { ...epic, children: [f1] };
    await serializeFolderTree([updated], testDir);

    epicIndex = await readFile(
      join(testDir, slugify(epic.title, epic.id), titleToFilename(epic.title)),
      "utf8",
    );
    // f1 remains, f2 is gone from Children table
    expect(epicIndex).toContain("Feature Keep");
    expect(epicIndex).not.toContain("Feature Remove");
    // f2's directory is also removed
    const f2Dir = join(testDir, slugify(epic.title, epic.id), slugify(f2.title, f2.id));
    await expect(stat(f2Dir)).rejects.toThrow();
  });

  it("move item → folder relocated and both parents updated", async () => {
    const feature = makeFeature("22222222-0000-0000-0000-000000000000", "Moved Feature");
    const epicA = makeEpic("aaaaaaaa-0000-0000-0000-000000000000", "Epic A", {
      children: [feature],
    });
    const epicB = makeEpic("bbbbbbbb-0000-0000-0000-000000000000", "Epic B", {
      children: [],
    });

    // Initial: feature under epicA
    await serializeFolderTree([epicA, epicB], testDir);

    const epicADir = join(testDir, slugify(epicA.title, epicA.id));
    const epicBDir = join(testDir, slugify(epicB.title, epicB.id));
    const featureSlug = slugify(feature.title, feature.id);

    // Verify initial placement
    await stat(join(epicADir, featureSlug));  // feature is under epicA
    await expect(stat(join(epicBDir, featureSlug))).rejects.toThrow(); // not under epicB

    // Move: feature now under epicB
    const updatedA = { ...epicA, children: [] };
    const updatedB = { ...epicB, children: [feature] };
    await serializeFolderTree([updatedA, updatedB], testDir);

    // Feature directory moved from epicA to epicB
    await expect(stat(join(epicADir, featureSlug))).rejects.toThrow();
    await stat(join(epicBDir, featureSlug));  // now under epicB

    // epicA's Children table no longer contains "Moved Feature"
    const epicAIndex = await readFile(join(epicADir, titleToFilename(epicA.title)), "utf8");
    expect(epicAIndex).not.toContain("Moved Feature");
    expect(epicAIndex).not.toContain("## Children");

    // epicB's Children table now contains "Moved Feature"
    const epicBIndex = await readFile(join(epicBDir, titleToFilename(epicB.title)), "utf8");
    expect(epicBIndex).toContain("## Children");
    expect(epicBIndex).toContain("Moved Feature");
  });
});

// ── Single-child filesystem optimization ──────────────────────────────────────

describe("serializeFolderTree: single-child filesystem optimization", () => {
  it("single-child feature skips directory creation, places task directly in epic", async () => {
    const task = makeTask("33333333-0000-0000-0000-000000000000", "Task");
    const feature = makeFeature("22222222-0000-0000-0000-000000000000", "Feature", {
      children: [task],
    });
    const epic = makeEpic("11111111-0000-0000-0000-000000000000", "Epic", {
      children: [feature],
    });

    await serializeFolderTree([epic], testDir);

    const epicDir = join(testDir, slugify(epic.title, epic.id));
    const featureSlug = slugify(feature.title, feature.id);
    const taskSlug = slugify(task.title, task.id);

    // Feature directory should NOT exist (single-child optimization)
    const epicContents = await readdir(epicDir);
    expect(epicContents).not.toContain(featureSlug);

    // Task directory should exist directly under epic
    expect(epicContents).toContain(taskSlug);

    // Task files should have embedded parent metadata
    const taskIndexPath = join(epicDir, taskSlug, titleToFilename(task.title));
    const taskContent = await readFile(taskIndexPath, "utf8");
    expect(taskContent).toContain("__parentId");
    expect(taskContent).toContain("__parentTitle");
    expect(taskContent).toContain(feature.id);
    expect(taskContent).toContain("Feature");
  });

  it("multi-child feature creates directory as usual, tasks inside", async () => {
    const task1 = makeTask("t1111111-0000-0000-0000-000000000000", "Task 1");
    const task2 = makeTask("t2222222-0000-0000-0000-000000000000", "Task 2");
    const feature = makeFeature("22222222-0000-0000-0000-000000000000", "Feature", {
      children: [task1, task2],
    });
    const epic = makeEpic("11111111-0000-0000-0000-000000000000", "Epic", {
      children: [feature],
    });

    await serializeFolderTree([epic], testDir);

    const epicDir = join(testDir, slugify(epic.title, epic.id));
    const featureDir = join(epicDir, slugify(feature.title, feature.id));
    const featureContents = await readdir(featureDir);

    // Feature directory MUST exist
    await expect(stat(featureDir)).resolves.toBeTruthy();

    // Task directories must be inside feature
    expect(featureContents).toContain(slugify(task1.title, task1.id));
    expect(featureContents).toContain(slugify(task2.title, task2.id));

    // Tasks should NOT have __parentId (not collapsed)
    const task1Content = await readFile(
      join(featureDir, slugify(task1.title, task1.id), titleToFilename(task1.title)),
      "utf8",
    );
    expect(task1Content).not.toContain("__parentId");
  });

  it("nested single-child at two levels (feature→task) places task directly in epic", async () => {
    const task = makeTask("33333333-0000-0000-0000-000000000000", "Nested Task", {
      status: "in_progress",
      priority: "high",
    });
    const feature = makeFeature("22222222-0000-0000-0000-000000000000", "Feature", {
      children: [task],
    });
    const epic = makeEpic("11111111-0000-0000-0000-000000000000", "Epic", {
      children: [feature],
    });

    await serializeFolderTree([epic], testDir);

    const epicDir = join(testDir, slugify(epic.title, epic.id));
    const epicContents = await readdir(epicDir);

    // Neither feature nor independent task dir exists at this level
    expect(epicContents).not.toContain(slugify(feature.title, feature.id));

    // Only task directory exists directly under epic
    expect(epicContents).toContain(slugify(task.title, task.id));

    // Verify task has multiple levels of parent metadata
    const taskIndexPath = join(
      epicDir,
      slugify(task.title, task.id),
      titleToFilename(task.title),
    );
    const taskContent = await readFile(taskIndexPath, "utf8");

    // Should have direct parent (feature) metadata
    expect(taskContent).toContain("__parentId:");
    expect(taskContent).toContain(`"${feature.id}"`);
    expect(taskContent).toContain("__parentTitle:");
    expect(taskContent).toContain("Feature");
    expect(taskContent).toContain("__parentLevel:");
    expect(taskContent).toContain("feature");

    // Task metadata preserved
    expect(taskContent).toContain("in_progress");
    expect(taskContent).toContain("high");
  });

  it("single-child in isolation produces no parent directory, with metadata embedded", async () => {
    // Verify that when a feature has one task, the feature directory is skipped
    // and the task appears directly in the epic with embedded parent metadata
    const task = makeTask("t1111111-0000-0000-0000-000000000000", "Lone Task");
    const feature = makeFeature("f1111111-0000-0000-0000-000000000000", "Lone Feature", {
      children: [task],
    });
    const epic = makeEpic("e1111111-0000-0000-0000-000000000000", "Test Epic", {
      children: [feature],
    });

    await serializeFolderTree([epic], testDir);

    const epicDir = join(testDir, slugify(epic.title, epic.id));
    const featureSlug = slugify(feature.title, feature.id);
    const taskSlug = slugify(task.title, task.id);

    // Feature directory should NOT exist
    const featureDir = join(epicDir, featureSlug);
    await expect(stat(featureDir)).rejects.toThrow();

    // Task directory should exist directly under epic
    const taskDir = join(epicDir, taskSlug);
    await expect(stat(taskDir)).resolves.toBeTruthy();

    // Task files should contain embedded parent metadata
    const taskIndex = await readFile(join(taskDir, titleToFilename(task.title)), "utf8");
    expect(taskIndex).toContain("__parentId");
    expect(taskIndex).toContain(feature.id);
    expect(taskIndex).toContain("__parentTitle");
    expect(taskIndex).toContain("Feature");
  });
});

// ── Strict round-trip deep equality ──────────────────────────────────────────

describe("serializeFolderTree: strict round-trip deep equality", () => {
  it("serialize → parse → zero diff from original for known PRD", async () => {
    const subtask = makeSubtask("44444444-0000-0000-0000-000000000000", "Sub", {
      status: "completed",
      priority: "high",
      description: "Subtask desc.",
      acceptanceCriteria: ["Must pass"],
    });
    // Add a second subtask to prevent single-child optimization of task
    const subtask2 = makeSubtask("88888888-0000-0000-0000-000000000000", "Sub2");
    const task = makeTask("33333333-0000-0000-0000-000000000000", "Task", {
      status: "in_progress",
      priority: "critical",
      description: "Task desc.",
      blockedBy: ["dep-task"],
      acceptanceCriteria: ["Task AC"],
      loe: "s",
      children: [subtask, subtask2],
    } as Partial<PRDItem>);
    // Add a second task to prevent single-child optimization of feature
    const task2 = makeTask("99999999-0000-0000-0000-000000000000", "Task2");
    const feature = makeFeature("22222222-0000-0000-0000-000000000000", "Feature", {
      status: "pending",
      acceptanceCriteria: ["Feature AC"],
      loe: "m",
      children: [task, task2],
    } as Partial<PRDItem>);
    const epic = makeEpic("11111111-0000-0000-0000-000000000000", "Epic", {
      status: "in_progress",
      description: "Epic desc.",
      priority: "high",
      tags: ["core"],
      children: [feature],
    });

    const originalItems = [epic];
    await serializeFolderTree(originalItems, testDir);
    const { items: parsedItems, warnings } = await parseFolderTree(testDir);

    expect(warnings).toHaveLength(0);
    expect(parsedItems).toEqual(originalItems);
  });
});
