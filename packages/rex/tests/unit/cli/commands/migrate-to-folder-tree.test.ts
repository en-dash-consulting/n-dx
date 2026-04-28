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
import type { PRDDocument } from "../../../../src/schema/index.js";

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

    await cmdMigrateToFolderTree(tmp);

    const treeDir = join(tmp, ".rex", "tree");
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

    const epicIndex = readFileSync(join(epicDir, "index.md"), "utf-8");
    expect(epicIndex).toContain("Epic Alpha");
    expect(epicIndex).toContain("e1111111");
  });

  it("prints creation summary on first run", async () => {
    writeFileSync(join(tmp, ".rex", "prd.json"), JSON.stringify(SAMPLE_PRD));

    await cmdMigrateToFolderTree(tmp);

    const out = output();
    expect(out).toContain("Migrated .rex/prd.md → .rex/tree/");
    expect(out).toMatch(/folder.*created/);
    expect(out).toMatch(/index\.md file.*written/);
  });

  it("is idempotent: re-running prints 'already up to date'", async () => {
    writeFileSync(join(tmp, ".rex", "prd.json"), JSON.stringify(SAMPLE_PRD));

    await cmdMigrateToFolderTree(tmp);
    logSpy.mockClear();

    await cmdMigrateToFolderTree(tmp);

    expect(output()).toContain("already up to date");
  });

  it("is idempotent: re-running does not duplicate directories", async () => {
    writeFileSync(join(tmp, ".rex", "prd.json"), JSON.stringify(SAMPLE_PRD));

    await cmdMigrateToFolderTree(tmp);
    await cmdMigrateToFolderTree(tmp);

    const treeDir = join(tmp, ".rex", "tree");
    expect(subdirs(treeDir)).toHaveLength(1);
  });
});
