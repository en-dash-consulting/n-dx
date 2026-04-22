/**
 * Integration tests: branch-scoped PRD file targeting for add operations.
 *
 * Verifies that cmdAdd, acceptProposals, and the approval flow display
 * correctly route writes to the current branch's prd_{branch}_{date}.json file.
 *
 * Uses real git repos in temp directories so resolveGitBranch returns actual
 * branch names (not "unknown").
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { FileStore, ensureRexDir, resolveStore, resolvePRDFile } from "../../src/store/index.js";
import { SCHEMA_VERSION } from "../../src/schema/index.js";
import { toCanonicalJSON } from "../../src/core/canonical.js";
import { cmdAdd } from "../../src/cli/commands/add.js";
import type { PRDDocument, PRDItem } from "../../src/schema/index.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeDoc(title: string, items: PRDItem[]): PRDDocument {
  return { schema: SCHEMA_VERSION, title, items };
}

function makeEpic(id: string, title: string, children?: PRDItem[]): PRDItem {
  return { id, title, status: "pending", level: "epic", ...(children ? { children } : {}) };
}

function makeFeature(id: string, title: string, children?: PRDItem[]): PRDItem {
  return { id, title, status: "pending", level: "feature", ...(children ? { children } : {}) };
}

function makeTask(id: string, title: string): PRDItem {
  return { id, title, status: "pending", level: "task" };
}

/** Initialize a bare git repo in the given directory, on a given branch. */
function initGitRepo(dir: string, branch = "main"): void {
  execFileSync("git", ["init", "-b", branch], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir, stdio: "pipe" });
  // Create an initial commit so HEAD exists
  execFileSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: dir, stdio: "pipe" });
}

/** Switch to a new branch in the given repo. */
function checkoutBranch(dir: string, branch: string): void {
  execFileSync("git", ["checkout", "-b", branch], { cwd: dir, stdio: "pipe" });
  // Create a commit so the branch divergence date is deterministic
  execFileSync("git", ["commit", "--allow-empty", "-m", `start ${branch}`], { cwd: dir, stdio: "pipe" });
}

async function readPRDFile(path: string): Promise<PRDDocument> {
  return JSON.parse(await readFile(path, "utf-8")) as PRDDocument;
}

/** List all prd_*.json files in the .rex directory. */
async function listPRDFiles(rexDir: string): Promise<string[]> {
  const entries = await readdir(rexDir);
  return entries.filter((f) => /^prd_.*\.json$/.test(f)).sort();
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Branch-scoped add targeting", () => {
  let tmpDir: string;
  let rexDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-branch-add-"));
    rexDir = join(tmpDir, ".rex");
    await ensureRexDir(rexDir);

    await writeFile(
      join(rexDir, "config.json"),
      toCanonicalJSON({ schema: SCHEMA_VERSION, project: "test", adapter: "file" }),
      "utf-8",
    );
    await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("resolveStore branch file lookup", () => {
    it("sets currentBranchFile from existing branch file", async () => {
      initGitRepo(tmpDir, "main");

      // Seed a branch-scoped file for main
      const branchFile = "prd_main_2026-01-01.json";
      await writeFile(
        join(rexDir, branchFile),
        toCanonicalJSON(makeDoc("Main", [makeEpic("e1", "Existing")])),
        "utf-8",
      );

      const store = await resolveStore(rexDir);
      expect(store).toBeInstanceOf(FileStore);
      expect((store as FileStore).getCurrentBranchFile()).toBe(branchFile);
    });

    it("leaves currentBranchFile as prd.json when no branch file matches", async () => {
      initGitRepo(tmpDir, "main");

      // Seed a branch-scoped file for a DIFFERENT branch
      await writeFile(
        join(rexDir, "prd_other-branch_2026-01-01.json"),
        toCanonicalJSON(makeDoc("Other", [])),
        "utf-8",
      );

      const store = await resolveStore(rexDir);
      expect(store).toBeInstanceOf(FileStore);
      // No match for "main" → stays at default
      expect((store as FileStore).getCurrentBranchFile()).toBe("prd.json");
    });
  });

  describe("cmdAdd branch targeting", () => {
    it("creates items in the current branch's PRD file", async () => {
      initGitRepo(tmpDir, "main");
      checkoutBranch(tmpDir, "feature/auth");

      // Seed a legacy prd.json (will be migrated on first resolveStore)
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(makeDoc("Project", [])),
        "utf-8",
      );

      await cmdAdd(tmpDir, "epic", { title: "New Auth Epic" });

      // After migration + add, the item should be in a branch-scoped file
      const branchFiles = await listPRDFiles(rexDir);
      expect(branchFiles.length).toBeGreaterThanOrEqual(1);

      // Find the feature-auth file
      const authFile = branchFiles.find((f) => f.includes("feature-auth"));
      expect(authFile).toBeDefined();

      const doc = await readPRDFile(join(rexDir, authFile!));
      const epicTitles = doc.items.map((i) => i.title);
      expect(epicTitles).toContain("New Auth Epic");
    });

    it("creates branch file when adding to a new branch", async () => {
      initGitRepo(tmpDir, "main");

      // Seed main's file
      const mainFile = "prd_main_2026-01-01.json";
      await writeFile(
        join(rexDir, mainFile),
        toCanonicalJSON(makeDoc("Main", [makeEpic("e1", "Existing")])),
        "utf-8",
      );

      // Switch to a new branch
      checkoutBranch(tmpDir, "feature/search");

      await cmdAdd(tmpDir, "epic", { title: "Search Epic" });

      // A new branch file should have been created
      const branchFiles = await listPRDFiles(rexDir);
      const searchFile = branchFiles.find((f) => f.includes("feature-search"));
      expect(searchFile).toBeDefined();

      const doc = await readPRDFile(join(rexDir, searchFile!));
      const epicTitles = doc.items.map((i) => i.title);
      expect(epicTitles).toContain("Search Epic");

      // Main file should be untouched
      const mainDoc = await readPRDFile(join(rexDir, mainFile));
      expect(mainDoc.items).toHaveLength(1);
      expect(mainDoc.items[0].title).toBe("Existing");
    });

    it("adds child items to the parent's owning file, not the branch file", async () => {
      initGitRepo(tmpDir, "main");

      // Seed main's file with an epic
      const mainFile = "prd_main_2026-01-01.json";
      await writeFile(
        join(rexDir, mainFile),
        toCanonicalJSON(makeDoc("Main", [makeEpic("e1", "Existing Epic")])),
        "utf-8",
      );

      // Switch to feature branch
      checkoutBranch(tmpDir, "feature/detail");

      // Add a feature under the main-branch epic
      await cmdAdd(tmpDir, "feature", { title: "Detail Feature", parent: "e1" });

      // The feature should go into the main file (parent's owning file)
      const mainDoc = await readPRDFile(join(rexDir, mainFile));
      const epic = mainDoc.items.find((i) => i.id === "e1");
      expect(epic).toBeDefined();
      expect(epic!.children).toBeDefined();
      const featureTitles = epic!.children!.map((c) => c.title);
      expect(featureTitles).toContain("Detail Feature");
    });
  });

  describe("resolveStore + addItem branch targeting", () => {
    it("routes new root items to the branch file via resolveStore", async () => {
      initGitRepo(tmpDir, "main");
      checkoutBranch(tmpDir, "feature/dashboard");

      // Seed main's file
      await writeFile(
        join(rexDir, "prd_main_2026-01-01.json"),
        toCanonicalJSON(makeDoc("Main", [])),
        "utf-8",
      );

      // resolveStore finds no match for "feature/dashboard" → currentBranchFile stays "prd.json"
      // Then resolvePRDFile creates the branch file and sets it
      const store = (await resolveStore(rexDir)) as FileStore;
      const resolution = await resolvePRDFile(rexDir, tmpDir);
      store.setCurrentBranchFile(resolution.filename);

      // Load document so ownership map is populated
      await store.loadDocument();

      // Add a root-level epic — should go to the dashboard branch file
      await store.addItem({
        id: "e-dash",
        title: "Dashboard Epic",
        level: "epic",
        status: "pending",
      });

      // Verify the item is in the branch file
      const branchFiles = await listPRDFiles(rexDir);
      const dashFile = branchFiles.find((f) => f.includes("feature-dashboard"));
      expect(dashFile).toBeDefined();

      const doc = await readPRDFile(join(rexDir, dashFile!));
      const epicIds = doc.items.map((i) => i.id);
      expect(epicIds).toContain("e-dash");

      // Main file should be untouched
      const mainDoc = await readPRDFile(join(rexDir, "prd_main_2026-01-01.json"));
      expect(mainDoc.items).toHaveLength(0);
    });

    it("routes new root items to main branch file when on main", async () => {
      initGitRepo(tmpDir, "main");

      // Seed main's file
      const mainFile = "prd_main_2026-01-01.json";
      await writeFile(
        join(rexDir, mainFile),
        toCanonicalJSON(makeDoc("Main", [makeEpic("e1", "Existing")])),
        "utf-8",
      );

      const store = (await resolveStore(rexDir)) as FileStore;
      // resolveStore should have found the main file
      expect(store.getCurrentBranchFile()).toBe(mainFile);

      await store.loadDocument();
      await store.addItem({
        id: "e2",
        title: "New Epic",
        level: "epic",
        status: "pending",
      });

      const doc = await readPRDFile(join(rexDir, mainFile));
      expect(doc.items).toHaveLength(2);
      const ids = doc.items.map((i) => i.id);
      expect(ids).toContain("e1");
      expect(ids).toContain("e2");
    });
  });

  describe("resolvePRDFile targeting", () => {
    it("returns existing file for matching branch", async () => {
      initGitRepo(tmpDir, "main");

      const mainFile = "prd_main_2026-01-01.json";
      await writeFile(
        join(rexDir, mainFile),
        toCanonicalJSON(makeDoc("Main", [])),
        "utf-8",
      );

      const resolution = await resolvePRDFile(rexDir, tmpDir);
      expect(resolution.filename).toBe(mainFile);
      expect(resolution.created).toBe(false);
    });

    it("creates new file for unmatched branch", async () => {
      initGitRepo(tmpDir, "main");
      checkoutBranch(tmpDir, "feature/new");

      // Only main's file exists
      await writeFile(
        join(rexDir, "prd_main_2026-01-01.json"),
        toCanonicalJSON(makeDoc("Main", [])),
        "utf-8",
      );

      const resolution = await resolvePRDFile(rexDir, tmpDir);
      expect(resolution.filename).toContain("feature-new");
      expect(resolution.created).toBe(true);

      // File should exist and be a valid empty PRD
      const doc = await readPRDFile(resolution.path);
      expect(doc.items).toHaveLength(0);
      expect(doc.schema).toBe(SCHEMA_VERSION);
    });
  });
});
