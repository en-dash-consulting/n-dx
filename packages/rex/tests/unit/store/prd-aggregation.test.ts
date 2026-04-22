import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
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

describe("PRDStore aggregation", () => {
  let rexDir: string;
  let store: FileStore;

  beforeEach(async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "rex-agg-test-"));
    rexDir = join(tmpDir, ".rex");
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

  // ---- Legacy single-file behavior ------------------------------------------

  describe("loadDocument with single legacy prd.json", () => {
    it("loads legacy prd.json when no branch files exist", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(makeDoc("Legacy", [makeItem("e1", "Epic One")])),
        "utf-8",
      );
      const doc = await store.loadDocument();
      expect(doc.title).toBe("Legacy");
      expect(doc.items).toHaveLength(1);
      expect(doc.items[0].id).toBe("e1");
    });

    it("throws when prd.json is missing and no branch files exist", async () => {
      await expect(store.loadDocument()).rejects.toThrow();
    });
  });

  // ---- Multi-file aggregation -----------------------------------------------

  describe("loadDocument with multiple PRD files", () => {
    it("aggregates items from all prd_*.json files", async () => {
      await writeFile(
        join(rexDir, "prd_main_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Main", [makeItem("e1", "Epic One")])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_feature-x_2025-02-01.json"),
        toCanonicalJSON(makeDoc("Feature X", [makeItem("e2", "Epic Two")])),
        "utf-8",
      );

      const doc = await store.loadDocument();
      expect(doc.items).toHaveLength(2);
      const ids = doc.items.map((i) => i.id);
      expect(ids).toContain("e1");
      expect(ids).toContain("e2");
    });

    it("includes legacy prd.json items in aggregation", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(makeDoc("Legacy", [makeItem("e0", "Legacy Epic")])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_main_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Main", [makeItem("e1", "Main Epic")])),
        "utf-8",
      );

      const doc = await store.loadDocument();
      expect(doc.items).toHaveLength(2);
      const ids = doc.items.map((i) => i.id);
      expect(ids).toContain("e0");
      expect(ids).toContain("e1");
    });

    it("works with branch files only (no legacy prd.json)", async () => {
      // No prd.json at all — only branch-scoped files
      await writeFile(
        join(rexDir, "prd_main_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Main", [makeItem("e1", "Epic One")])),
        "utf-8",
      );

      const doc = await store.loadDocument();
      expect(doc.items).toHaveLength(1);
      expect(doc.items[0].id).toBe("e1");
    });

    it("preserves tree structure within each file", async () => {
      const epic: PRDItem = {
        ...makeItem("e1", "Epic"),
        children: [
          {
            id: "f1",
            title: "Feature",
            status: "pending" as const,
            level: "feature" as const,
          },
        ],
      };
      await writeFile(
        join(rexDir, "prd_main_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Main", [epic])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_feature-x_2025-02-01.json"),
        toCanonicalJSON(makeDoc("Feature X", [makeItem("e2", "Epic Two")])),
        "utf-8",
      );

      const doc = await store.loadDocument();
      expect(doc.items).toHaveLength(2);
      const mergedE1 = doc.items.find((i) => i.id === "e1");
      expect(mergedE1?.children).toHaveLength(1);
      expect(mergedE1?.children![0].id).toBe("f1");
    });

    it("uses primary document metadata for merged result", async () => {
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

      const doc = await store.loadDocument();
      expect(doc.schema).toBe(SCHEMA_VERSION);
      // prd.json is loaded first, so its title is used as base
      expect(doc.title).toBe("Primary");
    });

    it("aggregates three or more files", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(makeDoc("Primary", [makeItem("e0", "Zero")])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_alpha_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Alpha", [makeItem("e1", "One")])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_beta_2025-02-01.json"),
        toCanonicalJSON(makeDoc("Beta", [makeItem("e2", "Two")])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_gamma_2025-03-01.json"),
        toCanonicalJSON(makeDoc("Gamma", [makeItem("e3", "Three")])),
        "utf-8",
      );

      const doc = await store.loadDocument();
      expect(doc.items).toHaveLength(4);
      const ids = doc.items.map((i) => i.id).sort();
      expect(ids).toEqual(["e0", "e1", "e2", "e3"]);
    });

    it("throws on corrupt branch file (invalid JSON)", async () => {
      await writeFile(
        join(rexDir, "prd_main_2025-01-01.json"),
        "{broken json",
        "utf-8",
      );
      await expect(store.loadDocument()).rejects.toThrow();
    });

    it("throws on corrupt prd.json when branch files exist", async () => {
      await writeFile(join(rexDir, "prd.json"), "{broken", "utf-8");
      await writeFile(
        join(rexDir, "prd_main_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Main", [makeItem("e1", "Epic")])),
        "utf-8",
      );
      // prd.json is corrupt — should throw even though branch files are valid
      await expect(store.loadDocument()).rejects.toThrow();
    });

    it("throws on schema-invalid branch file", async () => {
      await writeFile(
        join(rexDir, "prd_main_2025-01-01.json"),
        JSON.stringify({ title: "No schema", items: [] }),
        "utf-8",
      );
      await expect(store.loadDocument()).rejects.toThrow(/Invalid prd_main/);
    });
  });

  // ---- ID collision detection ------------------------------------------------

  describe("ID collision detection", () => {
    it("throws on duplicate IDs across files", async () => {
      await writeFile(
        join(rexDir, "prd_main_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Main", [makeItem("e1", "Epic One")])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_feature-x_2025-02-01.json"),
        toCanonicalJSON(
          makeDoc("Feature X", [makeItem("e1", "Duplicate Epic")]),
        ),
        "utf-8",
      );

      await expect(store.loadDocument()).rejects.toThrow("ID collision");
    });

    it("detects collision between legacy prd.json and branch file", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(makeDoc("Legacy", [makeItem("e1", "Legacy")])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_main_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Main", [makeItem("e1", "Duplicate")])),
        "utf-8",
      );

      await expect(store.loadDocument()).rejects.toThrow("ID collision");
    });

    it("detects collision in nested items", async () => {
      const epic: PRDItem = {
        ...makeItem("e1", "Epic"),
        children: [
          {
            id: "shared-id",
            title: "Feature",
            status: "pending" as const,
            level: "feature" as const,
          },
        ],
      };
      await writeFile(
        join(rexDir, "prd_main_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Main", [epic])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_feature-x_2025-02-01.json"),
        toCanonicalJSON(
          makeDoc("Feature X", [makeItem("shared-id", "Collision")]),
        ),
        "utf-8",
      );

      await expect(store.loadDocument()).rejects.toThrow("ID collision");
    });

    it("includes file names in collision error message", async () => {
      await writeFile(
        join(rexDir, "prd_main_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Main", [makeItem("e1", "Epic")])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_feature-x_2025-02-01.json"),
        toCanonicalJSON(makeDoc("Feature X", [makeItem("e1", "Duplicate")])),
        "utf-8",
      );

      try {
        await store.loadDocument();
        expect.fail("Should have thrown");
      } catch (err) {
        const msg = (err as Error).message;
        expect(msg).toContain("prd_main_2025-01-01.json");
        expect(msg).toContain("prd_feature-x_2025-02-01.json");
      }
    });
  });

  // ---- getItem across files -------------------------------------------------

  describe("getItem across files", () => {
    it("finds item from any PRD file", async () => {
      await writeFile(
        join(rexDir, "prd_main_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Main", [makeItem("e1", "Epic One")])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_feature-x_2025-02-01.json"),
        toCanonicalJSON(makeDoc("Feature X", [makeItem("e2", "Epic Two")])),
        "utf-8",
      );

      const item1 = await store.getItem("e1");
      expect(item1).not.toBeNull();
      expect(item1!.title).toBe("Epic One");

      const item2 = await store.getItem("e2");
      expect(item2).not.toBeNull();
      expect(item2!.title).toBe("Epic Two");
    });

    it("finds nested item from branch file", async () => {
      const epic: PRDItem = {
        ...makeItem("e1", "Epic"),
        children: [
          {
            id: "f1",
            title: "Deep Feature",
            status: "pending" as const,
            level: "feature" as const,
          },
        ],
      };
      await writeFile(
        join(rexDir, "prd_main_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Main", [epic])),
        "utf-8",
      );

      const item = await store.getItem("f1");
      expect(item).not.toBeNull();
      expect(item!.title).toBe("Deep Feature");
    });

    it("returns null for nonexistent id across all files", async () => {
      await writeFile(
        join(rexDir, "prd_main_2025-01-01.json"),
        toCanonicalJSON(makeDoc("Main", [makeItem("e1", "Epic One")])),
        "utf-8",
      );

      const item = await store.getItem("nonexistent");
      expect(item).toBeNull();
    });
  });

  // ---- withTransaction isolation --------------------------------------------

  describe("withTransaction isolation", () => {
    it("operates on primary prd.json only", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(
          makeDoc("Primary", [makeItem("e0", "Primary Epic")]),
        ),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_branch_2025-01-01.json"),
        toCanonicalJSON(
          makeDoc("Branch", [makeItem("e1", "Branch Epic")]),
        ),
        "utf-8",
      );

      await store.withTransaction(async (doc) => {
        // Transaction should only see primary document items
        expect(doc.items).toHaveLength(1);
        expect(doc.items[0].id).toBe("e0");
      });
    });

    it("does not write branch file items to prd.json", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(
          makeDoc("Primary", [makeItem("e0", "Primary Epic")]),
        ),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_branch_2025-01-01.json"),
        toCanonicalJSON(
          makeDoc("Branch", [makeItem("e1", "Branch Epic")]),
        ),
        "utf-8",
      );

      // Run a no-op transaction
      await store.withTransaction(async () => {});

      // Verify prd.json still has only its original item
      const raw = await readFile(join(rexDir, "prd.json"), "utf-8");
      const primary = JSON.parse(raw) as PRDDocument;
      expect(primary.items).toHaveLength(1);
      expect(primary.items[0].id).toBe("e0");
    });

    it("addItem via transaction writes only to prd.json", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        toCanonicalJSON(makeDoc("Primary", [])),
        "utf-8",
      );
      await writeFile(
        join(rexDir, "prd_branch_2025-01-01.json"),
        toCanonicalJSON(
          makeDoc("Branch", [makeItem("e1", "Branch Epic")]),
        ),
        "utf-8",
      );

      await store.addItem(makeItem("e2", "New Epic"));

      // Verify new item is in prd.json
      const raw = await readFile(join(rexDir, "prd.json"), "utf-8");
      const primary = JSON.parse(raw) as PRDDocument;
      expect(primary.items).toHaveLength(1);
      expect(primary.items[0].id).toBe("e2");

      // Verify branch file is untouched
      const branchRaw = await readFile(
        join(rexDir, "prd_branch_2025-01-01.json"),
        "utf-8",
      );
      const branch = JSON.parse(branchRaw) as PRDDocument;
      expect(branch.items).toHaveLength(1);
      expect(branch.items[0].id).toBe("e1");

      // But loadDocument sees all items aggregated
      const doc = await store.loadDocument();
      expect(doc.items).toHaveLength(2);
    });
  });
});
