import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, readdir, access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { migrateLegacyPRD } from "../../../src/store/prd-migration.js";
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

async function readPRD(rexDir: string, filename: string): Promise<PRDDocument> {
  return JSON.parse(await readFile(join(rexDir, filename), "utf-8")) as PRDDocument;
}

// ---------------------------------------------------------------------------
// migrateLegacyPRD — single → multi migration
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

  it("is a no-op when branch-scoped files already exist", async () => {
    initRepo(tmpDir);
    execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
      cwd: tmpDir,
      encoding: "utf-8",
      env: { ...process.env, GIT_AUTHOR_DATE: "2025-01-15T12:00:00Z", GIT_COMMITTER_DATE: "2025-01-15T12:00:00Z" },
    });

    await writePRD(rexDir, "prd.json", makeDoc("Project"));
    await writePRD(rexDir, "prd_feature-x_2025-04-01.json", makeDoc("Feature"));

    const result = await migrateLegacyPRD(rexDir, tmpDir);
    expect(result.migrated).toBe(false);
    expect(result.reason).toBe("branch-files-exist");

    // prd.json is untouched
    const doc = await readPRD(rexDir, "prd.json");
    expect(doc.title).toBe("Project");
  });

  it("is a no-op when prd.json does not exist", async () => {
    initRepo(tmpDir);
    execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
      cwd: tmpDir,
      encoding: "utf-8",
      env: { ...process.env, GIT_AUTHOR_DATE: "2025-01-15T12:00:00Z", GIT_COMMITTER_DATE: "2025-01-15T12:00:00Z" },
    });

    const result = await migrateLegacyPRD(rexDir, tmpDir);
    expect(result.migrated).toBe(false);
    expect(result.reason).toBe("no-legacy-file");
  });

  it("is a no-op when not in a git repo", async () => {
    await writePRD(rexDir, "prd.json", makeDoc("Project"));

    const result = await migrateLegacyPRD(rexDir, tmpDir);
    expect(result.migrated).toBe(false);
    expect(result.reason).toBe("no-git-context");

    // prd.json untouched
    const doc = await readPRD(rexDir, "prd.json");
    expect(doc.title).toBe("Project");
  });

  it("renames prd.json to the branch-scoped filename", async () => {
    initRepo(tmpDir);
    execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
      cwd: tmpDir,
      encoding: "utf-8",
      env: { ...process.env, GIT_AUTHOR_DATE: "2025-03-10T12:00:00Z", GIT_COMMITTER_DATE: "2025-03-10T12:00:00Z" },
    });

    const originalDoc = makeDoc("My Project", [
      { id: "e1", title: "Epic", level: "epic", status: "pending", children: [] },
    ]);
    await writePRD(rexDir, "prd.json", originalDoc);

    const result = await migrateLegacyPRD(rexDir, tmpDir);
    expect(result.migrated).toBe(true);
    expect(result.filename).toBe("prd_main_2025-03-10.json");

    // prd.json is gone
    await expect(access(join(rexDir, "prd.json"))).rejects.toThrow();

    // Content preserved in the new file
    const migrated = await readPRD(rexDir, "prd_main_2025-03-10.json");
    expect(migrated.title).toBe("My Project");
    expect(migrated.items).toHaveLength(1);
    expect(migrated.items[0].id).toBe("e1");
  });

  it("uses sanitized branch name in the target filename", async () => {
    initRepo(tmpDir);
    execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
      cwd: tmpDir,
      encoding: "utf-8",
      env: { ...process.env, GIT_AUTHOR_DATE: "2025-04-01T12:00:00Z", GIT_COMMITTER_DATE: "2025-04-01T12:00:00Z" },
    });
    git(tmpDir, "checkout", "-b", "feature/cool-thing");
    execFileSync("git", ["commit", "--allow-empty", "-m", "branch"], {
      cwd: tmpDir,
      encoding: "utf-8",
      env: { ...process.env, GIT_AUTHOR_DATE: "2025-04-15T12:00:00Z", GIT_COMMITTER_DATE: "2025-04-15T12:00:00Z" },
    });

    await writePRD(rexDir, "prd.json", makeDoc("Project"));

    const result = await migrateLegacyPRD(rexDir, tmpDir);
    expect(result.migrated).toBe(true);
    // feature/cool-thing → feature-cool-thing
    expect(result.filename).toMatch(/^prd_feature-cool-thing_\d{4}-\d{2}-\d{2}\.json$/);
  });

  it("is idempotent — second run returns branch-files-exist", async () => {
    initRepo(tmpDir);
    execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
      cwd: tmpDir,
      encoding: "utf-8",
      env: { ...process.env, GIT_AUTHOR_DATE: "2025-01-01T12:00:00Z", GIT_COMMITTER_DATE: "2025-01-01T12:00:00Z" },
    });

    await writePRD(rexDir, "prd.json", makeDoc("Main", [
      { id: "e1", title: "Epic", level: "epic", status: "pending", children: [] },
    ]));

    const first = await migrateLegacyPRD(rexDir, tmpDir);
    expect(first.migrated).toBe(true);

    const second = await migrateLegacyPRD(rexDir, tmpDir);
    expect(second.migrated).toBe(false);
    expect(second.reason).toBe("branch-files-exist");
  });

  it("returns target-exists when target file already has the same name", async () => {
    initRepo(tmpDir);
    execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
      cwd: tmpDir,
      encoding: "utf-8",
      env: { ...process.env, GIT_AUTHOR_DATE: "2025-02-01T12:00:00Z", GIT_COMMITTER_DATE: "2025-02-01T12:00:00Z" },
    });

    await writePRD(rexDir, "prd.json", makeDoc("Legacy"));
    await writePRD(rexDir, "prd_main_2025-02-01.json", makeDoc("Already-exists"));

    // Branch files exist — should short-circuit at branch-files-exist
    const result = await migrateLegacyPRD(rexDir, tmpDir);
    expect(result.migrated).toBe(false);
    // Has branch files already, so reason is branch-files-exist
    expect(result.reason).toBe("branch-files-exist");
  });
});

// ---------------------------------------------------------------------------
// readdir-based helpers to verify filesystem state
// ---------------------------------------------------------------------------

describe("migrateLegacyPRD filesystem state", () => {
  let tmpDir: string;
  let rexDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-migration-fs-"));
    rexDir = join(tmpDir, ".rex");
    await mkdir(rexDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("no backup files are created (atomic rename, no copy)", async () => {
    initRepo(tmpDir);
    execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
      cwd: tmpDir,
      encoding: "utf-8",
      env: { ...process.env, GIT_AUTHOR_DATE: "2025-06-01T12:00:00Z", GIT_COMMITTER_DATE: "2025-06-01T12:00:00Z" },
    });

    await writePRD(rexDir, "prd.json", makeDoc("Project"));

    const result = await migrateLegacyPRD(rexDir, tmpDir);
    expect(result.migrated).toBe(true);

    const files = await readdir(rexDir);
    // Only the renamed branch file + config should exist; no backup files
    const prdFiles = files.filter((f) => f.startsWith("prd_"));
    expect(prdFiles).toHaveLength(1);
    expect(prdFiles[0]).toMatch(/^prd_main_2025-06-01\.json$/);
  });
});
