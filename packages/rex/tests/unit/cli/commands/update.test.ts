import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { CLIError } from "../../../../src/cli/errors.js";
import { cmdUpdate } from "../../../../src/cli/commands/update.js";
import { readPRD, writePRD } from "../../../helpers/rex-dir-test-support.js";
import { slugify } from "../../../../src/store/folder-tree-serializer.js";
import type { PRDDocument } from "../../../../src/schema/index.js";
import { PRD_TREE_DIRNAME } from "../../../../src/store/index.js";

describe("cmdUpdate", () => {
  let tmp: string;
  const itemId = "test-item-123";

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "rex-update-test-"));
    mkdirSync(join(tmp, ".rex"));
    writePRD(tmp, {
      schema: "rex/v1",
      title: "test",
      items: [
        {
          id: itemId,
          title: "Test item",
          level: "epic",
          status: "pending",
        },
      ],
    } as PRDDocument);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true });
  });

  it("throws CLIError when ID is missing", async () => {
    await expect(cmdUpdate(tmp, "", {})).rejects.toThrow(CLIError);
    await expect(cmdUpdate(tmp, "", {})).rejects.toThrow(/Missing item ID/);
  });

  it("includes usage hint when ID is missing", async () => {
    try {
      await cmdUpdate(tmp, "", {});
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      expect((err as CLIError).suggestion).toContain("rex update");
    }
  });

  it("throws CLIError when item not found", async () => {
    await expect(cmdUpdate(tmp, "nonexistent", { status: "completed" })).rejects.toThrow(CLIError);
    await expect(cmdUpdate(tmp, "nonexistent", { status: "completed" })).rejects.toThrow(
      /not found/,
    );
  });

  it("includes suggestion to check status when item not found", async () => {
    try {
      await cmdUpdate(tmp, "nonexistent", { status: "completed" });
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      expect((err as CLIError).suggestion).toContain("rex status");
    }
  });

  it("throws CLIError for invalid status", async () => {
    await expect(cmdUpdate(tmp, itemId, { status: "invalid" })).rejects.toThrow(CLIError);
    await expect(cmdUpdate(tmp, itemId, { status: "invalid" })).rejects.toThrow(/Invalid status/);
  });

  it("includes valid statuses in suggestion", async () => {
    try {
      await cmdUpdate(tmp, itemId, { status: "invalid" });
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      expect((err as CLIError).suggestion).toContain("pending");
      expect((err as CLIError).suggestion).toContain("completed");
    }
  });

  it("throws CLIError for invalid priority", async () => {
    await expect(cmdUpdate(tmp, itemId, { priority: "invalid" })).rejects.toThrow(CLIError);
    await expect(cmdUpdate(tmp, itemId, { priority: "invalid" })).rejects.toThrow(
      /Invalid priority/,
    );
  });

  it("includes valid priorities in suggestion", async () => {
    try {
      await cmdUpdate(tmp, itemId, { priority: "invalid" });
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      expect((err as CLIError).suggestion).toContain("high");
      expect((err as CLIError).suggestion).toContain("low");
    }
  });

  it("throws CLIError when no updates are specified", async () => {
    await expect(cmdUpdate(tmp, itemId, {})).rejects.toThrow(CLIError);
    await expect(cmdUpdate(tmp, itemId, {})).rejects.toThrow(/No updates specified/);
  });

  it("includes available flags in suggestion for no updates", async () => {
    try {
      await cmdUpdate(tmp, itemId, {});
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      expect((err as CLIError).suggestion).toContain("--status");
      expect((err as CLIError).suggestion).toContain("--priority");
    }
  });

  it("throws CLIError when .rex directory does not exist", async () => {
    const noRexDir = mkdtempSync(join(tmpdir(), "rex-update-norex-"));
    try {
      await expect(
        cmdUpdate(noRexDir, itemId, { status: "completed" }),
      ).rejects.toThrow(CLIError);
      await expect(
        cmdUpdate(noRexDir, itemId, { status: "completed" }),
      ).rejects.toThrow(/Rex directory not found/);
    } finally {
      rmSync(noRexDir, { recursive: true });
    }
  });

  it("succeeds for valid update", async () => {
    await expect(
      cmdUpdate(tmp, itemId, { status: "completed" }),
    ).resolves.toBeUndefined();
  });

  it("accepts blocked as a valid status", async () => {
    await expect(
      cmdUpdate(tmp, itemId, { status: "blocked" }),
    ).resolves.toBeUndefined();
  });

  // --- Status transition validation ---

  describe("status transition validation", () => {
    it("allows pending → in_progress", async () => {
      await expect(
        cmdUpdate(tmp, itemId, { status: "in_progress" }),
      ).resolves.toBeUndefined();
    });

    it("allows pending → completed", async () => {
      await expect(
        cmdUpdate(tmp, itemId, { status: "completed" }),
      ).resolves.toBeUndefined();
    });

    it("blocks completed → pending without --force", async () => {
      // First move to completed
      await cmdUpdate(tmp, itemId, { status: "completed" });
      // Then try to go back to pending
      await expect(
        cmdUpdate(tmp, itemId, { status: "pending" }),
      ).rejects.toThrow(CLIError);
      await expect(
        cmdUpdate(tmp, itemId, { status: "pending" }),
      ).rejects.toThrow(/Cannot move from "completed"/);
    });

    it("includes --force hint in transition error", async () => {
      await cmdUpdate(tmp, itemId, { status: "completed" });
      try {
        await cmdUpdate(tmp, itemId, { status: "pending" });
      } catch (err) {
        expect(err).toBeInstanceOf(CLIError);
        expect((err as CLIError).suggestion).toContain("--force");
      }
    });

    it("allows completed → pending with --force", async () => {
      await cmdUpdate(tmp, itemId, { status: "completed" });
      await expect(
        cmdUpdate(tmp, itemId, { status: "pending", force: "true" }),
      ).resolves.toBeUndefined();
    });

    it("blocks completed → in_progress without --force", async () => {
      await cmdUpdate(tmp, itemId, { status: "completed" });
      await expect(
        cmdUpdate(tmp, itemId, { status: "in_progress" }),
      ).rejects.toThrow(/Cannot move from "completed"/);
    });

    it("allows completed → in_progress with --force", async () => {
      await cmdUpdate(tmp, itemId, { status: "completed" });
      await expect(
        cmdUpdate(tmp, itemId, { status: "in_progress", force: "true" }),
      ).resolves.toBeUndefined();
    });

    it("blocks deferred → completed without --force", async () => {
      await cmdUpdate(tmp, itemId, { status: "deferred" });
      await expect(
        cmdUpdate(tmp, itemId, { status: "completed" }),
      ).rejects.toThrow(/Cannot move from "deferred"/);
    });

    it("allows deferred → completed with --force", async () => {
      await cmdUpdate(tmp, itemId, { status: "deferred" });
      await expect(
        cmdUpdate(tmp, itemId, { status: "completed", force: "true" }),
      ).resolves.toBeUndefined();
    });

    it("blocks blocked → completed without --force", async () => {
      await cmdUpdate(tmp, itemId, { status: "blocked" });
      await expect(
        cmdUpdate(tmp, itemId, { status: "completed" }),
      ).rejects.toThrow(/Cannot move from "blocked"/);
    });

    it("allows blocked → completed with --force", async () => {
      await cmdUpdate(tmp, itemId, { status: "blocked" });
      await expect(
        cmdUpdate(tmp, itemId, { status: "completed", force: "true" }),
      ).resolves.toBeUndefined();
    });

    it("allows same-status no-op without error", async () => {
      await expect(
        cmdUpdate(tmp, itemId, { status: "pending" }),
      ).resolves.toBeUndefined();
    });

    it("does not require --force for non-status updates on completed items", async () => {
      await cmdUpdate(tmp, itemId, { status: "completed" });
      await expect(
        cmdUpdate(tmp, itemId, { title: "New title" }),
      ).resolves.toBeUndefined();
    });
  });

  // --- blockedBy updates ---

  describe("blockedBy updates", () => {
    it("sets blockedBy from comma-separated string", async () => {
      // The two dependency tasks are nested under a feature so the folder
      // tree can persist them. Tasks placed directly at root would be
      // dropped by the serializer and the cycle/dependency check would fail.
      writePRD(tmp, {
          schema: "rex/v1",
          title: "test",
          items: [
            { id: itemId, title: "Test item", level: "epic", status: "pending" },
            {
              id: "deps-epic",
              title: "Deps Epic",
              level: "epic",
              status: "pending",
              children: [
                {
                  id: "deps-feat",
                  title: "Deps Feature",
                  level: "feature",
                  status: "pending",
                  children: [
                    { id: "dep-1", title: "Dep 1", level: "task", status: "pending" },
                    { id: "dep-2", title: "Dep 2", level: "task", status: "pending" },
                  ],
                },
              ],
            },
          ],
        } as PRDDocument);

      await cmdUpdate(tmp, itemId, { blockedBy: "dep-1,dep-2" });

      const doc = readPRD(tmp);
      const updated = doc.items.find((i: { id: string }) => i.id === itemId);
      expect(updated.blockedBy).toEqual(["dep-1", "dep-2"]);
    });

    it("clears blockedBy with empty string", async () => {
      writePRD(tmp, {
          schema: "rex/v1",
          title: "test",
          items: [
            { id: itemId, title: "Test item", level: "epic", status: "pending", blockedBy: ["dep-1"] },
            { id: "dep-1", title: "Dep 1", level: "task", status: "pending" },
          ],
        } as PRDDocument);

      await cmdUpdate(tmp, itemId, { blockedBy: "" });

      const doc = readPRD(tmp);
      expect(doc.items[0].blockedBy).toBeUndefined();
    });

    it("rejects blockedBy with nonexistent IDs", async () => {
      await expect(
        cmdUpdate(tmp, itemId, { blockedBy: "nonexistent" }),
      ).rejects.toThrow(CLIError);
      await expect(
        cmdUpdate(tmp, itemId, { blockedBy: "nonexistent" }),
      ).rejects.toThrow(/not found|Orphan|unknown/i);
    });

    it("rejects blockedBy that creates a self-reference", async () => {
      await expect(
        cmdUpdate(tmp, itemId, { blockedBy: itemId }),
      ).rejects.toThrow(CLIError);
      await expect(
        cmdUpdate(tmp, itemId, { blockedBy: itemId }),
      ).rejects.toThrow(/self|itself|cycle/i);
    });

    it("rejects blockedBy that creates a cycle", async () => {
      // Use a proper hierarchy (epic → feature → tasks) so the folder tree
      // can represent the test PRD; tasks at root would be dropped by the
      // tree serializer and `getItem` would no longer find them.
      writePRD(tmp, {
          schema: "rex/v1",
          title: "test",
          items: [
            {
              id: "epic-cycle",
              title: "Cycle Epic",
              level: "epic",
              status: "pending",
              children: [
                {
                  id: "feat-cycle",
                  title: "Cycle Feature",
                  level: "feature",
                  status: "pending",
                  children: [
                    { id: "a", title: "A", level: "task", status: "pending", blockedBy: ["b"] },
                    { id: "b", title: "B", level: "task", status: "pending" },
                  ],
                },
              ],
            },
          ],
        } as PRDDocument);

      // b blocked by a → a blocked by b → cycle
      await expect(
        cmdUpdate(tmp, "b", { blockedBy: "a" }),
      ).rejects.toThrow(CLIError);
      await expect(
        cmdUpdate(tmp, "b", { blockedBy: "a" }),
      ).rejects.toThrow(/[Cc]ycle/);
    });
  });

  // --- Automatic timestamps ---

  describe("automatic timestamps", () => {
    function readItem(): PRDDocument["items"][number] {
      const doc = readPRD(tmp);
      return doc.items[0];
    }

    it("sets startedAt when transitioning to in_progress", async () => {
      await cmdUpdate(tmp, itemId, { status: "in_progress" });
      const item = readItem();
      expect(item.startedAt).toBeDefined();
      expect(typeof item.startedAt).toBe("string");
      // Should be a valid ISO timestamp
      expect(new Date(item.startedAt as string).toISOString()).toBe(item.startedAt);
    });

    it("sets completedAt when transitioning to completed", async () => {
      await cmdUpdate(tmp, itemId, { status: "in_progress" });
      await cmdUpdate(tmp, itemId, { status: "completed" });
      const item = readItem();
      expect(item.completedAt).toBeDefined();
      expect(typeof item.completedAt).toBe("string");
    });

    it("preserves startedAt when completing after in_progress", async () => {
      await cmdUpdate(tmp, itemId, { status: "in_progress" });
      const before = readItem();
      const started = before.startedAt;
      expect(started).toBeDefined();

      await cmdUpdate(tmp, itemId, { status: "completed" });
      const after = readItem();
      expect(after.startedAt).toBe(started);
      expect(after.completedAt).toBeDefined();
    });

    it("sets both startedAt and completedAt when skipping to completed", async () => {
      await cmdUpdate(tmp, itemId, { status: "completed" });
      const item = readItem();
      expect(item.startedAt).toBeDefined();
      expect(item.completedAt).toBeDefined();
    });

    it("clears completedAt when forced back from completed", async () => {
      await cmdUpdate(tmp, itemId, { status: "completed" });
      const before = readItem();
      expect(before.completedAt).toBeDefined();

      await cmdUpdate(tmp, itemId, { status: "pending", force: "true" });
      const after = readItem();
      expect(after.completedAt).toBeUndefined();
    });

    it("does not add timestamps for non-status updates", async () => {
      await cmdUpdate(tmp, itemId, { title: "New title" });
      const item = readItem();
      expect(item.startedAt).toBeUndefined();
      expect(item.completedAt).toBeUndefined();
    });
  });

  // --- Folder tree persistence ---

  describe("folder tree persistence", () => {
    it("writes folder tree after a status update", async () => {
      await cmdUpdate(tmp, itemId, { status: "in_progress" });

      const treeRoot = join(tmp, ".rex", PRD_TREE_DIRNAME);
      expect(existsSync(treeRoot)).toBe(true);
      const epicDir = join(treeRoot, slugify("Test item", itemId));
      expect(existsSync(epicDir)).toBe(true);
      const mdFile = readdirSync(epicDir).find((f) => f.endsWith(".md"))!;
      const content = readFileSync(join(epicDir, mdFile), "utf-8");
      expect(content).toContain("in_progress");
    });

    it("writes folder tree after a title update", async () => {
      await cmdUpdate(tmp, itemId, { title: "New title" });

      const treeRoot = join(tmp, ".rex", PRD_TREE_DIRNAME);
      expect(existsSync(treeRoot)).toBe(true);
      const entries = readdirSync(treeRoot).filter((e) =>
        statSync(join(treeRoot, e)).isDirectory(),
      );
      expect(entries.length).toBe(1);
      const epicDir = join(treeRoot, entries[0]);
      const mdFile = readdirSync(epicDir).find((f) => f.endsWith(".md"))!;
      const content = readFileSync(join(epicDir, mdFile), "utf-8");
      expect(content).toContain("New title");
    });

    it("writes folder tree after deletion (removes epic folder)", async () => {
      // First, write the tree by updating status
      await cmdUpdate(tmp, itemId, { status: "in_progress" });
      const treeRoot = join(tmp, ".rex", PRD_TREE_DIRNAME);
      expect(existsSync(treeRoot)).toBe(true);

      // Deleting removes the item; the folder tree should have no subdirectories
      await cmdUpdate(tmp, itemId, { status: "deleted", force: "true" });
      const entries = readdirSync(treeRoot).filter(e => statSync(join(treeRoot, e)).isDirectory());
      expect(entries.length).toBe(0);
    });
  });
});
