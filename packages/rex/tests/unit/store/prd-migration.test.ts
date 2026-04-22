import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, readdir, access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { migrateLegacyPRD } from "../../../src/store/prd-migration.js";
import { resolveStore } from "../../../src/store/index.js";
import { cmdInit } from "../../../src/cli/commands/init.js";
import { SCHEMA_VERSION } from "../../../src/schema/v1.js";
import { toCanonicalJSON } from "../../../src/core/canonical.js";
import type { PRDDocument } from "../../../src/schema/v1.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function initRepo(dir: string): void {
  git(dir, "init", "--initial-branch=main");
  git(dir, "config", "user.email", "test@test.com");
  git(dir, "config", "user.name", "Test");
}

function makeDoc(title: string, items: PRDDocument["items"] = []): PRDDocument {
  return { schema: SCHEMA_VERSION, title, items };
}

async function writePRD(rexDir: string, filename: string, doc: PRDDocument): Promise<void> {
  await writeFile(join(rexDir, filename), toCanonicalJSON(doc), "utf-8");
}

// ---------------------------------------------------------------------------
// migrateLegacyPRD — unit tests
// ---------------------------------------------------------------------------

describe("migrateLegacyPRD", () => {
  let tmpDir: string;
  let rexDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-migration-"));
    rexDir = join(tmpDir, ".rex");
    await mkdir(rexDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("migrates legacy prd.json to branch-scoped filename", async () => {
    initRepo(tmpDir);
    execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
      cwd: tmpDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2025-01-15T12:00:00Z",
        GIT_COMMITTER_DATE: "2025-01-15T12:00:00Z",
      },
    });

    const doc = makeDoc("My Project", [
      {
        id: "e1",
        title: "Epic One",
        level: "epic",
        status: "in_progress",
        children: [
          { id: "f1", title: "Feature", level: "feature", status: "pending", children: [] },
        ],
      },
    ]);
    await writePRD(rexDir, "prd.json", doc);

    const result = await migrateLegacyPRD(rexDir, tmpDir);

    expect(result.migrated).toBe(true);
    expect(result.filename).toBe("prd_main_2025-01-15.json");
    expect(result.backupFilename).toMatch(/^prd\.json\.backup\.\d{4}-\d{2}-\d{2}T/);

    // Original prd.json should be gone
    await expect(access(join(rexDir, "prd.json"))).rejects.toThrow();

    // Branch file should contain the same data
    const migrated = JSON.parse(await readFile(join(rexDir, result.filename!), "utf-8"));
    expect(migrated.title).toBe("My Project");
    expect(migrated.items).toHaveLength(1);
    expect(migrated.items[0].id).toBe("e1");
    expect(migrated.items[0].children[0].id).toBe("f1");

    // Backup should exist with same content
    const backup = JSON.parse(await readFile(join(rexDir, result.backupFilename!), "utf-8"));
    expect(backup.title).toBe("My Project");
    expect(backup.items[0].id).toBe("e1");
  });

  it("preserves all item IDs, parent references, and metadata", async () => {
    initRepo(tmpDir);
    execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
      cwd: tmpDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2025-06-01T12:00:00Z",
        GIT_COMMITTER_DATE: "2025-06-01T12:00:00Z",
      },
    });

    const deepTree = makeDoc("Deep PRD", [
      {
        id: "epic-1",
        title: "Epic",
        level: "epic" as const,
        status: "in_progress" as const,
        priority: "high" as const,
        description: "An important epic",
        tags: ["core", "v1"],
        children: [
          {
            id: "feat-1",
            title: "Feature",
            level: "feature" as const,
            status: "pending" as const,
            children: [
              {
                id: "task-1",
                title: "Task",
                level: "task" as const,
                status: "pending" as const,
                blockedBy: ["task-2"],
                children: [
                  {
                    id: "sub-1",
                    title: "Subtask",
                    level: "subtask" as const,
                    status: "pending" as const,
                    children: [],
                  },
                ],
              },
              {
                id: "task-2",
                title: "Task 2",
                level: "task" as const,
                status: "completed" as const,
                children: [],
              },
            ],
          },
        ],
      },
    ]);
    await writePRD(rexDir, "prd.json", deepTree);

    const result = await migrateLegacyPRD(rexDir, tmpDir);
    expect(result.migrated).toBe(true);

    const migrated = JSON.parse(await readFile(join(rexDir, result.filename!), "utf-8"));
    const epic = migrated.items[0];
    expect(epic.id).toBe("epic-1");
    expect(epic.priority).toBe("high");
    expect(epic.description).toBe("An important epic");
    expect(epic.tags).toEqual(["core", "v1"]);

    const task = epic.children[0].children[0];
    expect(task.id).toBe("task-1");
    expect(task.blockedBy).toEqual(["task-2"]);

    const subtask = task.children[0];
    expect(subtask.id).toBe("sub-1");
  });

  it("is idempotent — second run returns no-op", async () => {
    initRepo(tmpDir);
    execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
      cwd: tmpDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2025-01-15T12:00:00Z",
        GIT_COMMITTER_DATE: "2025-01-15T12:00:00Z",
      },
    });

    await writePRD(rexDir, "prd.json", makeDoc("Project"));

    // First migration
    const first = await migrateLegacyPRD(rexDir, tmpDir);
    expect(first.migrated).toBe(true);

    // Second migration — no prd.json left, branch file exists
    const second = await migrateLegacyPRD(rexDir, tmpDir);
    expect(second.migrated).toBe(false);
    expect(second.reason).toBe("branch-files-exist");

    // Only one branch file should exist
    const files = (await readdir(rexDir)).filter((f) => f.startsWith("prd_"));
    expect(files).toHaveLength(1);
  });

  it("skips when branch-scoped files already exist alongside prd.json", async () => {
    initRepo(tmpDir);
    execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
      cwd: tmpDir,
      encoding: "utf-8",
    });

    await writePRD(rexDir, "prd.json", makeDoc("Legacy"));
    await writePRD(rexDir, "prd_develop_2025-02-01.json", makeDoc("Develop"));

    const result = await migrateLegacyPRD(rexDir, tmpDir);
    expect(result.migrated).toBe(false);
    expect(result.reason).toBe("branch-files-exist");

    // prd.json should still be there (not touched)
    const raw = await readFile(join(rexDir, "prd.json"), "utf-8");
    expect(JSON.parse(raw).title).toBe("Legacy");
  });

  it("skips when no prd.json exists", async () => {
    initRepo(tmpDir);
    execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
      cwd: tmpDir,
      encoding: "utf-8",
    });

    const result = await migrateLegacyPRD(rexDir, tmpDir);
    expect(result.migrated).toBe(false);
    expect(result.reason).toBe("no-legacy-file");
  });

  it("creates backup with timestamp in filename", async () => {
    initRepo(tmpDir);
    execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
      cwd: tmpDir,
      encoding: "utf-8",
    });

    await writePRD(rexDir, "prd.json", makeDoc("Project"));

    const result = await migrateLegacyPRD(rexDir, tmpDir);
    expect(result.migrated).toBe(true);

    // Backup filename contains ISO-ish timestamp
    expect(result.backupFilename).toMatch(
      /^prd\.json\.backup\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/,
    );

    // Backup file is readable
    const backupContent = JSON.parse(
      await readFile(join(rexDir, result.backupFilename!), "utf-8"),
    );
    expect(backupContent.title).toBe("Project");
  });

  it("skips migration when not inside a git repo", async () => {
    // tmpDir is NOT a git repo here
    await writePRD(rexDir, "prd.json", makeDoc("Non-Git Project"));

    const result = await migrateLegacyPRD(rexDir, tmpDir);
    expect(result.migrated).toBe(false);
    expect(result.reason).toBe("no-git-context");

    // prd.json should still be there
    const raw = await readFile(join(rexDir, "prd.json"), "utf-8");
    expect(JSON.parse(raw).title).toBe("Non-Git Project");
  });

  it("works on a feature branch", async () => {
    initRepo(tmpDir);
    execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
      cwd: tmpDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2025-01-15T12:00:00Z",
        GIT_COMMITTER_DATE: "2025-01-15T12:00:00Z",
      },
    });

    git(tmpDir, "checkout", "-b", "feature/cool-thing");
    execFileSync("git", ["commit", "--allow-empty", "-m", "branch work"], {
      cwd: tmpDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2025-04-01T12:00:00Z",
        GIT_COMMITTER_DATE: "2025-04-01T12:00:00Z",
      },
    });

    await writePRD(rexDir, "prd.json", makeDoc("Feature Work"));

    const result = await migrateLegacyPRD(rexDir, tmpDir);
    expect(result.migrated).toBe(true);
    expect(result.filename).toBe("prd_feature-cool-thing_2025-04-01.json");
  });
});

// ---------------------------------------------------------------------------
// resolveStore migration integration — verifies resolveStore triggers migration
// ---------------------------------------------------------------------------

describe("resolveStore auto-migration", () => {
  let tmpDir: string;
  let rexDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-store-migration-"));
    rexDir = join(tmpDir, ".rex");
    await mkdir(rexDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("auto-migrates legacy prd.json when resolveStore is called", async () => {
    initRepo(tmpDir);
    execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
      cwd: tmpDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2025-03-10T12:00:00Z",
        GIT_COMMITTER_DATE: "2025-03-10T12:00:00Z",
      },
    });

    const doc = makeDoc("Auto Migrate", [
      { id: "e1", title: "Epic", level: "epic", status: "pending", children: [] },
    ]);
    await writePRD(rexDir, "prd.json", doc);

    const store = await resolveStore(rexDir);
    const loaded = await store.loadDocument();

    // Should load successfully with migrated data
    expect(loaded.title).toBe("Auto Migrate");
    expect(loaded.items).toHaveLength(1);
    expect(loaded.items[0].id).toBe("e1");

    // prd.json should be gone
    await expect(access(join(rexDir, "prd.json"))).rejects.toThrow();

    // Branch file should exist
    const files = await readdir(rexDir);
    const branchFiles = files.filter((f) => f.startsWith("prd_main"));
    expect(branchFiles).toHaveLength(1);

    // Backup should exist
    const backups = files.filter((f) => f.startsWith("prd.json.backup"));
    expect(backups).toHaveLength(1);
  });

  it("routes new root items to migrated file after migration", async () => {
    initRepo(tmpDir);
    execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
      cwd: tmpDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2025-03-10T12:00:00Z",
        GIT_COMMITTER_DATE: "2025-03-10T12:00:00Z",
      },
    });

    // Also need config.json for resolveStore
    await writePRD(rexDir, "prd.json", makeDoc("Project"));

    const store = await resolveStore(rexDir);

    // Load to populate state
    await store.loadDocument();

    // Add a root item — should go to the migrated branch file, not prd.json
    await store.addItem({
      id: "new-epic",
      title: "New Epic",
      level: "epic",
      status: "pending",
      children: [],
    });

    // prd.json should NOT be recreated
    await expect(access(join(rexDir, "prd.json"))).rejects.toThrow();

    // The new item should be in the branch file
    const doc = await store.loadDocument();
    expect(doc.items.some((i) => i.id === "new-epic")).toBe(true);
  });

  it("does not migrate when branch files already exist", async () => {
    initRepo(tmpDir);
    execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
      cwd: tmpDir,
      encoding: "utf-8",
    });

    await writePRD(rexDir, "prd.json", makeDoc("Legacy", [
      { id: "e1", title: "Legacy Epic", level: "epic", status: "pending", children: [] },
    ]));
    await writePRD(rexDir, "prd_develop_2025-02-01.json", makeDoc("Develop", [
      { id: "e2", title: "Dev Epic", level: "epic", status: "pending", children: [] },
    ]));

    const store = await resolveStore(rexDir);
    const loaded = await store.loadDocument();

    // Should aggregate both files without migrating
    expect(loaded.items).toHaveLength(2);

    // prd.json should still exist (not migrated)
    const raw = await readFile(join(rexDir, "prd.json"), "utf-8");
    expect(JSON.parse(raw).title).toBe("Legacy");

    // No backups should exist
    const files = await readdir(rexDir);
    const backups = files.filter((f) => f.startsWith("prd.json.backup"));
    expect(backups).toHaveLength(0);
  });

  it("migration is idempotent across multiple resolveStore calls", async () => {
    initRepo(tmpDir);
    execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
      cwd: tmpDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2025-03-10T12:00:00Z",
        GIT_COMMITTER_DATE: "2025-03-10T12:00:00Z",
      },
    });

    await writePRD(rexDir, "prd.json", makeDoc("Project", [
      { id: "e1", title: "Epic", level: "epic", status: "pending", children: [] },
    ]));

    // Resolve store multiple times (simulating multiple CLI invocations)
    const store1 = await resolveStore(rexDir);
    const doc1 = await store1.loadDocument();

    const store2 = await resolveStore(rexDir);
    const doc2 = await store2.loadDocument();

    const store3 = await resolveStore(rexDir);
    const doc3 = await store3.loadDocument();

    expect(doc1.items).toHaveLength(1);
    expect(doc2.items).toHaveLength(1);
    expect(doc3.items).toHaveLength(1);

    // Only one branch file and one backup should exist
    const files = await readdir(rexDir);
    const branchFiles = files.filter((f) => f.startsWith("prd_main"));
    const backups = files.filter((f) => f.startsWith("prd.json.backup"));
    expect(branchFiles).toHaveLength(1);
    expect(backups).toHaveLength(1);
  });

  it("skips migration in non-git directories", async () => {
    // tmpDir is NOT a git repo — resolveStore should not migrate
    await writePRD(rexDir, "prd.json", makeDoc("Non-Git", [
      { id: "e1", title: "Epic", level: "epic", status: "pending", children: [] },
    ]));

    const store = await resolveStore(rexDir);
    const doc = await store.loadDocument();

    // Should load from prd.json without migrating
    expect(doc.items).toHaveLength(1);

    // prd.json should still exist
    const raw = await readFile(join(rexDir, "prd.json"), "utf-8");
    expect(JSON.parse(raw).title).toBe("Non-Git");

    // No backups or branch files
    const files = await readdir(rexDir);
    expect(files.filter((f) => f.startsWith("prd.json.backup"))).toHaveLength(0);
    expect(files.filter((f) => f.startsWith("prd_"))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// cmdInit branch-scoped file creation
// ---------------------------------------------------------------------------

describe("cmdInit branch-scoped PRD creation", () => {
  let tmpDir: string;
  let rexDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-init-branch-"));
    rexDir = join(tmpDir, ".rex");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates a branch-scoped PRD file in a git repo", async () => {
    initRepo(tmpDir);
    execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
      cwd: tmpDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2025-05-20T12:00:00Z",
        GIT_COMMITTER_DATE: "2025-05-20T12:00:00Z",
      },
    });

    await cmdInit(tmpDir, {});

    const files = await readdir(rexDir);
    const branchFiles = files.filter((f) => f.startsWith("prd_main"));
    expect(branchFiles).toHaveLength(1);

    // Should NOT create prd.json
    expect(files).not.toContain("prd.json");

    // The branch file should have valid content
    const doc = JSON.parse(await readFile(join(rexDir, branchFiles[0]), "utf-8"));
    expect(doc.schema).toBe(SCHEMA_VERSION);
    expect(doc.items).toEqual([]);
  });

  it("falls back to prd.json in non-git directories", async () => {
    await cmdInit(tmpDir, {});

    const files = await readdir(rexDir);
    expect(files).toContain("prd.json");

    // No branch-scoped files
    const branchFiles = files.filter((f) => f.startsWith("prd_"));
    expect(branchFiles).toHaveLength(0);
  });

  it("skips PRD creation when branch-scoped file already exists", async () => {
    initRepo(tmpDir);
    execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
      cwd: tmpDir,
      encoding: "utf-8",
    });

    // Pre-create a branch file
    await mkdir(rexDir, { recursive: true });
    await writePRD(rexDir, "prd_main_2025-01-01.json", makeDoc("Existing"));

    await cmdInit(tmpDir, {});

    // Should not create a second file
    const files = await readdir(rexDir);
    const branchFiles = files.filter((f) => f.startsWith("prd_"));
    expect(branchFiles).toHaveLength(1);
    expect(branchFiles[0]).toBe("prd_main_2025-01-01.json");

    // Content should be unchanged
    const doc = JSON.parse(await readFile(join(rexDir, branchFiles[0]), "utf-8"));
    expect(doc.title).toBe("Existing");
  });
});
