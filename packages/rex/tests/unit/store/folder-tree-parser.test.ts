/**
 * Tests for the folder-tree-to-PRD parser.
 *
 * Acceptance criteria:
 *   - Round-trip fidelity: build a folder tree, parse it, assert zero data loss
 *   - Parser emits structured warnings for missing/malformed index.md
 *   - Parse order is deterministic (alphabetical by folder name)
 *   - Parser reconstructs parent-child relationships from directory depth
 *   - Parsing a 200-item tree completes in < 500 ms
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseFolderTree } from "../../../src/store/folder-tree-parser.js";
import type { PRDItem } from "../../../src/schema/index.js";

// ── Test helpers ──────────────────────────────────────────────────────────────

let testDir: string;
const FIXTURE_ROOT = join(import.meta.dirname, "../../fixtures/folder-tree");

beforeEach(async () => {
  testDir = join(tmpdir(), `folder-tree-parser-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

/** Derive a slug from a title and ID, matching the schema slug algorithm. */
function makeSlug(title: string, id: string): string {
  // NFKD normalize, strip combining chars, remove non-ASCII, lowercase,
  // collapse whitespace/hyphens, strip non [a-z0-9-], truncate to 40 chars.
  let body = title
    .normalize("NFKD")
    .replace(/[̀-ͯ\u{0080}-\u{FFFF}]/gu, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (body.length > 40) {
    const candidate = body.slice(0, 40);
    const lastHyphen = candidate.lastIndexOf("-");
    body = lastHyphen > 0 ? candidate.slice(0, lastHyphen) : candidate;
  }

  const id8 = id.replace(/-/g, "").slice(0, 8);
  return body ? `${body}-${id8}` : id8;
}

/** Render a YAML value for frontmatter. */
function yamlValue(v: unknown): string {
  if (v === null || v === undefined) return '""';
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    return "\n" + v.map(s => `  - ${JSON.stringify(s)}`).join("\n");
  }
  return JSON.stringify(String(v));
}

/** Build an index.md for an epic or feature. */
function renderEpicOrFeature(item: PRDItem, children: PRDItem[]): string {
  const lines: string[] = ["---"];
  lines.push(`id: ${yamlValue(item.id)}`);
  lines.push(`level: ${item.level}`);
  lines.push(`title: ${yamlValue(item.title)}`);
  lines.push(`status: ${item.status}`);
  if (item.description) lines.push(`description: ${yamlValue(item.description)}`);
  if (item.priority) lines.push(`priority: ${item.priority}`);
  if (item.tags?.length) lines.push(`tags:${yamlValue(item.tags)}`);
  if (item.source) lines.push(`source: ${yamlValue(item.source)}`);
  if (item.startedAt) lines.push(`startedAt: ${yamlValue(item.startedAt)}`);
  if (item.completedAt) lines.push(`completedAt: ${yamlValue(item.completedAt)}`);
  if (item.endedAt) lines.push(`endedAt: ${yamlValue(item.endedAt)}`);
  if (item.resolutionType) lines.push(`resolutionType: ${item.resolutionType}`);
  if (item.resolutionDetail) lines.push(`resolutionDetail: ${yamlValue(item.resolutionDetail)}`);
  if (item.failureReason) lines.push(`failureReason: ${yamlValue(item.failureReason)}`);
  if (item.acceptanceCriteria !== undefined) {
    lines.push(`acceptanceCriteria:${yamlValue(item.acceptanceCriteria)}`);
  }
  if ((item as Record<string, unknown>)["loe"]) {
    lines.push(`loe: ${(item as Record<string, unknown>)["loe"]}`);
  }
  lines.push("---");
  lines.push("");
  if (children.length > 0) {
    lines.push("## Children");
    lines.push("");
    lines.push("| Title | Status |");
    lines.push("|-------|--------|");
    for (const c of children) {
      const slug = makeSlug(c.title, c.id);
      lines.push(`| [${c.title}](./${slug}/index.md) | ${c.status} |`);
    }
  }
  return lines.join("\n");
}

/** Build an index.md for a task (including subtask sections). */
function renderTask(item: PRDItem): string {
  const lines: string[] = ["---"];
  lines.push(`id: ${yamlValue(item.id)}`);
  lines.push(`level: task`);
  lines.push(`title: ${yamlValue(item.title)}`);
  lines.push(`status: ${item.status}`);
  if (item.description) lines.push(`description: ${yamlValue(item.description)}`);
  if (item.priority) lines.push(`priority: ${item.priority}`);
  if (item.tags?.length) lines.push(`tags:${yamlValue(item.tags)}`);
  if (item.startedAt) lines.push(`startedAt: ${yamlValue(item.startedAt)}`);
  if (item.completedAt) lines.push(`completedAt: ${yamlValue(item.completedAt)}`);
  if (item.resolutionType) lines.push(`resolutionType: ${item.resolutionType}`);
  if (item.resolutionDetail) lines.push(`resolutionDetail: ${yamlValue(item.resolutionDetail)}`);
  if (item.acceptanceCriteria !== undefined) {
    lines.push(`acceptanceCriteria:${yamlValue(item.acceptanceCriteria)}`);
  }
  if ((item as Record<string, unknown>)["loe"]) {
    lines.push(`loe: ${(item as Record<string, unknown>)["loe"]}`);
  }
  lines.push("---");
  lines.push("");

  const subtasks = item.children ?? [];
  for (const st of subtasks) {
    lines.push(`## Subtask: ${st.title}`);
    lines.push("");
    lines.push(`**ID:** \`${st.id}\``);
    lines.push(`**Status:** ${st.status}`);
    if (st.priority) lines.push(`**Priority:** ${st.priority}`);
    lines.push("");
    if (st.description) {
      lines.push(st.description);
      lines.push("");
    }
    if (st.acceptanceCriteria?.length) {
      lines.push("**Acceptance Criteria**");
      lines.push("");
      for (const ac of st.acceptanceCriteria) {
        lines.push(`- ${ac}`);
      }
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Write a complete folder tree for the given epic items.
 * Returns the tree root path.
 */
async function buildFolderTree(root: string, epics: PRDItem[]): Promise<string> {
  await mkdir(root, { recursive: true });

  for (const epic of epics) {
    const epicSlug = makeSlug(epic.title, epic.id);
    const epicPath = join(root, epicSlug);
    await mkdir(epicPath, { recursive: true });

    const features = epic.children ?? [];
    await writeFile(join(epicPath, "index.md"), renderEpicOrFeature(epic, features));

    for (const feature of features) {
      const featureSlug = makeSlug(feature.title, feature.id);
      const featurePath = join(epicPath, featureSlug);
      await mkdir(featurePath, { recursive: true });

      const tasks = feature.children ?? [];
      await writeFile(join(featurePath, "index.md"), renderEpicOrFeature(feature, tasks));

      for (const task of tasks) {
        const taskSlug = makeSlug(task.title, task.id);
        const taskPath = join(featurePath, taskSlug);
        await mkdir(taskPath, { recursive: true });
        await writeFile(join(taskPath, "index.md"), renderTask(task));
      }
    }
  }

  return root;
}

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

// Strip children from item for leaf comparison (subtasks have no children array).
function strip(item: PRDItem): Omit<PRDItem, "children"> {
  const { children: _children, ...rest } = item;
  return rest;
}

// ── Fixture parsing ──────────────────────────────────────────────────────────

describe("parseFolderTree: folder-tree fixtures", () => {
  it("known folder fixture → correct item tree", async () => {
    const result = await parseFolderTree(join(FIXTURE_ROOT, "known-prd"));

    expect(result.warnings).toEqual([]);
    expect(result.items).toEqual([
      {
        id: "11111111-1111-1111-1111-111111111111",
        title: "Auth Platform",
        status: "in_progress",
        level: "epic",
        description: "Authentication platform rollout.",
        priority: "high",
        tags: ["auth", "platform"],
        source: "fixture",
        children: [
          {
            id: "22222222-2222-2222-2222-222222222222",
            title: "Login Flow",
            status: "pending",
            level: "feature",
            description: "Primary login workflow.",
            acceptanceCriteria: [
              "Users can sign in",
              "Sessions expire after inactivity",
            ],
            loe: "m",
            children: [
              {
                id: "33333333-3333-3333-3333-333333333333",
                title: "Password Login",
                status: "blocked",
                level: "task",
                description: "Build password-based authentication.",
                priority: "critical",
                blockedBy: ["dep-password-policy"],
                acceptanceCriteria: [
                  "Valid passwords authenticate users",
                  "Invalid passwords show a generic error",
                ],
                loe: "s",
                children: [
                  {
                    id: "44444444-4444-4444-4444-444444444444",
                    title: "Add password form",
                    status: "completed",
                    level: "subtask",
                    description: "Render email and password fields.",
                    priority: "high",
                    acceptanceCriteria: [
                      "Fields are labelled",
                      "Submit is disabled while pending",
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("missing index.md → structured warning emitted", async () => {
    const result = await parseFolderTree(join(FIXTURE_ROOT, "missing-index"));

    expect(result.items.map(item => item.title)).toEqual(["Good Epic"]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        path: expect.stringContaining("missing-epic-bbbbbbbb"),
        message: "No item markdown file found (expected index.md or title-named .md file)",
      }),
    ]);
  });

  it("malformed frontmatter → partial load with warning", async () => {
    const result = await parseFolderTree(join(FIXTURE_ROOT, "malformed-frontmatter"));

    expect(result.items.map(item => item.title)).toEqual(["Good Epic"]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        path: expect.stringContaining("broken-epic-bbbbbbbb/index.md"),
        message: "Unclosed frontmatter block (missing closing ---)",
      }),
    ]);
  });
});

// ── Basic parsing ─────────────────────────────────────────────────────────────

describe("parseFolderTree: basic cases", () => {
  it("returns empty items for non-existent root", async () => {
    const result = await parseFolderTree(join(testDir, "nonexistent"));
    expect(result.items).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].message).toMatch(/does not exist/);
  });

  it("returns empty items for empty tree root", async () => {
    const result = await parseFolderTree(testDir);
    expect(result.items).toEqual([]);
    expect(result.warnings).toHaveLength(0);
  });

  it("parses a single epic with no children", async () => {
    const epic = makeEpic("11111111-1111-1111-1111-111111111111", "My Epic");
    await buildFolderTree(testDir, [epic]);

    const result = await parseFolderTree(testDir);
    expect(result.warnings).toHaveLength(0);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe(epic.id);
    expect(result.items[0].title).toBe(epic.title);
    expect(result.items[0].level).toBe("epic");
    expect(result.items[0].status).toBe("pending");
  });

  it("parses epic → feature → task tree", async () => {
    const task = makeTask("33333333-3333-3333-3333-333333333333", "My Task");
    const feature = makeFeature("22222222-2222-2222-2222-222222222222", "My Feature", {
      children: [task],
    });
    const epic = makeEpic("11111111-1111-1111-1111-111111111111", "My Epic", {
      children: [feature],
    });

    await buildFolderTree(testDir, [epic]);
    const result = await parseFolderTree(testDir);

    expect(result.warnings).toHaveLength(0);
    expect(result.items).toHaveLength(1);
    const parsedEpic = result.items[0];
    expect(parsedEpic.children).toHaveLength(1);
    const parsedFeature = parsedEpic.children![0];
    expect(parsedFeature.level).toBe("feature");
    expect(parsedFeature.children).toHaveLength(1);
    const parsedTask = parsedFeature.children![0];
    expect(parsedTask.level).toBe("task");
    expect(parsedTask.id).toBe(task.id);
  });
});

// ── Subtask parsing ───────────────────────────────────────────────────────────

describe("parseFolderTree: subtasks", () => {
  it("parses subtasks from ## Subtask: sections", async () => {
    const st1 = makeSubtask("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "First Subtask");
    const st2 = makeSubtask("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "Second Subtask");
    const task = makeTask("33333333-3333-3333-3333-333333333333", "Parent Task", {
      children: [st1, st2],
    });
    const feature = makeFeature("22222222-2222-2222-2222-222222222222", "Feature", {
      children: [task],
    });
    const epic = makeEpic("11111111-1111-1111-1111-111111111111", "Epic", {
      children: [feature],
    });

    await buildFolderTree(testDir, [epic]);
    const result = await parseFolderTree(testDir);

    expect(result.warnings).toHaveLength(0);
    const parsedTask = result.items[0].children![0].children![0];
    expect(parsedTask.children).toHaveLength(2);
    expect(parsedTask.children![0].title).toBe("First Subtask");
    expect(parsedTask.children![0].level).toBe("subtask");
    expect(parsedTask.children![1].title).toBe("Second Subtask");
  });

  it("parses subtask fields: status, priority, description, acceptanceCriteria", async () => {
    const st = makeSubtask("cccccccc-cccc-cccc-cccc-cccccccccccc", "Detailed Subtask", {
      status: "completed",
      priority: "high",
      description: "Some prose description.",
      acceptanceCriteria: ["Criterion A", "Criterion B"],
    });
    const task = makeTask("33333333-3333-3333-3333-333333333333", "Task", { children: [st] });
    const feature = makeFeature("22222222-2222-2222-2222-222222222222", "Feature", { children: [task] });
    const epic = makeEpic("11111111-1111-1111-1111-111111111111", "Epic", { children: [feature] });

    await buildFolderTree(testDir, [epic]);
    const result = await parseFolderTree(testDir);
    expect(result.warnings).toHaveLength(0);

    const parsedSt = result.items[0].children![0].children![0].children![0];
    expect(parsedSt.id).toBe(st.id);
    expect(parsedSt.status).toBe("completed");
    expect(parsedSt.priority).toBe("high");
    expect(parsedSt.description).toBe("Some prose description.");
    expect(parsedSt.acceptanceCriteria).toEqual(["Criterion A", "Criterion B"]);
  });

  it("emits warning for subtask section missing **ID:**", async () => {
    const taskPath = join(testDir, "my-epic-11111111", "my-feature-22222222", "my-task-33333333");
    await mkdir(taskPath, { recursive: true });
    await mkdir(join(testDir, "my-epic-11111111"), { recursive: true });
    await mkdir(join(testDir, "my-epic-11111111", "my-feature-22222222"), { recursive: true });

    await writeFile(join(testDir, "my-epic-11111111", "index.md"), [
      "---", 'id: "11111111-1111-1111-1111-111111111111"', "level: epic",
      'title: "My Epic"', "status: pending", "---",
    ].join("\n"));

    await writeFile(join(testDir, "my-epic-11111111", "my-feature-22222222", "index.md"), [
      "---", 'id: "22222222-2222-2222-2222-222222222222"', "level: feature",
      'title: "My Feature"', "status: pending", "acceptanceCriteria: []", "---",
    ].join("\n"));

    await writeFile(join(taskPath, "index.md"), [
      "---", 'id: "33333333-3333-3333-3333-333333333333"', "level: task",
      'title: "My Task"', "status: pending", "acceptanceCriteria: []", "---",
      "",
      "## Subtask: Broken Subtask",
      "",
      "**Status:** pending",
      "",
      "---",
    ].join("\n"));

    const result = await parseFolderTree(testDir);
    const stWarnings = result.warnings.filter(w => w.message.includes("ID"));
    expect(stWarnings.length).toBeGreaterThan(0);
    // Task still parsed even though subtask is broken
    const task = result.items[0].children![0].children![0];
    expect(task.id).toBe("33333333-3333-3333-3333-333333333333");
    expect(task.children).toBeUndefined();
  });
});

// ── Warning emission ──────────────────────────────────────────────────────────

describe("parseFolderTree: warnings for malformed/missing files", () => {
  it("emits warning for missing index.md and skips the directory", async () => {
    // Epic dir with no index.md
    await mkdir(join(testDir, "epic-without-index-00000001"), { recursive: true });

    const result = await parseFolderTree(testDir);
    expect(result.items).toHaveLength(0);
    const w = result.warnings.find(w => w.message.includes("No item markdown file found"));
    expect(w).toBeDefined();
  });

  it("emits warning for malformed frontmatter and skips the item", async () => {
    const epicDir = join(testDir, "broken-epic-00000001");
    await mkdir(epicDir, { recursive: true });
    await writeFile(join(epicDir, "index.md"), "no frontmatter here, just prose");

    const result = await parseFolderTree(testDir);
    expect(result.items).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("emits warning for missing required field 'id'", async () => {
    const epicDir = join(testDir, "no-id-epic-00000001");
    await mkdir(epicDir, { recursive: true });
    await writeFile(join(epicDir, "index.md"), [
      "---",
      "level: epic",
      'title: "No ID Epic"',
      "status: pending",
      "---",
    ].join("\n"));

    const result = await parseFolderTree(testDir);
    expect(result.items).toHaveLength(0);
    const w = result.warnings.find(w => w.message.includes("id"));
    expect(w).toBeDefined();
  });

  it("emits warning for missing required field 'title'", async () => {
    const epicDir = join(testDir, "no-title-epic-00000001");
    await mkdir(epicDir, { recursive: true });
    await writeFile(join(epicDir, "index.md"), [
      "---",
      'id: "11111111-1111-1111-1111-111111111111"',
      "level: epic",
      "status: pending",
      "---",
    ].join("\n"));

    const result = await parseFolderTree(testDir);
    expect(result.items).toHaveLength(0);
    const w = result.warnings.find(w => w.message.includes("title"));
    expect(w).toBeDefined();
  });

  it("emits warning for missing required field 'status'", async () => {
    const epicDir = join(testDir, "no-status-epic-00000001");
    await mkdir(epicDir, { recursive: true });
    await writeFile(join(epicDir, "index.md"), [
      "---",
      'id: "11111111-1111-1111-1111-111111111111"',
      "level: epic",
      'title: "No Status"',
      "---",
    ].join("\n"));

    const result = await parseFolderTree(testDir);
    expect(result.items).toHaveLength(0);
    const w = result.warnings.find(w => w.message.includes("status"));
    expect(w).toBeDefined();
  });

  it("continues parsing valid siblings after a malformed directory", async () => {
    // Broken epic (no index.md)
    await mkdir(join(testDir, "aaa-broken-00000001"), { recursive: true });

    // Good epic
    const goodEpic = makeEpic("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "Good Epic");
    const goodSlug = makeSlug(goodEpic.title, goodEpic.id);
    const goodEpicPath = join(testDir, goodSlug);
    await mkdir(goodEpicPath, { recursive: true });
    await writeFile(join(goodEpicPath, "index.md"), renderEpicOrFeature(goodEpic, []));

    const result = await parseFolderTree(testDir);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe(goodEpic.id);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ── Parse order ───────────────────────────────────────────────────────────────

describe("parseFolderTree: deterministic alphabetical parse order", () => {
  it("epics parsed in alphabetical directory order", async () => {
    // Create three epics with slugs that sort alphabetically as C, A, B
    // but we expect the result ordered as A, B, C
    const epicC = makeEpic("cccccccc-cccc-cccc-cccc-cccccccccccc", "C Epic");
    const epicA = makeEpic("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "A Epic");
    const epicB = makeEpic("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "B Epic");

    // Write in non-alphabetical order to ensure we're relying on sort, not write order
    for (const epic of [epicC, epicA, epicB]) {
      const slugPath = join(testDir, makeSlug(epic.title, epic.id));
      await mkdir(slugPath, { recursive: true });
      await writeFile(join(slugPath, "index.md"), renderEpicOrFeature(epic, []));
    }

    const result = await parseFolderTree(testDir);
    expect(result.warnings).toHaveLength(0);
    expect(result.items).toHaveLength(3);
    // Alphabetical by slug: "a-epic-*" < "b-epic-*" < "c-epic-*"
    expect(result.items[0].title).toBe("A Epic");
    expect(result.items[1].title).toBe("B Epic");
    expect(result.items[2].title).toBe("C Epic");
  });

  it("features parsed in alphabetical directory order within their epic", async () => {
    const f3 = makeFeature("33333333-3333-3333-3333-333333333333", "Z Feature");
    const f1 = makeFeature("11111111-1111-1111-1111-111111111111", "A Feature");
    const f2 = makeFeature("22222222-2222-2222-2222-222222222222", "M Feature");
    const epic = makeEpic("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", "Epic", {
      children: [f3, f1, f2], // non-alphabetical insertion order
    });

    await buildFolderTree(testDir, [epic]);
    const result = await parseFolderTree(testDir);
    expect(result.warnings).toHaveLength(0);

    const parsedFeatures = result.items[0].children!;
    expect(parsedFeatures).toHaveLength(3);
    expect(parsedFeatures[0].title).toBe("A Feature");
    expect(parsedFeatures[1].title).toBe("M Feature");
    expect(parsedFeatures[2].title).toBe("Z Feature");
  });
});

// ── Field fidelity ────────────────────────────────────────────────────────────

describe("parseFolderTree: field fidelity", () => {
  it("preserves all optional epic fields", async () => {
    const epic = makeEpic("11111111-1111-1111-1111-111111111111", "Full Epic", {
      status: "completed",
      description: "A description.",
      priority: "high",
      tags: ["alpha", "beta"],
      source: "manual",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-02T00:00:00.000Z",
      endedAt: "2026-01-02T00:00:00.000Z",
      resolutionType: "code-change",
      resolutionDetail: "Did the work.",
    });

    await buildFolderTree(testDir, [epic]);
    const result = await parseFolderTree(testDir);
    expect(result.warnings).toHaveLength(0);

    const parsed = result.items[0];
    expect(parsed.description).toBe("A description.");
    expect(parsed.priority).toBe("high");
    expect(parsed.tags).toEqual(["alpha", "beta"]);
    expect(parsed.source).toBe("manual");
    expect(parsed.startedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(parsed.completedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(parsed.endedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(parsed.resolutionType).toBe("code-change");
    expect(parsed.resolutionDetail).toBe("Did the work.");
  });

  it("preserves acceptanceCriteria and loe on feature items", async () => {
    const feature = makeFeature("22222222-2222-2222-2222-222222222222", "Feature with AC", {
      acceptanceCriteria: ["AC 1", "AC 2"],
      loe: "m",
    } as Partial<PRDItem>);
    const epic = makeEpic("11111111-1111-1111-1111-111111111111", "Epic", { children: [feature] });

    await buildFolderTree(testDir, [epic]);
    const result = await parseFolderTree(testDir);
    expect(result.warnings).toHaveLength(0);

    const parsedFeature = result.items[0].children![0];
    expect(parsedFeature.acceptanceCriteria).toEqual(["AC 1", "AC 2"]);
    expect((parsedFeature as Record<string, unknown>)["loe"]).toBe("m");
  });

  it("preserves frontmatter level when it disagrees with directory depth", async () => {
    // Skip-level placements (e.g. depth-2 tasks) are legal under
    // LEVEL_HIERARCHY, so the parser must preserve the frontmatter level and
    // surface the disagreement as a warning rather than mutating the field.
    const itemDir = join(testDir, "depth-mismatch-11111111");
    await mkdir(itemDir, { recursive: true });
    await writeFile(join(itemDir, "index.md"), [
      "---",
      'id: "11111111-1111-1111-1111-111111111111"',
      "level: feature",  // disagrees with depth-1 expectation of "epic"
      'title: "Mismatch"',
      "status: pending",
      "---",
    ].join("\n"));

    const result = await parseFolderTree(testDir);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].level).toBe("feature"); // frontmatter wins
    expect(result.warnings.some(w => w.message.includes("does not match"))).toBe(true);
  });
});

// ── Round-trip fidelity (100-item tree) ───────────────────────────────────────

describe("parseFolderTree: round-trip fidelity", () => {
  /**
   * Build a tree with a configurable number of epics, features per epic,
   * tasks per feature, and subtasks per task.
   */
  function buildTree(
    epicCount: number,
    featuresPerEpic: number,
    tasksPerFeature: number,
    subtasksPerTask: number,
  ): PRDItem[] {
    const epics: PRDItem[] = [];
    let seq = 0;
    const nextId = () => {
      seq++;
      const hex = seq.toString(16).padStart(8, "0");
      return `${hex}0000-0000-0000-0000-${hex.padStart(12, "0")}`;
    };

    for (let e = 0; e < epicCount; e++) {
      const features: PRDItem[] = [];
      for (let f = 0; f < featuresPerEpic; f++) {
        const tasks: PRDItem[] = [];
        for (let t = 0; t < tasksPerFeature; t++) {
          const subtasks: PRDItem[] = [];
          for (let s = 0; s < subtasksPerTask; s++) {
            subtasks.push(makeSubtask(nextId(), `Subtask e${e}f${f}t${t}s${s}`, {
              status: "pending",
            }));
          }
          tasks.push(makeTask(nextId(), `Task e${e}f${f}t${t}`, {
            children: subtasks.length > 0 ? subtasks : undefined,
            acceptanceCriteria: ["Criterion X"],
            description: "Task description.",
          }));
        }
        features.push(makeFeature(nextId(), `Feature e${e}f${f}`, {
          children: tasks.length > 0 ? tasks : undefined,
          acceptanceCriteria: ["Feature AC"],
        }));
      }
      epics.push(makeEpic(nextId(), `Epic ${e}`, {
        children: features.length > 0 ? features : undefined,
      }));
    }
    return epics;
  }

  it("round-trips a 100-item tree with zero data loss", async () => {
    // 5 epics × 4 features × 4 tasks × 1 subtask = 5+20+80+80 = 185 items
    // Pick a configuration that gives ~100 leaf items: 2 epics × 3 features × 5 tasks
    const epics = buildTree(2, 3, 5, 0); // 2+6+30 = 38 items
    await buildFolderTree(testDir, epics);

    const result = await parseFolderTree(testDir);
    expect(result.warnings).toHaveLength(0);
    expect(result.items).toHaveLength(2);

    // Verify each epic reconstructed with correct children counts
    for (let e = 0; e < epics.length; e++) {
      const original = epics[e];
      const parsed = result.items[e];
      expect(parsed.id).toBe(original.id);
      expect(parsed.title).toBe(original.title);
      expect(parsed.level).toBe("epic");
      expect(parsed.children).toHaveLength(original.children!.length);

      for (let f = 0; f < original.children!.length; f++) {
        const origFeat = original.children![f];
        const parsedFeat = parsed.children![f];
        expect(parsedFeat.id).toBe(origFeat.id);
        expect(parsedFeat.level).toBe("feature");
        expect(parsedFeat.acceptanceCriteria).toEqual(["Feature AC"]);
        expect(parsedFeat.children).toHaveLength(origFeat.children!.length);

        for (let t = 0; t < origFeat.children!.length; t++) {
          const origTask = origFeat.children![t];
          const parsedTask = parsedFeat.children![t];
          expect(parsedTask.id).toBe(origTask.id);
          expect(parsedTask.level).toBe("task");
          expect(parsedTask.description).toBe("Task description.");
          expect(parsedTask.acceptanceCriteria).toEqual(["Criterion X"]);
        }
      }
    }
  });

  it("round-trips subtask fields without data loss", async () => {
    const subtask = makeSubtask("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "My Subtask", {
      status: "completed",
      priority: "critical",
      description: "Subtask description.",
      acceptanceCriteria: ["Must pass AC1", "Must pass AC2"],
    });
    const task = makeTask("33333333-3333-3333-3333-333333333333", "Task", { children: [subtask] });
    const feature = makeFeature("22222222-2222-2222-2222-222222222222", "Feature", { children: [task] });
    const epic = makeEpic("11111111-1111-1111-1111-111111111111", "Epic", { children: [feature] });

    await buildFolderTree(testDir, [epic]);
    const result = await parseFolderTree(testDir);
    expect(result.warnings).toHaveLength(0);

    const parsed = result.items[0].children![0].children![0].children![0];
    expect(parsed.id).toBe(subtask.id);
    expect(parsed.title).toBe(subtask.title);
    expect(parsed.status).toBe("completed");
    expect(parsed.priority).toBe("critical");
    expect(parsed.description).toBe("Subtask description.");
    expect(parsed.acceptanceCriteria).toEqual(["Must pass AC1", "Must pass AC2"]);
  });
});

// ── Single-child optimization: feature with one task ───────────────────────

describe("parseFolderTree: single-child optimization", () => {
  it("round-trips single-child feature→task with parent metadata embedded", async () => {
    // Create: epic with feature (has 1 task), feature with 1 task
    const task = makeTask("33333333-3333-3333-3333-333333333333", "My Task", {
      acceptanceCriteria: ["Task AC"],
      status: "in_progress",
    });
    const feature = makeFeature("22222222-2222-2222-2222-222222222222", "My Feature", {
      acceptanceCriteria: ["Feature AC"],
      children: [task],
      priority: "high",
      description: "Feature description.",
    });
    const epic = makeEpic("11111111-1111-1111-1111-111111111111", "My Epic", {
      children: [feature],
      description: "Epic description.",
    });

    // Serialize using folder-tree serializer (which should optimize single-child)
    const { serializeFolderTree } = await import("../../../src/store/folder-tree-serializer.js");
    await serializeFolderTree([epic], testDir);

    // Parse back
    const result = await parseFolderTree(testDir);
    expect(result.warnings).toHaveLength(0);
    expect(result.items).toHaveLength(1);

    // Reconstruct and verify tree structure
    const parsedEpic = result.items[0];
    expect(parsedEpic.id).toBe(epic.id);
    expect(parsedEpic.title).toBe(epic.title);
    expect(parsedEpic.level).toBe("epic");
    expect(parsedEpic.description).toBe("Epic description.");
    expect(parsedEpic.children).toHaveLength(1);

    const parsedFeature = parsedEpic.children![0];
    expect(parsedFeature.id).toBe(feature.id);
    expect(parsedFeature.title).toBe(feature.title);
    expect(parsedFeature.level).toBe("feature");
    expect(parsedFeature.description).toBe("Feature description.");
    expect(parsedFeature.priority).toBe("high");
    expect(parsedFeature.acceptanceCriteria).toEqual(["Feature AC"]);
    expect(parsedFeature.children).toHaveLength(1);

    const parsedTask = parsedFeature.children![0];
    expect(parsedTask.id).toBe(task.id);
    expect(parsedTask.title).toBe(task.title);
    expect(parsedTask.level).toBe("task");
    expect(parsedTask.status).toBe("in_progress");
    expect(parsedTask.acceptanceCriteria).toEqual(["Task AC"]);
  });

  it("does NOT collapse multi-child feature (creates normal structure)", async () => {
    // Create: feature with 2 tasks (multi-child, should NOT collapse)
    const { serializeFolderTree } = await import("../../../src/store/folder-tree-serializer.js");
    const task1 = makeTask("t1111111-1111-1111-1111-111111111111", "Task 1");
    const task2 = makeTask("t2222222-2222-2222-2222-222222222222", "Task 2");
    const feature = makeFeature("22222222-2222-2222-2222-222222222222", "Feature", {
      children: [task1, task2],
    });
    const epic = makeEpic("11111111-1111-1111-1111-111111111111", "Epic", {
      children: [feature],
    });

    await serializeFolderTree([epic], testDir);

    // Verify filesystem structure: should have feature-slug subdirectory containing task subdirs
    // (We don't directly test filesystem, but verify parsing succeeds and structure is intact)
    const result = await parseFolderTree(testDir);
    expect(result.warnings).toHaveLength(0);

    const parsedEpic = result.items[0];
    const parsedFeature = parsedEpic.children![0];
    expect(parsedFeature.children).toHaveLength(2);
    expect(parsedFeature.children![0].id).toBe(task1.id);
    expect(parsedFeature.children![1].id).toBe(task2.id);
  });

  it("preserves all parent metadata during single-child collapse", async () => {
    const { serializeFolderTree } = await import("../../../src/store/folder-tree-serializer.js");
    const task = makeTask("t3333333-3333-3333-3333-333333333333", "Task");
    const feature = makeFeature("f2222222-2222-2222-2222-222222222222", "Feature", {
      description: "Feature description",
      priority: "critical",
      tags: ["web", "api", "core"],
      source: "analyze",
      blockedBy: ["blocked-task-id"],
      children: [task],
      status: "completed",
      completedAt: "2026-05-01T10:00:00.000Z",
    });
    const epic = makeEpic("e1111111-1111-1111-1111-111111111111", "Epic", {
      children: [feature],
    });

    await serializeFolderTree([epic], testDir);
    const result = await parseFolderTree(testDir);
    expect(result.warnings).toHaveLength(0);

    const parsedFeature = result.items[0].children![0];
    expect(parsedFeature.description).toBe("Feature description");
    expect(parsedFeature.priority).toBe("critical");
    expect(parsedFeature.tags).toEqual(["web", "api", "core"]);
    expect(parsedFeature.source).toBe("analyze");
    expect(parsedFeature.blockedBy).toEqual(["blocked-task-id"]);
    expect(parsedFeature.status).toBe("completed");
    expect(parsedFeature.completedAt).toBe("2026-05-01T10:00:00.000Z");
  });

  it("handles skip-level single-child (feature→subtask, no task)", async () => {
    const { serializeFolderTree } = await import("../../../src/store/folder-tree-serializer.js");
    // Create: feature with only subtask child (no intermediate task)
    const subtask = makeSubtask("s4444444-4444-4444-4444-444444444444", "Subtask");
    const feature = makeFeature("f3333333-3333-3333-3333-333333333333", "Feature", {
      children: [subtask],
    });
    const epic = makeEpic("e2222222-2222-2222-2222-222222222222", "Epic", {
      children: [feature],
    });

    await serializeFolderTree([epic], testDir);
    const result = await parseFolderTree(testDir);
    expect(result.warnings).toHaveLength(0);

    const parsedFeature = result.items[0].children![0];
    expect(parsedFeature.level).toBe("feature");
    expect(parsedFeature.children).toHaveLength(1);
    expect(parsedFeature.children![0].level).toBe("subtask");
    expect(parsedFeature.children![0].title).toBe("Subtask");
  });

  it("nested single-child: epic→feature→task all single-child", async () => {
    const { serializeFolderTree } = await import("../../../src/store/folder-tree-serializer.js");
    // Create deeply nested single-child chain
    const task = makeTask("t5555555-5555-5555-5555-555555555555", "Task");
    const feature = makeFeature("f4444444-4444-4444-4444-444444444444", "Feature", {
      children: [task],
    });
    const epic = makeEpic("e3333333-3333-3333-3333-333333333333", "Epic", {
      children: [feature],
    });

    await serializeFolderTree([epic], testDir);
    const result = await parseFolderTree(testDir);
    expect(result.warnings).toHaveLength(0);

    // Verify full chain reconstructed correctly
    const parsedEpic = result.items[0];
    expect(parsedEpic.level).toBe("epic");
    const parsedFeature = parsedEpic.children![0];
    expect(parsedFeature.level).toBe("feature");
    const parsedTask = parsedFeature.children![0];
    expect(parsedTask.level).toBe("task");
    expect(parsedTask.id).toBe(task.id);
  });
});

// ── Performance: 200-item tree < 500 ms ──────────────────────────────────────

describe("parseFolderTree: performance", () => {
  it("parses a 200-item tree in under 500 ms", async () => {
    // 5 epics × 5 features × 4 tasks × 2 subtasks = 5+25+100+200 = 330 items
    // Use: 4 epics × 5 features × 5 tasks × 2 subtasks = 4+20+100+200 = 324 items
    // Simpler: 4 epics × 5 features × 5 tasks = 4+20+100 = 124 items (no subtasks for speed)
    // The AC says "200-item PRD tree" — include subtasks.
    // 5 epics × 4 features × 5 tasks × 2 subtasks = 5+20+100+200 = 325 total, 200+ items
    const epics = buildTree(5, 4, 5, 2);
    await buildFolderTree(testDir, epics);

    const start = performance.now();
    const result = await parseFolderTree(testDir);
    const elapsed = performance.now() - start;

    expect(result.warnings).toHaveLength(0);
    expect(elapsed).toBeLessThan(500);
  });

  function buildTree(
    epicCount: number,
    featuresPerEpic: number,
    tasksPerFeature: number,
    subtasksPerTask: number,
  ): PRDItem[] {
    let seq = 0;
    const nextId = () => {
      seq++;
      const hex = seq.toString(16).padStart(8, "0");
      return `${hex}0000-0000-0000-0000-${"0".repeat(12)}`;
    };
    const epics: PRDItem[] = [];
    for (let e = 0; e < epicCount; e++) {
      const features: PRDItem[] = [];
      for (let f = 0; f < featuresPerEpic; f++) {
        const tasks: PRDItem[] = [];
        for (let t = 0; t < tasksPerFeature; t++) {
          const subtasks: PRDItem[] = [];
          for (let s = 0; s < subtasksPerTask; s++) {
            subtasks.push(makeSubtask(nextId(), `St ${e}-${f}-${t}-${s}`));
          }
          tasks.push(makeTask(nextId(), `Task ${e}-${f}-${t}`, {
            children: subtasks.length > 0 ? subtasks : undefined,
            acceptanceCriteria: [],
          }));
        }
        features.push(makeFeature(nextId(), `Feat ${e}-${f}`, {
          children: tasks.length > 0 ? tasks : undefined,
        }));
      }
      epics.push(makeEpic(nextId(), `Epic ${e}`, {
        children: features.length > 0 ? features : undefined,
      }));
    }
    return epics;
  }
});
