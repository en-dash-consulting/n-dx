/**
 * Tests for `rex migrate-to-folder-tree`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { cmdMigrateToFolderTree } from "../../../../src/cli/commands/migrate-to-folder-tree.js";
import { titleToFilename } from "../../../../src/store/title-to-filename.js";
import type { PRDDocument } from "../../../../src/schema/index.js";
import { PRD_TREE_DIRNAME } from "../../../../src/store/index.js";

const SAMPLE_PRD: PRDDocument = {
  schema: "rex/v1",
  title: "Test Project",
  items: [
    {
      id: "e1111111-0000-0000-0000-000000000001",
      title: "Epic Alpha",
      level: "epic",
      status: "in_progress",
      description: "First epic",
      children: [
        {
          id: "f1111111-0000-0000-0000-000000000002",
          title: "Feature One",
          level: "feature",
          status: "pending",
          description: "A feature",
          acceptanceCriteria: ["Does the thing"],
          children: [
            {
              id: "t1111111-0000-0000-0000-000000000003",
              title: "Task Apple",
              level: "task",
              status: "pending",
              description: "A task",
              acceptanceCriteria: ["Works"],
            },
          ],
        },
      ],
    },
  ],
};

/** Write a minimal prd.md from a PRDDocument (enough for the markdown parser). */
function writePrdMd(rexDir: string, doc: PRDDocument): void {
  const lines: string[] = [`# ${doc.title}`, ""];
  function writeItem(item: PRDDocument["items"][number], depth: number): void {
    const heading = "#".repeat(depth + 1);
    lines.push(`${heading} ${item.title}`);
    lines.push("");
    lines.push(`id: ${item.id}`);
    lines.push(`level: ${item.level}`);
    lines.push(`status: ${item.status}`);
    if (item.description) lines.push(`description: ${item.description}`);
    lines.push("");
    for (const child of item.children ?? []) {
      writeItem(child, depth + 1);
    }
  }
  for (const item of doc.items) writeItem(item, 1);
  writeFileSync(join(rexDir, "prd.md"), lines.join("\n"), "utf-8");
}

/** Simple prd.md builder using rex markdown serializer format. */
function writePrdMdSerialized(rexDir: string, doc: PRDDocument): void {
  // Use JSON-source prd.json as fallback to avoid needing the full markdown serializer
  // The migration command tries prd.md first, then prd.json
  writeFileSync(join(rexDir, "prd.json"), JSON.stringify(doc));
}

function subdirs(dir: string): string[] {
  return readdirSync(dir).filter((e) => statSync(join(dir, e)).isDirectory());
}

describe("cmdMigrateToFolderTree", () => {
  let tmp: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "rex-migrate-tree-test-"));
    mkdirSync(join(tmp, ".rex"), { recursive: true });
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    rmSync(tmp, { recursive: true });
  });

  function output(): string {
    return logSpy.mock.calls.map((c) => c[0] ?? "").join("\n");
  }

  it("creates folder tree from prd.json with zero data loss", async () => {
    writeFileSync(join(tmp, ".rex", "prd.json"), JSON.stringify(SAMPLE_PRD));

    await cmdMigrateToFolderTree(tmp, {}, { prompt: () => Promise.resolve("n") });

    const treeDir = join(tmp, ".rex", PRD_TREE_DIRNAME);
    expect(existsSync(treeDir)).toBe(true);

    const epicDirs = subdirs(treeDir);
    expect(epicDirs).toHaveLength(1);
    expect(epicDirs[0]).toMatch(/epic-alpha/);

    const epicDir = join(treeDir, epicDirs[0]);
    const featureDirs = subdirs(epicDir);
    expect(featureDirs).toHaveLength(1);
    expect(featureDirs[0]).toMatch(/feature-one/);

    const featureDir = join(epicDir, featureDirs[0]);
    const taskDirs = subdirs(featureDir);
    expect(taskDirs).toHaveLength(1);
    expect(taskDirs[0]).toMatch(/task-apple/);

    const epicIndex = readFileSync(join(epicDir, titleToFilename("Epic Alpha")), "utf-8");
    expect(epicIndex).toContain("Epic Alpha");
    expect(epicIndex).toContain("e1111111");
  });

  it("prints creation summary on first run", async () => {
    writeFileSync(join(tmp, ".rex", "prd.json"), JSON.stringify(SAMPLE_PRD));

    await cmdMigrateToFolderTree(tmp, {}, { prompt: () => Promise.resolve("n") });

    const out = output();
    expect(out).toContain(`Migrated .rex/prd.md → .rex/${PRD_TREE_DIRNAME}/`);
    expect(out).toMatch(/folder.*created/);
    expect(out).toMatch(/item file.*written/);
  });

  it("is idempotent: re-running prints 'already up to date'", async () => {
    writeFileSync(join(tmp, ".rex", "prd.json"), JSON.stringify(SAMPLE_PRD));

    await cmdMigrateToFolderTree(tmp, {}, { prompt: () => Promise.resolve("n") });
    logSpy.mockClear();

    await cmdMigrateToFolderTree(tmp, {}, { prompt: () => Promise.resolve("n") });

    expect(output()).toContain("already up to date");
  });

  it("is idempotent: re-running does not duplicate directories", async () => {
    writeFileSync(join(tmp, ".rex", "prd.json"), JSON.stringify(SAMPLE_PRD));

    await cmdMigrateToFolderTree(tmp, {}, { prompt: () => Promise.resolve("n") });
    await cmdMigrateToFolderTree(tmp, {}, { prompt: () => Promise.resolve("n") });

    const treeDir = join(tmp, ".rex", PRD_TREE_DIRNAME);
    expect(subdirs(treeDir)).toHaveLength(1);
  });

  it("emits item count summary per PRD level", async () => {
    writeFileSync(join(tmp, ".rex", "prd.json"), JSON.stringify(SAMPLE_PRD));

    await cmdMigrateToFolderTree(tmp, {}, { prompt: () => Promise.resolve("n") });

    const out = output();
    expect(out).toMatch(/1 epic/);
    expect(out).toMatch(/1 feature/);
    expect(out).toMatch(/1 task/);
  });

  it("does not emit levels with zero count", async () => {
    writeFileSync(join(tmp, ".rex", "prd.json"), JSON.stringify(SAMPLE_PRD));

    await cmdMigrateToFolderTree(tmp, {}, { prompt: () => Promise.resolve("n") });

    // SAMPLE_PRD has no subtasks
    expect(output()).not.toMatch(/subtask/);
  });

  it("prompts to delete prd.md after successful migration", async () => {
    writeFileSync(join(tmp, ".rex", "prd.json"), JSON.stringify(SAMPLE_PRD));
    writeFileSync(join(tmp, ".rex", "prd.md"), "# Test Project\n");

    const questions: string[] = [];
    const prompt = (q: string) => { questions.push(q); return Promise.resolve("n"); };

    await cmdMigrateToFolderTree(tmp, {}, { prompt });

    expect(questions.length).toBeGreaterThan(0);
    expect(questions[0]).toMatch(/[Dd]elete.*prd\.md/);
  });

  it("deletes prd.md when user confirms with y", async () => {
    writeFileSync(join(tmp, ".rex", "prd.json"), JSON.stringify(SAMPLE_PRD));
    writeFileSync(join(tmp, ".rex", "prd.md"), "# Test Project\n");

    await cmdMigrateToFolderTree(tmp, {}, { prompt: () => Promise.resolve("y") });

    expect(existsSync(join(tmp, ".rex", "prd.md"))).toBe(false);
  });

  it("does not delete prd.md when user declines", async () => {
    writeFileSync(join(tmp, ".rex", "prd.json"), JSON.stringify(SAMPLE_PRD));
    writeFileSync(join(tmp, ".rex", "prd.md"), "# Test Project\n");

    await cmdMigrateToFolderTree(tmp, {}, { prompt: () => Promise.resolve("n") });

    expect(existsSync(join(tmp, ".rex", "prd.md"))).toBe(true);
  });

  it("deletes branch-scoped prd files when user confirms", async () => {
    writeFileSync(join(tmp, ".rex", "prd.json"), JSON.stringify(SAMPLE_PRD));
    writeFileSync(join(tmp, ".rex", "prd.md"), "# Test Project\n");
    writeFileSync(join(tmp, ".rex", "prd_feature-x_2026-04-01.md"), "# branch prd\n");

    await cmdMigrateToFolderTree(tmp, {}, { prompt: () => Promise.resolve("y") });

    expect(existsSync(join(tmp, ".rex", "prd.md"))).toBe(false);
    expect(existsSync(join(tmp, ".rex", "prd_feature-x_2026-04-01.md"))).toBe(false);
  });

  it("skips delete prompt when no prd.md files exist", async () => {
    writeFileSync(join(tmp, ".rex", "prd.json"), JSON.stringify(SAMPLE_PRD));
    // No prd.md present

    const questions: string[] = [];
    const prompt = (q: string) => { questions.push(q); return Promise.resolve("n"); };

    await cmdMigrateToFolderTree(tmp, {}, { prompt });

    expect(questions).toHaveLength(0);
  });

  it("--yes flag auto-confirms deletion without prompting", async () => {
    writeFileSync(join(tmp, ".rex", "prd.json"), JSON.stringify(SAMPLE_PRD));
    writeFileSync(join(tmp, ".rex", "prd.md"), "# Test Project\n");

    const questions: string[] = [];
    const prompt = (q: string) => { questions.push(q); return Promise.resolve("n"); };

    await cmdMigrateToFolderTree(tmp, { yes: "true" }, { prompt });

    // --yes bypasses the prompt fn entirely
    expect(questions).toHaveLength(0);
    expect(existsSync(join(tmp, ".rex", "prd.md"))).toBe(false);
  });

  it("re-run after prd.md deletion reads from tree and stays idempotent", async () => {
    writeFileSync(join(tmp, ".rex", "prd.json"), JSON.stringify(SAMPLE_PRD));
    writeFileSync(join(tmp, ".rex", "prd.md"), "# Test Project\n");

    // First run: migrate and delete prd.md
    await cmdMigrateToFolderTree(tmp, { yes: "true" });

    expect(existsSync(join(tmp, ".rex", "prd.md"))).toBe(false);

    // Second run: prd.md gone, tree exists → should be a no-op
    logSpy.mockClear();
    await cmdMigrateToFolderTree(tmp, {}, { prompt: () => Promise.resolve("n") });

    expect(output()).toContain("already up to date");
  });
});
