import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, readdir, access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { migrateLegacyPRD } from "../../../src/store/prd-migration.js";
import { resolveStore, PRD_FILENAME } from "../../../src/store/index.js";
import { cmdInit } from "../../../src/cli/commands/init.js";
import { SCHEMA_VERSION } from "../../../src/schema/v1.js";
import { toCanonicalJSON } from "../../../src/core/canonical.js";
import type { PRDDocument } from "../../../src/schema/v1.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// migrateLegacyPRD — consolidation of branch-scoped files
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

  it("is a no-op when only prd.json exists", async () => {
    await writePRD(rexDir, PRD_FILENAME, makeDoc("Project"));

    const result = await migrateLegacyPRD(rexDir);
    expect(result.migrated).toBe(false);
    expect(result.reason).toBe("no-branch-files");

    // prd.json is untouched
    const doc = await readPRD(rexDir, PRD_FILENAME);
    expect(doc.title).toBe("Project");
  });

  it("is a no-op on empty rex directory", async () => {
    const result = await migrateLegacyPRD(rexDir);
    expect(result.migrated).toBe(false);
    expect(result.reason).toBe("no-branch-files");
  });

  it("consolidates a single branch file into prd.json", async () => {
    const branchDoc = makeDoc("Feature Work", [
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
    await writePRD(rexDir, "prd_feature-x_2025-04-01.json", branchDoc);

    const result = await migrateLegacyPRD(rexDir);
    expect(result.migrated).toBe(true);
    expect(result.mergedFiles).toEqual(["prd_feature-x_2025-04-01.json"]);
    expect(result.backupFilenames).toHaveLength(1);
    expect(result.backupFilenames![0]).toMatch(
      /^prd_feature-x_2025-04-01\.json\.backup\.\d{4}-\d{2}-\d{2}T/,
    );

    // The canonical prd.json now holds the merged content
    const doc = await readPRD(rexDir, PRD_FILENAME);
    expect(doc.title).toBe("Feature Work");
    expect(doc.items).toHaveLength(1);
    expect(doc.items[0].id).toBe("e1");
    expect(doc.items[0].children![0].id).toBe("f1");

    // Original branch file is gone but backup is readable with identical content
    await expect(access(join(rexDir, "prd_feature-x_2025-04-01.json"))).rejects.toThrow();
    const backup = await readPRD(rexDir, result.backupFilenames![0]);
    expect(backup).toEqual(branchDoc);
  });

  it("merges multiple branch files with existing prd.json — round-trip preserves all items and metadata", async () => {
    const legacy = makeDoc("Canonical Title", [
      {
        id: "legacy-epic",
        title: "Legacy Epic",
        level: "epic",
        status: "completed",
        priority: "high",
        description: "already on main",
        tags: ["v1", "core"],
        children: [
          {
            id: "legacy-task",
            title: "Legacy Task",
            level: "task",
            status: "completed",
            acceptanceCriteria: ["does the thing"],
            blockedBy: [],
            children: [],
          },
        ],
      },
    ]);
    const branchA = makeDoc("Branch A Title", [
      {
        id: "branch-a-epic",
        title: "Branch A Epic",
        level: "epic",
        status: "in_progress",
        children: [
          {
            id: "branch-a-feature",
            title: "Branch A Feature",
            level: "feature",
            status: "pending",
            description: "feature from branch A",
            children: [],
          },
        ],
      },
    ]);
    const branchB = makeDoc("Branch B Title", [
      {
        id: "branch-b-epic",
        title: "Branch B Epic",
        level: "epic",
        status: "pending",
        children: [
          {
            id: "branch-b-task",
            title: "Branch B Task",
            level: "task",
            status: "pending",
            priority: "medium",
            blockedBy: ["legacy-task"],
            children: [
              {
                id: "branch-b-sub",
                title: "Branch B Subtask",
                level: "subtask",
                status: "pending",
                children: [],
              },
            ],
          },
        ],
      },
    ]);

    await writePRD(rexDir, PRD_FILENAME, legacy);
    await writePRD(rexDir, "prd_feature-a_2025-04-01.json", branchA);
    await writePRD(rexDir, "prd_feature-b_2025-04-15.json", branchB);

    const result = await migrateLegacyPRD(rexDir);
    expect(result.migrated).toBe(true);
    expect(result.mergedFiles?.sort()).toEqual([
      "prd_feature-a_2025-04-01.json",
      "prd_feature-b_2025-04-15.json",
    ]);

    const merged = await readPRD(rexDir, PRD_FILENAME);

    // Legacy prd.json's title wins (it was the first source)
    expect(merged.title).toBe("Canonical Title");
    expect(merged.schema).toBe(SCHEMA_VERSION);

    // All root items are present, in source order
    expect(merged.items.map((i) => i.id)).toEqual([
      "legacy-epic",
      "branch-a-epic",
      "branch-b-epic",
    ]);

    // Nested items and all metadata survive the round trip
    const legacyEpic = merged.items[0];
    expect(legacyEpic.priority).toBe("high");
    expect(legacyEpic.tags).toEqual(["v1", "core"]);
    expect(legacyEpic.children?.[0].acceptanceCriteria).toEqual(["does the thing"]);

    const branchBTask = merged.items[2].children?.[0];
    expect(branchBTask?.blockedBy).toEqual(["legacy-task"]);
    expect(branchBTask?.children?.[0].id).toBe("branch-b-sub");

    // Original branch files are removed
    await expect(access(join(rexDir, "prd_feature-a_2025-04-01.json"))).rejects.toThrow();
    await expect(access(join(rexDir, "prd_feature-b_2025-04-15.json"))).rejects.toThrow();

    // Backups preserve the exact original bytes
    const backups = (await readdir(rexDir)).filter((f) => f.includes(".backup."));
    expect(backups).toHaveLength(2);
    const backupByOrigin = new Map<string, PRDDocument>();
    for (const backup of backups) {
      const doc = await readPRD(rexDir, backup);
      const origin = backup.replace(/\.backup\..*$/, "");
      backupByOrigin.set(origin, doc);
    }
    expect(backupByOrigin.get("prd_feature-a_2025-04-01.json")).toEqual(branchA);
    expect(backupByOrigin.get("prd_feature-b_2025-04-15.json")).toEqual(branchB);
  });

  it("throws on cross-file ID collisions without touching data", async () => {
    const legacy = makeDoc("Legacy", [
      { id: "dup", title: "Legacy Dup", level: "epic", status: "pending", children: [] },
    ]);
    const branch = makeDoc("Branch", [
      { id: "dup", title: "Branch Dup", level: "epic", status: "pending", children: [] },
    ]);
    await writePRD(rexDir, PRD_FILENAME, legacy);
    await writePRD(rexDir, "prd_feature-x_2025-05-01.json", branch);

    await expect(migrateLegacyPRD(rexDir)).rejects.toThrow(/ID collision/);

    // Nothing was renamed or rewritten
    const stillLegacy = await readPRD(rexDir, PRD_FILENAME);
    expect(stillLegacy).toEqual(legacy);
    const stillBranch = await readPRD(rexDir, "prd_feature-x_2025-05-01.json");
    expect(stillBranch).toEqual(branch);
  });

  it("is idempotent — second run is a no-op once only prd.json remains", async () => {
    await writePRD(rexDir, PRD_FILENAME, makeDoc("Main"));
    await writePRD(
      rexDir,
      "prd_feature-x_2025-04-01.json",
      makeDoc("Feature", [
        { id: "e1", title: "Epic", level: "epic", status: "pending", children: [] },
      ]),
    );

    const first = await migrateLegacyPRD(rexDir);
    expect(first.migrated).toBe(true);

    const second = await migrateLegacyPRD(rexDir);
    expect(second.migrated).toBe(false);
    expect(second.reason).toBe("no-branch-files");
  });
});

// ---------------------------------------------------------------------------
// resolveStore integration — verifies resolveStore triggers consolidation
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

  it("auto-consolidates branch files into prd.json on first resolve", async () => {
    await writePRD(
      rexDir,
      "prd_feature-x_2025-04-01.json",
      makeDoc("Feature Work", [
        { id: "e1", title: "Epic", level: "epic", status: "pending", children: [] },
      ]),
    );

    const store = await resolveStore(rexDir);
    const doc = await store.loadDocument();
    expect(doc.title).toBe("Feature Work");
    expect(doc.items).toHaveLength(1);

    // Branch file is gone; prd.json now holds the data
    await expect(access(join(rexDir, "prd_feature-x_2025-04-01.json"))).rejects.toThrow();
    const files = await readdir(rexDir);
    expect(files).toContain(PRD_FILENAME);
  });

  it("routes new root items to prd.json after migration", async () => {
    await writePRD(
      rexDir,
      "prd_feature-x_2025-04-01.json",
      makeDoc("Feature", []),
    );

    const store = await resolveStore(rexDir);
    await store.loadDocument();

    await store.addItem({
      id: "new-epic",
      title: "New Epic",
      level: "epic",
      status: "pending",
      children: [],
    });

    const reloaded = await readPRD(rexDir, PRD_FILENAME);
    expect(reloaded.items.some((i) => i.id === "new-epic")).toBe(true);
  });

  it("is a no-op when only prd.json already exists", async () => {
    await writePRD(rexDir, PRD_FILENAME, makeDoc("Project", [
      { id: "e1", title: "Epic", level: "epic", status: "pending", children: [] },
    ]));

    const store = await resolveStore(rexDir);
    const doc = await store.loadDocument();
    expect(doc.items).toHaveLength(1);

    // No backup files created
    const files = await readdir(rexDir);
    expect(files.filter((f) => f.includes(".backup."))).toHaveLength(0);
  });

  it("migration is idempotent across multiple resolveStore calls", async () => {
    await writePRD(rexDir, "prd_main_2025-03-10.json", makeDoc("Project", [
      { id: "e1", title: "Epic", level: "epic", status: "pending", children: [] },
    ]));

    const s1 = await resolveStore(rexDir);
    const s2 = await resolveStore(rexDir);
    const s3 = await resolveStore(rexDir);

    expect((await s1.loadDocument()).items).toHaveLength(1);
    expect((await s2.loadDocument()).items).toHaveLength(1);
    expect((await s3.loadDocument()).items).toHaveLength(1);

    // Only one backup was created (from the initial consolidation)
    const files = await readdir(rexDir);
    expect(files.filter((f) => f.includes(".backup."))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// cmdInit always creates prd.json
// ---------------------------------------------------------------------------

describe("cmdInit", () => {
  let tmpDir: string;
  let rexDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-init-"));
    rexDir = join(tmpDir, ".rex");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates prd.json (not branch-scoped) in a fresh rex dir", async () => {
    await cmdInit(tmpDir, {});

    const files = await readdir(rexDir);
    expect(files).toContain(PRD_FILENAME);
    // No branch-scoped files should be produced by init anymore
    expect(files.filter((f) => /^prd_.+_\d{4}-\d{2}-\d{2}\.json$/.test(f))).toHaveLength(0);

    const doc = await readPRD(rexDir, PRD_FILENAME);
    expect(doc.schema).toBe(SCHEMA_VERSION);
    expect(doc.items).toEqual([]);
  });

  it("skips PRD creation when prd.json already exists", async () => {
    await mkdir(rexDir, { recursive: true });
    await writePRD(rexDir, PRD_FILENAME, makeDoc("Existing"));

    await cmdInit(tmpDir, {});

    const doc = await readPRD(rexDir, PRD_FILENAME);
    expect(doc.title).toBe("Existing");
  });
});
