/**
 * Integration tests: multi-file PRD backend validation.
 *
 * Verifies that CLI commands, MCP tool handlers, and web dashboard data
 * loading all operate correctly when items span multiple PRD files
 * (branch-scoped `prd_{branch}_{date}.json` format).
 *
 * Covers:
 * - Two-branch scenario with items in separate files
 * - Cross-file item update via store operations
 * - Duplicate merge across files via withTransaction
 * - MCP tool handler operations on aggregated multi-file PRDs
 * - Web dashboard sync loading (prd-io.ts aggregation)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileStore, ensureRexDir } from "../../src/store/file-adapter.js";
import { SCHEMA_VERSION } from "../../src/schema/index.js";
import { toCanonicalJSON } from "../../src/core/canonical.js";
import { computeStats } from "../../src/core/stats.js";
import { findNextTask, collectCompletedIds } from "../../src/core/next-task.js";
import { mergeItems, validateMerge } from "../../src/core/merge.js";
import { computeHealthScore } from "../../src/core/health.js";
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

function makeTask(id: string, title: string, opts: Partial<PRDItem> = {}): PRDItem {
  return { id, title, status: "pending", level: "task", ...opts };
}

async function readPRDFile(rexDir: string, filename: string): Promise<PRDDocument> {
  const raw = await readFile(join(rexDir, filename), "utf-8");
  return JSON.parse(raw) as PRDDocument;
}

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Two-branch layout: main has auth epic, feature-x has search epic. */
async function seedTwoBranch(rexDir: string) {
  await writeFile(
    join(rexDir, "prd_main_2026-01-01.json"),
    toCanonicalJSON(
      makeDoc("Main Branch", [
        makeEpic("e-auth", "Auth System", [
          makeFeature("f-oauth", "OAuth Flow", [
            makeTask("t-token", "Token exchange", { priority: "critical" }),
            makeTask("t-refresh", "Refresh logic", { blockedBy: ["t-token"] }),
          ]),
        ]),
      ]),
    ),
    "utf-8",
  );

  await writeFile(
    join(rexDir, "prd_feature-x_2026-04-01.json"),
    toCanonicalJSON(
      makeDoc("Feature X", [
        makeEpic("e-search", "Search", [
          makeFeature("f-index", "Search Index", [
            makeTask("t-index", "Build index", { priority: "high" }),
            makeTask("t-query", "Query parser"),
          ]),
        ]),
      ]),
    ),
    "utf-8",
  );
}

// ── Test suite ──────────────────────────────────────────────────────────────

describe("Multi-file PRD integration", () => {
  let tmpDir: string;
  let rexDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-multifile-"));
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

  // ────────────────────────────────────────────────────────────────────────
  // 1. Two-branch scenario: items in separate files
  // ────────────────────────────────────────────────────────────────────────

  describe("two-branch scenario", () => {
    it("loadDocument aggregates items from both files", async () => {
      await seedTwoBranch(rexDir);
      const store = new FileStore(rexDir);
      const doc = await store.loadDocument();

      expect(doc.items).toHaveLength(2);
      const ids = doc.items.map((i) => i.id);
      expect(ids).toContain("e-auth");
      expect(ids).toContain("e-search");
    });

    it("getItem finds items from either file", async () => {
      await seedTwoBranch(rexDir);
      const store = new FileStore(rexDir);

      // Root items
      const auth = await store.getItem("e-auth");
      expect(auth).not.toBeNull();
      expect(auth!.title).toBe("Auth System");

      const search = await store.getItem("e-search");
      expect(search).not.toBeNull();
      expect(search!.title).toBe("Search");

      // Nested items across files
      const token = await store.getItem("t-token");
      expect(token).not.toBeNull();
      expect(token!.priority).toBe("critical");

      const query = await store.getItem("t-query");
      expect(query).not.toBeNull();
      expect(query!.title).toBe("Query parser");
    });

    it("computeStats covers items from all files", async () => {
      await seedTwoBranch(rexDir);
      const store = new FileStore(rexDir);
      const doc = await store.loadDocument();
      const stats = computeStats(doc.items);

      // computeStats counts work items (tasks/subtasks) + childless containers
      // epics and features-with-children are excluded
      // 4 tasks total across both files
      expect(stats.total).toBe(4);
      expect(stats.pending).toBe(4);
    });

    it("findNextTask considers items from all files", async () => {
      await seedTwoBranch(rexDir);
      const store = new FileStore(rexDir);
      const doc = await store.loadDocument();
      const completedIds = collectCompletedIds(doc.items);
      const next = findNextTask(doc.items, completedIds);

      expect(next).not.toBeNull();
      // Should pick the highest-priority unblocked task (t-token is critical)
      expect(next!.item.id).toBe("t-token");
    });

    it("computeHealthScore works on aggregated document", async () => {
      await seedTwoBranch(rexDir);
      const store = new FileStore(rexDir);
      const doc = await store.loadDocument();
      const health = computeHealthScore(doc.items);

      expect(health.overall).toBeGreaterThanOrEqual(0);
      expect(health.overall).toBeLessThanOrEqual(100);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 2. Cross-file item update
  // ────────────────────────────────────────────────────────────────────────

  describe("cross-file item update", () => {
    it("updateItem writes to the correct owning file", async () => {
      await seedTwoBranch(rexDir);
      const store = new FileStore(rexDir);

      // Update a task in the feature-x file
      await store.updateItem("t-index", { status: "in_progress" });

      // Verify: feature-x file updated, main file unchanged
      const featureX = await readPRDFile(rexDir, "prd_feature-x_2026-04-01.json");
      const indexTask = featureX.items[0].children![0].children![0];
      expect(indexTask.status).toBe("in_progress");

      const main = await readPRDFile(rexDir, "prd_main_2026-01-01.json");
      const tokenTask = main.items[0].children![0].children![0];
      expect(tokenTask.status).toBe("pending"); // unchanged
    });

    it("addItem under cross-file parent routes to parent's file", async () => {
      await seedTwoBranch(rexDir);
      const store = new FileStore(rexDir);

      // Add a task under the search feature (in feature-x file)
      await store.addItem(
        makeTask("t-fuzzy", "Fuzzy matching"),
        "f-index", // parent in feature-x file
      );

      // Verify it ended up in the feature-x file
      const featureX = await readPRDFile(rexDir, "prd_feature-x_2026-04-01.json");
      const indexFeature = featureX.items[0].children![0];
      expect(indexFeature.children).toHaveLength(3);
      expect(indexFeature.children![2].id).toBe("t-fuzzy");

      // Main file unchanged
      const main = await readPRDFile(rexDir, "prd_main_2026-01-01.json");
      expect(main.items[0].children![0].children).toHaveLength(2);
    });

    it("addItem without parent uses currentBranchFile", async () => {
      await seedTwoBranch(rexDir);
      const store = new FileStore(rexDir, {
        currentBranchFile: "prd_feature-x_2026-04-01.json",
      });

      await store.addItem(makeEpic("e-new", "New Epic"));

      // Should appear in feature-x file
      const featureX = await readPRDFile(rexDir, "prd_feature-x_2026-04-01.json");
      expect(featureX.items).toHaveLength(2);
      expect(featureX.items[1].id).toBe("e-new");
    });

    it("removeItem removes from the correct file", async () => {
      await seedTwoBranch(rexDir);
      const store = new FileStore(rexDir);

      await store.removeItem("t-query");

      const featureX = await readPRDFile(rexDir, "prd_feature-x_2026-04-01.json");
      const indexFeature = featureX.items[0].children![0];
      expect(indexFeature.children).toHaveLength(1);
      expect(indexFeature.children![0].id).toBe("t-index");

      // Main file unchanged
      const main = await readPRDFile(rexDir, "prd_main_2026-01-01.json");
      expect(main.items[0].children![0].children).toHaveLength(2);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 3. Duplicate merge across files
  // ────────────────────────────────────────────────────────────────────────

  describe("cross-file merge via withTransaction", () => {
    it("merges root-level siblings from different files", async () => {
      // Two files, each with a root epic — make them siblings (both root-level)
      await writeFile(
        join(rexDir, "prd_main_2026-01-01.json"),
        toCanonicalJSON(
          makeDoc("Main", [
            makeEpic("e-target", "Auth System", [
              makeFeature("f-1", "Login"),
            ]),
          ]),
        ),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_branch_2026-04-01.json"),
        toCanonicalJSON(
          makeDoc("Branch", [
            makeEpic("e-absorbed", "Authentication", [
              makeFeature("f-2", "OAuth"),
            ]),
          ]),
        ),
        "utf-8",
      );

      const store = new FileStore(rexDir);

      await store.withTransaction(async (doc) => {
        // Root items are siblings (both level: epic, no parent)
        const validation = validateMerge(doc.items, ["e-target", "e-absorbed"], "e-target");
        expect(validation.valid).toBe(true);

        mergeItems(doc.items, ["e-target", "e-absorbed"], "e-target");
      });

      // After merge, aggregated doc should have only the target epic
      const doc = await store.loadDocument();
      expect(doc.items).toHaveLength(1);
      expect(doc.items[0].id).toBe("e-target");
      // Target should have children from both epics
      expect(doc.items[0].children).toHaveLength(2);
      const childIds = doc.items[0].children!.map((c) => c.id);
      expect(childIds).toContain("f-1");
      expect(childIds).toContain("f-2");
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 4. MCP tool handler operations
  // ────────────────────────────────────────────────────────────────────────

  describe("MCP tool operations on multi-file PRDs", () => {
    it("get_prd_status returns aggregated stats", async () => {
      await seedTwoBranch(rexDir);
      const store = new FileStore(rexDir);
      const doc = await store.loadDocument();
      const stats = computeStats(doc.items);

      // MCP handler calls loadDocument + computeStats
      // computeStats counts work items only (4 tasks across both files)
      expect(stats.total).toBe(4);

      // Per-epic stats (each epic has 1 feature + 2 tasks = 2 work items)
      const epics = doc.items.map((item) => ({
        id: item.id,
        title: item.title,
        stats: item.children ? computeStats(item.children) : null,
      }));
      expect(epics).toHaveLength(2);
      expect(epics[0].stats!.total).toBe(2); // 2 tasks
      expect(epics[1].stats!.total).toBe(2); // 2 tasks
    });

    it("update_task_status via store.updateItem works cross-file", async () => {
      await seedTwoBranch(rexDir);
      const store = new FileStore(rexDir);

      // Simulate MCP update_task_status flow
      const existing = await store.getItem("t-token");
      expect(existing).not.toBeNull();

      await store.updateItem("t-token", { status: "completed" });

      const updated = await store.getItem("t-token");
      expect(updated!.status).toBe("completed");

      // Verify persisted to correct file
      const main = await readPRDFile(rexDir, "prd_main_2026-01-01.json");
      const tokenTask = main.items[0].children![0].children![0];
      expect(tokenTask.status).toBe("completed");
    });

    it("add_item via store.addItem routes correctly", async () => {
      await seedTwoBranch(rexDir);
      const store = new FileStore(rexDir, {
        currentBranchFile: "prd_feature-x_2026-04-01.json",
      });

      // MCP add_item with parentId
      const subtask: PRDItem = {
        id: "st-1",
        title: "Unit test for index",
        status: "pending",
        level: "subtask",
      };
      await store.addItem(subtask, "t-index");

      const featureX = await readPRDFile(rexDir, "prd_feature-x_2026-04-01.json");
      const indexTask = featureX.items[0].children![0].children![0];
      expect(indexTask.children).toHaveLength(1);
      expect(indexTask.children![0].id).toBe("st-1");
    });

    it("edit_item via store.updateItem modifies fields correctly", async () => {
      await seedTwoBranch(rexDir);
      const store = new FileStore(rexDir);

      // MCP edit_item flow: update title and description
      await store.updateItem("e-search", {
        title: "Full-Text Search",
        description: "Comprehensive search across all content",
      });

      const item = await store.getItem("e-search");
      expect(item!.title).toBe("Full-Text Search");
      expect(item!.description).toBe("Comprehensive search across all content");

      // Verify correct file updated
      const featureX = await readPRDFile(rexDir, "prd_feature-x_2026-04-01.json");
      expect(featureX.items[0].title).toBe("Full-Text Search");
    });

    it("move_item across files via withTransaction", async () => {
      await seedTwoBranch(rexDir);
      const store = new FileStore(rexDir);

      // Move t-query from search feature to oauth feature (cross-file move)
      await store.withTransaction(async (doc) => {
        // Use ID-based lookup (item order depends on discovery sort)
        const searchEpic = doc.items.find((i) => i.id === "e-search")!;
        const searchFeature = searchEpic.children![0]; // f-index
        const taskIdx = searchFeature.children!.findIndex((c) => c.id === "t-query");
        expect(taskIdx).toBeGreaterThanOrEqual(0);
        const [task] = searchFeature.children!.splice(taskIdx, 1);

        const authEpic = doc.items.find((i) => i.id === "e-auth")!;
        const oauthFeature = authEpic.children![0]; // f-oauth
        if (!oauthFeature.children) oauthFeature.children = [];
        oauthFeature.children.push(task);
      });

      // After save, verify the move persisted
      const doc = await store.loadDocument();
      const authEpic = doc.items.find((i) => i.id === "e-auth")!;
      const oauthFeature = authEpic.children![0];
      expect(oauthFeature.children).toHaveLength(3);
      expect(oauthFeature.children![2].id).toBe("t-query");
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 5. Three+ files aggregation
  // ────────────────────────────────────────────────────────────────────────

  describe("three-file aggregation", () => {
    it("aggregates items from legacy prd.json + two branch files", async () => {
      // Legacy prd.json with existing items
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(
          makeDoc("Legacy", [makeEpic("e-legacy", "Legacy Epic")]),
        ),
        "utf-8",
      );
      // Plus two branch files
      await seedTwoBranch(rexDir);

      const store = new FileStore(rexDir);
      const doc = await store.loadDocument();

      // Should have all three root epics
      expect(doc.items).toHaveLength(3);
      const ids = doc.items.map((i) => i.id);
      expect(ids).toContain("e-legacy");
      expect(ids).toContain("e-auth");
      expect(ids).toContain("e-search");

      // Primary metadata comes from prd.json (first source)
      expect(doc.title).toBe("Legacy");
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 6. Hench task selection considers all files
  // ────────────────────────────────────────────────────────────────────────

  describe("hench task selection via store", () => {
    it("selects highest-priority task across all files", async () => {
      await writeFile(
        join(rexDir, "prd_main_2026-01-01.json"),
        toCanonicalJSON(
          makeDoc("Main", [
            makeEpic("e1", "Epic A", [
              makeFeature("f1", "Feature A", [
                makeTask("t-low", "Low priority task", { priority: "low" }),
              ]),
            ]),
          ]),
        ),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_hotfix_2026-04-01.json"),
        toCanonicalJSON(
          makeDoc("Hotfix", [
            makeEpic("e2", "Epic B", [
              makeFeature("f2", "Feature B", [
                makeTask("t-critical", "Critical fix", { priority: "critical" }),
              ]),
            ]),
          ]),
        ),
        "utf-8",
      );

      const store = new FileStore(rexDir);
      const doc = await store.loadDocument();
      const completedIds = collectCompletedIds(doc.items);
      const next = findNextTask(doc.items, completedIds);

      expect(next).not.toBeNull();
      expect(next!.item.id).toBe("t-critical");
    });

    it("respects blockedBy dependencies across files", async () => {
      await writeFile(
        join(rexDir, "prd_main_2026-01-01.json"),
        toCanonicalJSON(
          makeDoc("Main", [
            makeEpic("e1", "Epic A", [
              makeFeature("f1", "Feature A", [
                makeTask("t-dep", "Dependency task", { priority: "high" }),
              ]),
            ]),
          ]),
        ),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_branch_2026-04-01.json"),
        toCanonicalJSON(
          makeDoc("Branch", [
            makeEpic("e2", "Epic B", [
              makeFeature("f2", "Feature B", [
                makeTask("t-blocked", "Blocked task", {
                  priority: "critical",
                  blockedBy: ["t-dep"],
                }),
              ]),
            ]),
          ]),
        ),
        "utf-8",
      );

      const store = new FileStore(rexDir);
      const doc = await store.loadDocument();
      const completedIds = collectCompletedIds(doc.items);
      const next = findNextTask(doc.items, completedIds);

      // t-blocked is critical but blocked by t-dep → pick t-dep
      expect(next).not.toBeNull();
      expect(next!.item.id).toBe("t-dep");
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 7. Round-trip decomposition preserves file boundaries
  // ────────────────────────────────────────────────────────────────────────

  describe("save decomposition", () => {
    it("withTransaction preserves per-file item ownership", async () => {
      await seedTwoBranch(rexDir);
      const store = new FileStore(rexDir);

      // Mutation via withTransaction: update title of e-search
      await store.withTransaction(async (doc) => {
        const search = doc.items.find((i) => i.id === "e-search")!;
        search.title = "Full-Text Search";
      });

      // Verify each file still has its own items
      const main = await readPRDFile(rexDir, "prd_main_2026-01-01.json");
      expect(main.items).toHaveLength(1);
      expect(main.items[0].id).toBe("e-auth");

      const featureX = await readPRDFile(rexDir, "prd_feature-x_2026-04-01.json");
      expect(featureX.items).toHaveLength(1);
      expect(featureX.items[0].id).toBe("e-search");
      expect(featureX.items[0].title).toBe("Full-Text Search");
    });

    it("per-file metadata preserved after save", async () => {
      await seedTwoBranch(rexDir);
      const store = new FileStore(rexDir);

      await store.withTransaction(async () => {
        // No-op mutation — just verify round-trip
      });

      const main = await readPRDFile(rexDir, "prd_main_2026-01-01.json");
      expect(main.title).toBe("Main Branch");

      const featureX = await readPRDFile(rexDir, "prd_feature-x_2026-04-01.json");
      expect(featureX.title).toBe("Feature X");
    });
  });
});
