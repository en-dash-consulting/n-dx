import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { FileStore, ensureRexDir } from "../../../src/store/file-adapter.js";
import { SCHEMA_VERSION } from "../../../src/schema/index.js";
import { toCanonicalJSON } from "../../../src/core/canonical.js";
import type { PRDDocument, PRDItem } from "../../../src/schema/index.js";

function makeDoc(title: string, items: PRDItem[]): PRDDocument {
  return { schema: SCHEMA_VERSION, title, items };
}

function makeItem(
  id: string,
  title: string,
  level: PRDItem["level"] = "epic",
): PRDItem {
  return { id, title, status: "pending", level };
}

function makeFeature(id: string, title: string): PRDItem {
  return { id, title, status: "pending", level: "feature" };
}

function makeTask(id: string, title: string): PRDItem {
  return { id, title, status: "pending", level: "task" };
}

async function readPRDFile(rexDir: string, filename: string): Promise<PRDDocument> {
  const raw = await readFile(join(rexDir, filename), "utf-8");
  return JSON.parse(raw) as PRDDocument;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function initRepo(dir: string): void {
  git(dir, "init", "--initial-branch=main");
  git(dir, "config", "user.email", "test@test.com");
  git(dir, "config", "user.name", "Test");
}

describe("PRDStore write routing", () => {
  let projectDir: string;
  let rexDir: string;
  let store: FileStore;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "rex-write-route-"));
    rexDir = join(projectDir, ".rex");
    await ensureRexDir(rexDir);
    store = new FileStore(rexDir);

    // Seed config (required for some operations)
    await writeFile(
      join(rexDir, "config.json"),
      toCanonicalJSON({
        schema: SCHEMA_VERSION,
        project: "test",
        adapter: "file",
      }),
      "utf-8",
    );
    await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
  });

  afterEach(async () => {
    await rm(rexDir, { recursive: true, force: true });
  });

  // ── Ownership map tracking ──────────────────────────────────────────────

  describe("item-to-file ownership tracking", () => {
    it("tracks item ownership after loadDocument with multiple files", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(makeDoc("Primary", [makeItem("e0", "Primary Epic")])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_feature-x_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Feature X", [makeItem("e1", "Feature Epic")])),
        "utf-8",
      );

      // loadDocument populates the ownership map
      await store.loadDocument();

      // updateItem should route to the correct file — this verifies ownership is tracked
      await store.updateItem("e1", { title: "Updated Feature Epic" });

      // Only the branch file should be modified
      const primary = await readPRDFile(rexDir, "prd.json");
      expect(primary.items[0].title).toBe("Primary Epic"); // untouched

      const branch = await readPRDFile(rexDir, "prd_feature-x_2025-01-01.json");
      expect(branch.items[0].title).toBe("Updated Feature Epic");
    });

    it("tracks nested item ownership", async () => {
      const epic: PRDItem = {
        ...makeItem("e1", "Epic"),
        children: [makeFeature("f1", "Feature")],
      };
      await writeFile(
        join(rexDir, "prd_branch_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Branch", [epic])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(makeDoc("Primary", [makeItem("e0", "Primary")])),
        "utf-8",
      );

      await store.loadDocument();

      // Update a nested item — should write to the branch file
      await store.updateItem("f1", { title: "Updated Feature" });

      const branch = await readPRDFile(rexDir, "prd_branch_2025-01-01.json");
      const feature = branch.items[0].children?.[0];
      expect(feature?.title).toBe("Updated Feature");

      // Primary untouched
      const primary = await readPRDFile(rexDir, "prd.json");
      expect(primary.items[0].title).toBe("Primary");
    });

    it("tracks ownership in single-file mode", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(makeDoc("Single", [makeItem("e0", "Epic")])),
        "utf-8",
      );

      await store.loadDocument();
      await store.updateItem("e0", { title: "Updated" });

      const doc = await readPRDFile(rexDir, "prd.json");
      expect(doc.items[0].title).toBe("Updated");
    });
  });

  // ── updateItem routing ────────────────────────────────────────────────

  describe("updateItem writes to owning file", () => {
    it("updates item in branch file without touching prd.json", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(makeDoc("Primary", [makeItem("e0", "Primary")])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_branch_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Branch", [makeItem("e1", "Branch")])),
        "utf-8",
      );

      await store.loadDocument();
      await store.updateItem("e1", { status: "in_progress" });

      const branch = await readPRDFile(rexDir, "prd_branch_2025-01-01.json");
      expect(branch.items[0].status).toBe("in_progress");

      const primary = await readPRDFile(rexDir, "prd.json");
      expect(primary.items[0].status).toBe("pending"); // untouched
    });

    it("updates item in prd.json without touching branch files", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(makeDoc("Primary", [makeItem("e0", "Primary")])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_branch_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Branch", [makeItem("e1", "Branch")])),
        "utf-8",
      );

      await store.loadDocument();
      await store.updateItem("e0", { status: "completed" });

      const primary = await readPRDFile(rexDir, "prd.json");
      expect(primary.items[0].status).toBe("completed");

      const branch = await readPRDFile(rexDir, "prd_branch_2025-01-01.json");
      expect(branch.items[0].status).toBe("pending"); // untouched
    });

    it("lazy-loads ownership on first updateItem (no prior loadDocument)", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(makeDoc("Primary", [makeItem("e0", "Primary")])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_branch_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Branch", [makeItem("e1", "Branch")])),
        "utf-8",
      );

      // No loadDocument call — resolveOwnerFile triggers it
      await store.updateItem("e1", { title: "Lazy Updated" });

      const branch = await readPRDFile(rexDir, "prd_branch_2025-01-01.json");
      expect(branch.items[0].title).toBe("Lazy Updated");
    });

    it("throws for nonexistent item", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(makeDoc("Primary", [makeItem("e0", "Epic")])),
        "utf-8",
      );

      await expect(
        store.updateItem("nonexistent", { title: "X" }),
      ).rejects.toThrow("not found");
    });
  });

  // ── addItem routing ───────────────────────────────────────────────────

  describe("addItem routes to correct file", () => {
    it("adds child to parent's owning file", async () => {
      const epic: PRDItem = makeItem("e1", "Branch Epic");
      await writeFile(
        join(rexDir, "prd_branch_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Branch", [epic])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(makeDoc("Primary", [makeItem("e0", "Primary")])),
        "utf-8",
      );

      await store.loadDocument();
      await store.addItem(makeFeature("f1", "New Feature"), "e1");

      // Feature added to branch file
      const branch = await readPRDFile(rexDir, "prd_branch_2025-01-01.json");
      expect(branch.items[0].children).toHaveLength(1);
      expect(branch.items[0].children![0].id).toBe("f1");

      // Primary untouched
      const primary = await readPRDFile(rexDir, "prd.json");
      expect(primary.items[0].children).toBeUndefined();
    });

    it("adds root item to currentBranchFile (default prd.json)", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(makeDoc("Primary", [])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_branch_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Branch", [makeItem("e1", "Branch")])),
        "utf-8",
      );

      await store.addItem(makeItem("e2", "New Epic"));

      const primary = await readPRDFile(rexDir, "prd.json");
      expect(primary.items).toHaveLength(1);
      expect(primary.items[0].id).toBe("e2");

      const branch = await readPRDFile(rexDir, "prd_branch_2025-01-01.json");
      expect(branch.items).toHaveLength(1); // untouched
    });

    it("adds root item to custom currentBranchFile", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(makeDoc("Primary", [makeItem("e0", "Primary")])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_feature-x_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Feature X", [])),
        "utf-8",
      );

      store.setCurrentBranchFile("prd_feature-x_2025-01-01.json");
      await store.addItem(makeItem("e2", "New Feature Epic"));

      const branch = await readPRDFile(rexDir, "prd_feature-x_2025-01-01.json");
      expect(branch.items).toHaveLength(1);
      expect(branch.items[0].id).toBe("e2");

      const primary = await readPRDFile(rexDir, "prd.json");
      expect(primary.items).toHaveLength(1);
      expect(primary.items[0].id).toBe("e0"); // untouched
    });

    it("constructor accepts currentBranchFile option", async () => {
      const customStore = new FileStore(rexDir, {
        currentBranchFile: "prd_feature-x_2025-01-01.json",
      });

      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(makeDoc("Primary", [])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_feature-x_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Feature X", [])),
        "utf-8",
      );

      await customStore.addItem(makeItem("e2", "New Epic"));

      const branch = await readPRDFile(rexDir, "prd_feature-x_2025-01-01.json");
      expect(branch.items).toHaveLength(1);
      expect(branch.items[0].id).toBe("e2");

      const primary = await readPRDFile(rexDir, "prd.json");
      expect(primary.items).toHaveLength(0); // untouched
    });

    it("updates ownership map after adding item", async () => {
      const epic: PRDItem = makeItem("e1", "Branch Epic");
      await writeFile(
        join(rexDir, "prd_branch_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Branch", [epic])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(makeDoc("Primary", [])),
        "utf-8",
      );

      await store.loadDocument();
      await store.addItem(makeFeature("f1", "Feature"), "e1");

      // Now add a task under the just-added feature — should still route to branch file
      await store.addItem(makeTask("t1", "Task"), "f1");

      const branch = await readPRDFile(rexDir, "prd_branch_2025-01-01.json");
      const feature = branch.items[0].children?.[0];
      expect(feature?.children).toHaveLength(1);
      expect(feature?.children![0].id).toBe("t1");
    });
  });

  // ── removeItem routing ────────────────────────────────────────────────

  describe("removeItem routes to correct file", () => {
    it("removes item from branch file without touching prd.json", async () => {
      const epic: PRDItem = {
        ...makeItem("e1", "Branch Epic"),
        children: [makeFeature("f1", "Feature")],
      };
      await writeFile(
        join(rexDir, "prd_branch_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Branch", [epic])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(makeDoc("Primary", [makeItem("e0", "Primary")])),
        "utf-8",
      );

      await store.loadDocument();
      await store.removeItem("f1");

      const branch = await readPRDFile(rexDir, "prd_branch_2025-01-01.json");
      expect(branch.items[0].children ?? []).toHaveLength(0);

      const primary = await readPRDFile(rexDir, "prd.json");
      expect(primary.items).toHaveLength(1); // untouched
    });

    it("cleans up ownership map after removal", async () => {
      const epic: PRDItem = {
        ...makeItem("e1", "Branch Epic"),
        children: [makeFeature("f1", "Feature")],
      };
      await writeFile(
        join(rexDir, "prd_branch_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Branch", [epic])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(makeDoc("Primary", [])),
        "utf-8",
      );

      await store.loadDocument();
      await store.removeItem("f1");

      // Removed item should no longer resolve
      await expect(
        store.updateItem("f1", { title: "Ghost" }),
      ).rejects.toThrow("not found");
    });

    it("throws for nonexistent item", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(makeDoc("Primary", [makeItem("e0", "Epic")])),
        "utf-8",
      );

      await expect(store.removeItem("nonexistent")).rejects.toThrow("not found");
    });
  });

  // ── saveDocument decomposition ────────────────────────────────────────

  describe("saveDocument decomposes to per-file documents", () => {
    it("writes items back to their owning files", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(makeDoc("Primary", [makeItem("e0", "Primary Epic")])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_branch_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Branch", [makeItem("e1", "Branch Epic")])),
        "utf-8",
      );

      // Load, mutate, save — the standard bulk pattern
      const doc = await store.loadDocument();
      doc.items[0].title = "Updated Primary";
      doc.items[1].title = "Updated Branch";
      await store.saveDocument(doc);

      const primary = await readPRDFile(rexDir, "prd.json");
      expect(primary.items).toHaveLength(1);
      expect(primary.items[0].title).toBe("Updated Primary");

      const branch = await readPRDFile(rexDir, "prd_branch_2025-01-01.json");
      expect(branch.items).toHaveLength(1);
      expect(branch.items[0].title).toBe("Updated Branch");
    });

    it("preserves per-file metadata (title, schema)", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(makeDoc("Primary Title", [makeItem("e0", "Epic")])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_branch_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Branch Title", [makeItem("e1", "Epic")])),
        "utf-8",
      );

      const doc = await store.loadDocument();
      await store.saveDocument(doc);

      const primary = await readPRDFile(rexDir, "prd.json");
      expect(primary.title).toBe("Primary Title");

      const branch = await readPRDFile(rexDir, "prd_branch_2025-01-01.json");
      expect(branch.title).toBe("Branch Title");
    });

    it("routes new root items to currentBranchFile", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(makeDoc("Primary", [makeItem("e0", "Primary")])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_branch_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Branch", [makeItem("e1", "Branch")])),
        "utf-8",
      );

      store.setCurrentBranchFile("prd_branch_2025-01-01.json");

      const doc = await store.loadDocument();
      doc.items.push(makeItem("e2", "New Epic"));
      await store.saveDocument(doc);

      const primary = await readPRDFile(rexDir, "prd.json");
      expect(primary.items).toHaveLength(1);
      expect(primary.items[0].id).toBe("e0");

      const branch = await readPRDFile(rexDir, "prd_branch_2025-01-01.json");
      expect(branch.items).toHaveLength(2);
      const ids = branch.items.map((i) => i.id).sort();
      expect(ids).toEqual(["e1", "e2"]);
    });

    it("writes empty items to files whose items were all removed", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(makeDoc("Primary", [makeItem("e0", "Primary")])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_branch_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Branch", [makeItem("e1", "Branch")])),
        "utf-8",
      );

      const doc = await store.loadDocument();
      // Remove the branch item
      doc.items = doc.items.filter((i) => i.id !== "e1");
      await store.saveDocument(doc);

      // Branch file should still exist but with empty items
      const branch = await readPRDFile(rexDir, "prd_branch_2025-01-01.json");
      expect(branch.items).toHaveLength(0);
      expect(branch.title).toBe("Branch");

      const primary = await readPRDFile(rexDir, "prd.json");
      expect(primary.items).toHaveLength(1);
    });

    it("falls back to single-file write when no ownership data", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(makeDoc("Primary", [])),
        "utf-8",
      );

      // Create a fresh store (no loadDocument call)
      const freshStore = new FileStore(rexDir);
      const doc = makeDoc("Direct", [makeItem("e0", "Direct Epic")]);
      await freshStore.saveDocument(doc);

      const primary = await readPRDFile(rexDir, "prd.json");
      expect(primary.items).toHaveLength(1);
      expect(primary.items[0].id).toBe("e0");
    });
  });

  // ── Per-file locking ──────────────────────────────────────────────────

  describe("per-file locking", () => {
    it("uses per-file lock paths", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(makeDoc("Primary", [makeItem("e0", "Primary")])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_branch_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Branch", [makeItem("e1", "Branch")])),
        "utf-8",
      );

      await store.loadDocument();

      // Concurrent updates to different files should not block each other
      // We verify this by running two updates in parallel
      await Promise.all([
        store.updateItem("e0", { title: "Updated Primary" }),
        store.updateItem("e1", { title: "Updated Branch" }),
      ]);

      const primary = await readPRDFile(rexDir, "prd.json");
      expect(primary.items[0].title).toBe("Updated Primary");

      const branch = await readPRDFile(rexDir, "prd_branch_2025-01-01.json");
      expect(branch.items[0].title).toBe("Updated Branch");
    });
  });

  // ── withTransaction with write routing ────────────────────────────────

  describe("withTransaction with write routing", () => {
    it("mutation via withTransaction decomposes back to files", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(makeDoc("Primary", [makeItem("e0", "Primary")])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_branch_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Branch", [makeItem("e1", "Branch")])),
        "utf-8",
      );

      await store.withTransaction(async (doc) => {
        // Mutate both items
        const e0 = doc.items.find((i) => i.id === "e0");
        const e1 = doc.items.find((i) => i.id === "e1");
        if (e0) e0.title = "Tx Primary";
        if (e1) e1.title = "Tx Branch";
      });

      const primary = await readPRDFile(rexDir, "prd.json");
      expect(primary.items[0].title).toBe("Tx Primary");

      const branch = await readPRDFile(rexDir, "prd_branch_2025-01-01.json");
      expect(branch.items[0].title).toBe("Tx Branch");
    });

    it("adding root item via withTransaction goes to currentBranchFile", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(makeDoc("Primary", [makeItem("e0", "Primary")])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_branch_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Branch", [])),
        "utf-8",
      );

      store.setCurrentBranchFile("prd_branch_2025-01-01.json");

      await store.withTransaction(async (doc) => {
        doc.items.push(makeItem("e2", "New Via Transaction"));
      });

      const primary = await readPRDFile(rexDir, "prd.json");
      expect(primary.items).toHaveLength(1);
      expect(primary.items[0].id).toBe("e0");

      const branch = await readPRDFile(rexDir, "prd_branch_2025-01-01.json");
      expect(branch.items).toHaveLength(1);
      expect(branch.items[0].id).toBe("e2");
    });
  });

  // ── MCP-like operations ───────────────────────────────────────────────

  describe("MCP write operations route correctly", () => {
    it("edit_item (updateItem) targets correct file", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(
          makeDoc("Primary", [makeItem("e0", "Primary")]),
        ),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_branch_2025-01-01.json"),
        toCanonicalJSON(
          makeDoc("Branch", [makeItem("e1", "Branch")]),
        ),
        "utf-8",
      );

      // Simulate MCP edit_item: load aggregated to find item, then update
      await store.updateItem("e1", { title: "Edited via MCP", description: "new desc" });

      const branch = await readPRDFile(rexDir, "prd_branch_2025-01-01.json");
      expect(branch.items[0].title).toBe("Edited via MCP");
      expect(branch.items[0].description).toBe("new desc");

      const primary = await readPRDFile(rexDir, "prd.json");
      expect(primary.items[0].title).toBe("Primary"); // untouched
    });

    it("move_item (saveDocument) routes items to owning files", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(makeDoc("Primary", [makeItem("e0", "Primary")])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_branch_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Branch", [makeItem("e1", "Branch")])),
        "utf-8",
      );

      // Simulate MCP move_item: load, mutate, save
      const doc = await store.loadDocument();
      // Just modify titles (actual move logic is in tree.ts)
      doc.items.find((i) => i.id === "e0")!.title = "Moved Primary";
      await store.saveDocument(doc);

      const primary = await readPRDFile(rexDir, "prd.json");
      expect(primary.items[0].title).toBe("Moved Primary");
      expect(primary.items).toHaveLength(1);

      const branch = await readPRDFile(rexDir, "prd_branch_2025-01-01.json");
      expect(branch.items).toHaveLength(1);
      expect(branch.items[0].id).toBe("e1"); // untouched
    });

    it("merge_items (saveDocument) decomposes correctly after merge", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(
          makeDoc("Primary", [
            makeItem("e0", "Primary Epic"),
          ]),
        ),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_branch_2025-01-01.json"),
        toCanonicalJSON(
          makeDoc("Branch", [
            makeItem("e1", "Branch Epic A"),
            makeItem("e2", "Branch Epic B"),
          ]),
        ),
        "utf-8",
      );

      // Simulate merge: load, remove one item, save
      const doc = await store.loadDocument();
      doc.items = doc.items.filter((i) => i.id !== "e2");
      await store.saveDocument(doc);

      const primary = await readPRDFile(rexDir, "prd.json");
      expect(primary.items).toHaveLength(1);
      expect(primary.items[0].id).toBe("e0");

      const branch = await readPRDFile(rexDir, "prd_branch_2025-01-01.json");
      expect(branch.items).toHaveLength(1);
      expect(branch.items[0].id).toBe("e1");
    });

    it("add_item (addItem) routes to parent file across branches", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(makeDoc("Primary", [makeItem("e0", "Primary")])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_branch_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Branch", [makeItem("e1", "Branch")])),
        "utf-8",
      );

      // Add feature under branch epic — should go to branch file
      await store.addItem(makeFeature("f1", "New Feature"), "e1");

      const branch = await readPRDFile(rexDir, "prd_branch_2025-01-01.json");
      expect(branch.items[0].children).toHaveLength(1);
      expect(branch.items[0].children![0].id).toBe("f1");

      // Add feature under primary epic — should go to primary file
      await store.addItem(makeFeature("f2", "Primary Feature"), "e0");

      const primary = await readPRDFile(rexDir, "prd.json");
      expect(primary.items[0].children).toHaveLength(1);
      expect(primary.items[0].children![0].id).toBe("f2");
    });
  });

  describe("write attribution", () => {
    it("stamps branch and markdown-equivalent sourceFile on attributed root adds", async () => {
      initRepo(projectDir);
      git(projectDir, "commit", "--allow-empty", "-m", "init");
      git(projectDir, "checkout", "-b", "feature/attrib");

      await writeFile(
        join(rexDir, "prd_feature-attrib_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Branch", [])),
        "utf-8",
      );

      store.setCurrentBranchFile("prd_feature-attrib_2025-01-01.json");
      await store.addItem(makeItem("e1", "Attributed Epic"), undefined, { applyAttribution: true });

      const branch = await readPRDFile(rexDir, "prd_feature-attrib_2025-01-01.json");
      expect(branch.items[0].branch).toBe("feature/attrib");
      expect(branch.items[0].sourceFile).toBe(".rex/prd_feature-attrib_2025-01-01.md");
    });

    it("stamps branch and owner sourceFile on attributed updates", async () => {
      initRepo(projectDir);
      git(projectDir, "commit", "--allow-empty", "-m", "init");
      git(projectDir, "checkout", "-b", "feature/attrib-update");

      await writeFile(
        join(rexDir, "prd_branch_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Branch", [makeItem("e1", "Branch Epic")])),
        "utf-8",
      );

      await store.updateItem("e1", { status: "in_progress" }, { applyAttribution: true });

      const branch = await readPRDFile(rexDir, "prd_branch_2025-01-01.json");
      expect(branch.items[0].branch).toBe("feature/attrib-update");
      expect(branch.items[0].sourceFile).toBe(".rex/prd_branch_2025-01-01.md");
    });

    it("omits branch when git is unavailable but still records sourceFile", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(makeDoc("Primary", [])),
        "utf-8",
      );

      await store.addItem(makeItem("e1", "No Git"), undefined, { applyAttribution: true });

      const primary = await readPRDFile(rexDir, "prd.json");
      expect(primary.items[0].branch).toBeUndefined();
      expect(primary.items[0].sourceFile).toBe(".rex/prd.md");
    });
  });

  // ── setCurrentBranchFile ──────────────────────────────────────────────

  describe("setCurrentBranchFile", () => {
    it("changes target for new root items", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(makeDoc("Primary", [])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_mybranch_2025-01-01.json"),
        toCanonicalJSON(makeDoc("My Branch", [])),
        "utf-8",
      );

      expect(store.getCurrentBranchFile()).toBe("prd.json");
      store.setCurrentBranchFile("prd_mybranch_2025-01-01.json");
      expect(store.getCurrentBranchFile()).toBe("prd_mybranch_2025-01-01.json");

      await store.addItem(makeItem("e1", "New Epic"));

      const branch = await readPRDFile(rexDir, "prd_mybranch_2025-01-01.json");
      expect(branch.items).toHaveLength(1);
      expect(branch.items[0].id).toBe("e1");

      const primary = await readPRDFile(rexDir, "prd.json");
      expect(primary.items).toHaveLength(0);
    });
  });
});
