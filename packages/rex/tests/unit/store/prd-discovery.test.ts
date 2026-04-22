import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  discoverPRDFiles,
  parsePRDBranchSegment,
  findPRDFileForBranch,
  resolvePRDFile,
} from "../../../src/store/prd-discovery.js";
import { SCHEMA_VERSION } from "../../../src/schema/v1.js";

// ---------------------------------------------------------------------------
// Pure-function tests (no filesystem)
// ---------------------------------------------------------------------------

describe("parsePRDBranchSegment", () => {
  it("extracts branch segment from standard filename", () => {
    expect(parsePRDBranchSegment("prd_main_2025-01-15.json")).toBe("main");
  });

  it("extracts multi-word branch segment", () => {
    expect(parsePRDBranchSegment("prd_feature-my-thing_2025-03-20.json")).toBe(
      "feature-my-thing",
    );
  });

  it("handles branch segments with underscores", () => {
    expect(parsePRDBranchSegment("prd_my_branch_2025-06-01.json")).toBe(
      "my_branch",
    );
  });

  it("handles branch segments with dots", () => {
    expect(parsePRDBranchSegment("prd_release-v1.2.3_2025-04-10.json")).toBe(
      "release-v1.2.3",
    );
  });

  it("handles short hash (detached HEAD)", () => {
    expect(parsePRDBranchSegment("prd_a1b2c3d_2025-05-10.json")).toBe(
      "a1b2c3d",
    );
  });

  it("returns null for non-matching filenames", () => {
    expect(parsePRDBranchSegment("prd.json")).toBeNull();
    expect(parsePRDBranchSegment("config.json")).toBeNull();
    expect(parsePRDBranchSegment("prd_no-date.json")).toBeNull();
    expect(parsePRDBranchSegment("prd_.json")).toBeNull();
  });

  it("returns null for filenames with invalid date format", () => {
    expect(parsePRDBranchSegment("prd_main_20250115.json")).toBeNull();
    expect(parsePRDBranchSegment("prd_main_2025-1-5.json")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Filesystem-dependent tests
// ---------------------------------------------------------------------------

describe("discoverPRDFiles", () => {
  let rexDir: string;

  beforeEach(async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "rex-discover-"));
    rexDir = join(tmpDir, ".rex");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(rexDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(join(rexDir, ".."), { recursive: true, force: true });
  });

  it("returns empty array when no prd_*.json files exist", async () => {
    const files = await discoverPRDFiles(rexDir);
    expect(files).toEqual([]);
  });

  it("discovers prd_*.json files", async () => {
    await writeFile(join(rexDir, "prd_main_2025-01-15.json"), "{}");
    await writeFile(join(rexDir, "prd_feature-x_2025-03-20.json"), "{}");

    const files = await discoverPRDFiles(rexDir);
    expect(files).toHaveLength(2);
    expect(files).toContain("prd_main_2025-01-15.json");
    expect(files).toContain("prd_feature-x_2025-03-20.json");
  });

  it("ignores prd.json (the legacy file)", async () => {
    await writeFile(join(rexDir, "prd.json"), "{}");
    await writeFile(join(rexDir, "prd_main_2025-01-15.json"), "{}");

    const files = await discoverPRDFiles(rexDir);
    expect(files).toEqual(["prd_main_2025-01-15.json"]);
  });

  it("ignores non-json files", async () => {
    await writeFile(join(rexDir, "prd_main_2025-01-15.json"), "{}");
    await writeFile(join(rexDir, "prd_main_2025-01-15.json.lock"), "");
    await writeFile(join(rexDir, "prd_main_2025-01-15.json.tmp"), "");

    const files = await discoverPRDFiles(rexDir);
    expect(files).toEqual(["prd_main_2025-01-15.json"]);
  });

  it("ignores config and other files", async () => {
    await writeFile(join(rexDir, "config.json"), "{}");
    await writeFile(join(rexDir, "execution-log.jsonl"), "");
    await writeFile(join(rexDir, "prd_develop_2025-02-01.json"), "{}");

    const files = await discoverPRDFiles(rexDir);
    expect(files).toEqual(["prd_develop_2025-02-01.json"]);
  });
});

describe("findPRDFileForBranch", () => {
  let rexDir: string;

  beforeEach(async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "rex-find-"));
    rexDir = join(tmpDir, ".rex");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(rexDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(join(rexDir, ".."), { recursive: true, force: true });
  });

  it("returns matching filename for exact branch match", async () => {
    await writeFile(join(rexDir, "prd_main_2025-01-15.json"), "{}");

    const result = await findPRDFileForBranch(rexDir, "main");
    expect(result).toBe("prd_main_2025-01-15.json");
  });

  it("matches after sanitizing the branch name", async () => {
    await writeFile(
      join(rexDir, "prd_feature-awesome_2025-03-20.json"),
      "{}",
    );

    // Raw branch name with slash — should match sanitized filename
    const result = await findPRDFileForBranch(rexDir, "feature/awesome");
    expect(result).toBe("prd_feature-awesome_2025-03-20.json");
  });

  it("returns null when no match exists", async () => {
    await writeFile(join(rexDir, "prd_main_2025-01-15.json"), "{}");

    const result = await findPRDFileForBranch(rexDir, "develop");
    expect(result).toBeNull();
  });

  it("returns null when directory is empty", async () => {
    const result = await findPRDFileForBranch(rexDir, "main");
    expect(result).toBeNull();
  });

  it("handles multiple PRD files for different branches", async () => {
    await writeFile(join(rexDir, "prd_main_2025-01-15.json"), "{}");
    await writeFile(join(rexDir, "prd_develop_2025-02-01.json"), "{}");
    await writeFile(
      join(rexDir, "prd_feature-x_2025-03-10.json"),
      "{}",
    );

    expect(await findPRDFileForBranch(rexDir, "main")).toBe(
      "prd_main_2025-01-15.json",
    );
    expect(await findPRDFileForBranch(rexDir, "develop")).toBe(
      "prd_develop_2025-02-01.json",
    );
    expect(await findPRDFileForBranch(rexDir, "feature/x")).toBe(
      "prd_feature-x_2025-03-10.json",
    );
  });

  it("returns first match when multiple files share a branch segment", async () => {
    // Edge case: same branch, different dates (shouldn't happen normally,
    // but discovery should handle it gracefully)
    await writeFile(join(rexDir, "prd_main_2025-01-15.json"), "{}");
    await writeFile(join(rexDir, "prd_main_2025-06-01.json"), "{}");

    const result = await findPRDFileForBranch(rexDir, "main");
    expect(result).not.toBeNull();
    expect(result).toMatch(/^prd_main_\d{4}-\d{2}-\d{2}\.json$/);
  });
});

// ---------------------------------------------------------------------------
// Git-dependent integration tests
// ---------------------------------------------------------------------------

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function initRepo(dir: string): void {
  git(dir, "init", "--initial-branch=main");
  git(dir, "config", "user.email", "test@test.com");
  git(dir, "config", "user.name", "Test");
}

describe("resolvePRDFile", () => {
  let tmpDir: string;
  let rexDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-resolve-prd-"));
    rexDir = join(tmpDir, ".rex");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(rexDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns existing file path when a match exists", async () => {
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

    // Pre-create the expected file
    const existingFile = "prd_main_2025-01-15.json";
    const doc = { schema: SCHEMA_VERSION, title: "Existing", items: [] };
    await writeFile(join(rexDir, existingFile), JSON.stringify(doc));

    const result = await resolvePRDFile(rexDir, tmpDir);
    expect(result.filename).toBe(existingFile);
    expect(result.created).toBe(false);
    expect(result.path).toBe(join(rexDir, existingFile));
  });

  it("creates a new empty PRD file when no match exists", async () => {
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

    const result = await resolvePRDFile(rexDir, tmpDir);
    expect(result.filename).toBe("prd_main_2025-06-01.json");
    expect(result.created).toBe(true);
    expect(result.path).toBe(join(rexDir, "prd_main_2025-06-01.json"));

    // Verify the file was actually written with valid content
    const raw = await readFile(result.path, "utf-8");
    const doc = JSON.parse(raw);
    expect(doc.schema).toBe(SCHEMA_VERSION);
    expect(doc.title).toBe("main");
    expect(doc.items).toEqual([]);
  });

  it("does not overwrite existing files for other branches", async () => {
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

    // Create a PRD for a different branch
    const otherDoc = {
      schema: SCHEMA_VERSION,
      title: "Other Branch",
      items: [{ id: "keep-me", title: "Important", level: "epic", status: "in_progress", children: [] }],
    };
    await writeFile(
      join(rexDir, "prd_develop_2025-02-01.json"),
      JSON.stringify(otherDoc),
    );

    // Now resolve for main — should create a new file, not touch develop's
    const result = await resolvePRDFile(rexDir, tmpDir);
    expect(result.created).toBe(true);
    expect(result.filename).toBe("prd_main_2025-01-15.json");

    // Verify the other branch file is untouched
    const otherRaw = await readFile(
      join(rexDir, "prd_develop_2025-02-01.json"),
      "utf-8",
    );
    const otherParsed = JSON.parse(otherRaw);
    expect(otherParsed.title).toBe("Other Branch");
    expect(otherParsed.items).toHaveLength(1);
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

    const result = await resolvePRDFile(rexDir, tmpDir);
    expect(result.filename).toBe("prd_feature-cool-thing_2025-04-01.json");
    expect(result.created).toBe(true);

    // Resolve again — should find the existing file
    const second = await resolvePRDFile(rexDir, tmpDir);
    expect(second.filename).toBe("prd_feature-cool-thing_2025-04-01.json");
    expect(second.created).toBe(false);
  });

  it("uses branch name as title for newly created PRD files", async () => {
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

    git(tmpDir, "checkout", "-b", "feature/awesome-thing");
    execFileSync("git", ["commit", "--allow-empty", "-m", "work"], {
      cwd: tmpDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2025-05-10T12:00:00Z",
        GIT_COMMITTER_DATE: "2025-05-10T12:00:00Z",
      },
    });

    const result = await resolvePRDFile(rexDir, tmpDir);
    const raw = await readFile(result.path, "utf-8");
    const doc = JSON.parse(raw);
    expect(doc.title).toBe("feature/awesome-thing");
  });

  it("concurrent PRD files coexist without interference", async () => {
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

    // Pre-create PRD files for multiple branches
    for (const branch of ["main", "develop", "feature-x"]) {
      const doc = { schema: SCHEMA_VERSION, title: branch, items: [] };
      await writeFile(
        join(rexDir, `prd_${branch}_2025-01-15.json`),
        JSON.stringify(doc),
      );
    }

    // Verify all three files still exist after resolving for main
    const result = await resolvePRDFile(rexDir, tmpDir);
    expect(result.filename).toBe("prd_main_2025-01-15.json");

    const allFiles = await readdir(rexDir);
    const prdFiles = allFiles.filter((f) => f.startsWith("prd_"));
    expect(prdFiles).toHaveLength(3);
  });
});
