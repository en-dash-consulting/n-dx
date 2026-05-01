import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { CLIError } from "../../../../src/cli/errors.js";
import { cmdRemove } from "../../../../src/cli/commands/remove.js";
import { readPRD, writePRD } from "../../../helpers/rex-dir-test-support.js";
import { slugify } from "../../../../src/store/folder-tree-serializer.js";
import type { PRDDocument, PRDItem } from "../../../../src/schema/index.js";
import { PRD_TREE_DIRNAME } from "../../../../src/store/index.js";

function makePrd(items: PRDItem[] = []): PRDDocument {
  return { schema: "rex/v1", title: "test", items } as PRDDocument;
}

function fullTree() {
  return [
    {
      id: "e1", title: "Epic One", level: "epic", status: "pending",
      children: [
        {
          id: "f1", title: "Feature 1", level: "feature", status: "pending",
          children: [
            {
              id: "t1", title: "Task 1", level: "task", status: "pending",
              children: [
                { id: "s1", title: "Subtask 1", level: "subtask", status: "pending" },
              ],
            },
            { id: "t2", title: "Task 2", level: "task", status: "completed" },
          ],
        },
      ],
    },
    {
      id: "e2", title: "Epic Two", level: "epic", status: "pending",
      children: [
        {
          id: "f2", title: "Feature 2", level: "feature", status: "pending",
          children: [
            { id: "t3", title: "Task 3", level: "task", status: "pending", blockedBy: ["t1"] },
          ],
        },
      ],
    },
  ];
}

describe("cmdRemove", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "rex-remove-test-"));
    mkdirSync(join(tmp, ".rex"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true });
  });

  // ── Epic removal ────────────────────────────────────────────────────

  describe("epic removal", () => {
    it("removes epic and all descendants with --yes", async () => {
      writePRD(tmp, makePrd(fullTree()));

      await cmdRemove(tmp, "e1", "epic", { yes: "true" });

      const prd = readPRD(tmp);
      expect(prd.items.length).toBe(1);
      expect(prd.items[0].id).toBe("e2");
    });

    it("cleans up blockedBy references to deleted items", async () => {
      writePRD(tmp, makePrd(fullTree()));

      await cmdRemove(tmp, "e1", "epic", { yes: "true" });

      const prd = readPRD(tmp);
      const t3 = prd.items[0].children[0].children[0];
      expect(t3.id).toBe("t3");
      // blockedBy should be cleaned (t1 was deleted)
      expect(t3.blockedBy ?? []).toEqual([]);
    });

    it("logs epic_removed event", async () => {
      writePRD(tmp, makePrd(fullTree()));

      await cmdRemove(tmp, "e1", "epic", { yes: "true" });

      const logContent = readFileSync(join(tmp, ".rex", "execution-log.jsonl"), "utf-8");
      const entries = logContent.trim().split("\n").map((l: string) => JSON.parse(l));
      const removeEntry = entries.find((e: { event: string }) => e.event === "epic_removed");
      expect(removeEntry).toBeDefined();
      expect(removeEntry.itemId).toBe("e1");
      expect(removeEntry.detail).toContain("Epic One");
    });

    it("outputs JSON when --format=json", async () => {
      writePRD(tmp, makePrd(fullTree()));

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await cmdRemove(tmp, "e1", "epic", { format: "json", yes: "true" });
      } finally {
        console.log = origLog;
      }

      const output = JSON.parse(logs.join(""));
      expect(output.removed.id).toBe("e1");
      expect(output.removed.level).toBe("epic");
      expect(output.deletedIds).toContain("e1");
      expect(output.deletedIds).toContain("t1");
      expect(output.deletedIds).toContain("s1");
      expect(output.deletedCount).toBeGreaterThan(1);
    });

    it("throws CLIError when item is not an epic", async () => {
      writePRD(tmp, makePrd(fullTree()));

      await expect(
        cmdRemove(tmp, "t1", "epic", { yes: "true" }),
      ).rejects.toThrow(CLIError);
      await expect(
        cmdRemove(tmp, "t1", "epic", { yes: "true" }),
      ).rejects.toThrow(/not an Epic/);
    });
  });

  // ── Task removal ────────────────────────────────────────────────────

  describe("task removal", () => {
    it("removes task and subtasks with --yes", async () => {
      writePRD(tmp, makePrd(fullTree()));

      await cmdRemove(tmp, "t1", "task", { yes: "true" });

      const prd = readPRD(tmp);
      const f1 = prd.items[0].children[0];
      // t1 and s1 removed, only t2 remains
      expect(f1.children.length).toBe(1);
      expect(f1.children[0].id).toBe("t2");
    });

    it("cleans up blockedBy references to deleted task", async () => {
      writePRD(tmp, makePrd(fullTree()));

      await cmdRemove(tmp, "t1", "task", { yes: "true" });

      const prd = readPRD(tmp);
      const t3 = prd.items[1].children[0].children[0];
      expect(t3.id).toBe("t3");
      expect(t3.blockedBy ?? []).toEqual([]);
    });

    it("logs task_removed event", async () => {
      writePRD(tmp, makePrd(fullTree()));

      await cmdRemove(tmp, "t1", "task", { yes: "true" });

      const logContent = readFileSync(join(tmp, ".rex", "execution-log.jsonl"), "utf-8");
      const entries = logContent.trim().split("\n").map((l: string) => JSON.parse(l));
      const removeEntry = entries.find((e: { event: string }) => e.event === "task_removed");
      expect(removeEntry).toBeDefined();
      expect(removeEntry.itemId).toBe("t1");
      expect(removeEntry.detail).toContain("Task 1");
    });

    it("outputs JSON when --format=json", async () => {
      writePRD(tmp, makePrd(fullTree()));

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await cmdRemove(tmp, "t1", "task", { format: "json", yes: "true" });
      } finally {
        console.log = origLog;
      }

      const output = JSON.parse(logs.join(""));
      expect(output.removed.id).toBe("t1");
      expect(output.removed.level).toBe("task");
      expect(output.deletedIds).toContain("t1");
      expect(output.deletedIds).toContain("s1");
      expect(output.deletedCount).toBe(2);
    });

    it("throws CLIError when item is not a task", async () => {
      writePRD(tmp, makePrd(fullTree()));

      await expect(
        cmdRemove(tmp, "e1", "task", { yes: "true" }),
      ).rejects.toThrow(CLIError);
      await expect(
        cmdRemove(tmp, "e1", "task", { yes: "true" }),
      ).rejects.toThrow(/not a Task/);
    });
  });

  // ── Feature removal ──────────────────────────────────────────────────

  describe("feature removal", () => {
    function treeWithEpiclessFeature() {
      return [
        {
          id: "e1", title: "Epic One", level: "epic", status: "pending",
          children: [
            {
              id: "f1", title: "Feature 1", level: "feature", status: "pending",
              children: [
                { id: "t1", title: "Task 1", level: "task", status: "pending" },
              ],
            },
          ],
        },
        {
          id: "f-orphan", title: "Epicless Feature", level: "feature", status: "pending",
          children: [
            { id: "t-orphan", title: "Orphan Task", level: "task", status: "pending" },
            { id: "t-orphan2", title: "Orphan Task 2", level: "task", status: "completed" },
          ],
        },
      ];
    }

    it("removes feature and all descendants with --yes", async () => {
      writePRD(tmp, makePrd(treeWithEpiclessFeature()));

      await cmdRemove(tmp, "f-orphan", "feature", { yes: "true" });

      const prd = readPRD(tmp);
      expect(prd.items.length).toBe(1);
      expect(prd.items[0].id).toBe("e1");
    });

    // The dependent task is placed directly under an epic (no feature in
    // between). The folder-tree serializer drops tasks at depth 2, so the
    // task is no longer visible to readPRD after the cmdRemove save. Skip
    // until the serializer learns to write tasks under epics directly.
    it.skip("cleans up blockedBy references to deleted feature items", async () => {
      const items = [
        {
          id: "f-orphan", title: "Epicless Feature", level: "feature", status: "pending",
          children: [
            { id: "t-orphan", title: "Orphan Task", level: "task", status: "pending" },
          ],
        },
        {
          id: "e1", title: "Epic One", level: "epic", status: "pending",
          children: [
            {
              id: "t-dep", title: "Dependent Task", level: "task", status: "blocked",
              blockedBy: ["t-orphan"],
            },
          ],
        },
      ];
      writePRD(tmp, makePrd(items));

      await cmdRemove(tmp, "f-orphan", "feature", { yes: "true" });

      const prd = readPRD(tmp);
      const tDep = prd.items[0].children[0];
      expect(tDep.id).toBe("t-dep");
      expect(tDep.blockedBy ?? []).toEqual([]);
    });

    it("logs feature_removed event", async () => {
      writePRD(tmp, makePrd(treeWithEpiclessFeature()));

      await cmdRemove(tmp, "f-orphan", "feature", { yes: "true" });

      const logContent = readFileSync(join(tmp, ".rex", "execution-log.jsonl"), "utf-8");
      const entries = logContent.trim().split("\n").map((l: string) => JSON.parse(l));
      const removeEntry = entries.find((e: { event: string }) => e.event === "feature_removed");
      expect(removeEntry).toBeDefined();
      expect(removeEntry.itemId).toBe("f-orphan");
      expect(removeEntry.detail).toContain("Epicless Feature");
    });

    it("outputs JSON with pre-check data when --format=json", async () => {
      writePRD(tmp, makePrd(treeWithEpiclessFeature()));

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await cmdRemove(tmp, "f-orphan", "feature", { format: "json", yes: "true" });
      } finally {
        console.log = origLog;
      }

      const output = JSON.parse(logs.join(""));
      expect(output.removed.id).toBe("f-orphan");
      expect(output.removed.level).toBe("feature");
      expect(output.deletedIds).toContain("f-orphan");
      expect(output.deletedIds).toContain("t-orphan");
      expect(output.deletedIds).toContain("t-orphan2");
      expect(output.deletedCount).toBe(3);
      expect(output.cleanedRefs).toBe(0);
      expect(output.integrityCheck).toBeDefined();
      expect(output.integrityCheck.safe).toBe(true);
    });

    it("includes integrity warnings in JSON output for unsafe deletions", async () => {
      const items = [
        {
          id: "f-orphan", title: "Epicless Feature", level: "feature", status: "pending",
          remoteId: "notion-123",
          children: [
            { id: "t-orphan", title: "Orphan Task", level: "task", status: "pending" },
          ],
        },
        {
          id: "t-ext", title: "External Task", level: "task", status: "blocked",
          blockedBy: ["t-orphan"],
        },
      ];
      writePRD(tmp, makePrd(items));

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await cmdRemove(tmp, "f-orphan", "feature", { format: "json", yes: "true" });
      } finally {
        console.log = origLog;
      }

      const output = JSON.parse(logs.join(""));
      expect(output.integrityCheck.safe).toBe(false);
      expect(output.integrityCheck.externalDependents.length).toBe(1);
      expect(output.integrityCheck.syncedItems.length).toBe(1);
      expect(output.integrityCheck.warnings.length).toBeGreaterThan(0);
    });

    it("throws CLIError when item is not a feature", async () => {
      writePRD(tmp, makePrd(fullTree()));

      await expect(
        cmdRemove(tmp, "e1", "feature", { yes: "true" }),
      ).rejects.toThrow(CLIError);
      await expect(
        cmdRemove(tmp, "e1", "feature", { yes: "true" }),
      ).rejects.toThrow(/not a Feature/);
    });

    it("auto-detects feature level when level is omitted", async () => {
      writePRD(tmp, makePrd(treeWithEpiclessFeature()));

      await cmdRemove(tmp, "f-orphan", undefined, { yes: "true" });

      const prd = readPRD(tmp);
      expect(prd.items.length).toBe(1);
      expect(prd.items[0].id).toBe("e1");
    });
  });

  // ── Auto-detection ──────────────────────────────────────────────────

  describe("auto-detection", () => {
    it("auto-detects epic level when level is omitted", async () => {
      writePRD(tmp, makePrd(fullTree()));

      await cmdRemove(tmp, "e1", undefined, { yes: "true" });

      const prd = readPRD(tmp);
      expect(prd.items.length).toBe(1);
      expect(prd.items[0].id).toBe("e2");
    });

    it("auto-detects task level when level is omitted", async () => {
      writePRD(tmp, makePrd(fullTree()));

      await cmdRemove(tmp, "t1", undefined, { yes: "true" });

      const prd = readPRD(tmp);
      const f1 = prd.items[0].children[0];
      expect(f1.children.length).toBe(1);
      expect(f1.children[0].id).toBe("t2");
    });

    it("throws CLIError for non-removable level (subtask)", async () => {
      writePRD(tmp, makePrd(fullTree()));

      await expect(
        cmdRemove(tmp, "s1", undefined, { yes: "true" }),
      ).rejects.toThrow(CLIError);
      await expect(
        cmdRemove(tmp, "s1", undefined, { yes: "true" }),
      ).rejects.toThrow(/Cannot remove a Subtask/);
    });
  });

  // ── Validation errors ───────────────────────────────────────────────

  describe("validation", () => {
    it("throws CLIError when item not found", async () => {
      writePRD(tmp, makePrd(fullTree()));

      await expect(
        cmdRemove(tmp, "nonexistent", "epic", { yes: "true" }),
      ).rejects.toThrow(CLIError);
      await expect(
        cmdRemove(tmp, "nonexistent", "epic", { yes: "true" }),
      ).rejects.toThrow(/not found/);
    });

    it("throws CLIError when specified level doesn't match item", async () => {
      writePRD(tmp, makePrd(fullTree()));

      // e1 is an epic, but we said task
      await expect(
        cmdRemove(tmp, "e1", "task", { yes: "true" }),
      ).rejects.toThrow(CLIError);

      // t1 is a task, but we said epic
      await expect(
        cmdRemove(tmp, "t1", "epic", { yes: "true" }),
      ).rejects.toThrow(CLIError);
    });
  });

  // ── Parent auto-completion ──────────────────────────────────────────

  describe("parent auto-completion", () => {
    it("auto-completes parent when last pending task is removed", async () => {
      const items = [
        {
          id: "e1", title: "Epic", level: "epic", status: "in_progress",
          children: [
            {
              id: "f1", title: "Feature", level: "feature", status: "in_progress",
              children: [
                { id: "t1", title: "Last pending task", level: "task", status: "pending" },
                { id: "t2", title: "Done task", level: "task", status: "completed" },
              ],
            },
          ],
        },
      ];

      writePRD(tmp, makePrd(items));

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await cmdRemove(tmp, "t1", "task", { format: "json", yes: "true" });
      } finally {
        console.log = origLog;
      }

      const output = JSON.parse(logs.join(""));
      expect(output.autoCompleted.length).toBeGreaterThan(0);

      // Verify that the parent auto-completion was logged
      const logContent = readFileSync(join(tmp, ".rex", "execution-log.jsonl"), "utf-8");
      const entries = logContent.trim().split("\n").map((l: string) => JSON.parse(l));
      const autoEntry = entries.find((e: { event: string }) => e.event === "auto_completed");
      expect(autoEntry).toBeDefined();
    });
  });

  // ── Folder tree persistence ──────────────────────────────────────────

  describe("folder tree persistence", () => {
    it("removes epic folder from tree after epic removal", async () => {
      writePRD(tmp, makePrd(fullTree()));

      await cmdRemove(tmp, "e1", "epic", { yes: "true" });

      const treeRoot = join(tmp, ".rex", PRD_TREE_DIRNAME);
      expect(existsSync(treeRoot)).toBe(true);
      expect(existsSync(join(treeRoot, slugify("Epic One", "e1")))).toBe(false);
      expect(existsSync(join(treeRoot, slugify("Epic Two", "e2")))).toBe(true);
    });

    it("removes task folder from tree after task removal", async () => {
      writePRD(tmp, makePrd(fullTree()));

      await cmdRemove(tmp, "t1", "task", { yes: "true" });

      const treeRoot = join(tmp, ".rex", PRD_TREE_DIRNAME);
      const epicDir = join(treeRoot, slugify("Epic One", "e1"));
      const featureDir = join(epicDir, slugify("Feature 1", "f1"));
      expect(existsSync(join(featureDir, slugify("Task 1", "t1")))).toBe(false);
      expect(existsSync(join(featureDir, slugify("Task 2", "t2")))).toBe(true);
    });

    it("removes feature folder from tree after feature removal", async () => {
      const items = [
        {
          id: "e1", title: "Epic One", level: "epic", status: "pending",
          children: [
            {
              id: "f1", title: "Feature One", level: "feature", status: "pending",
              children: [
                { id: "t1", title: "Task One", level: "task", status: "pending" },
              ],
            },
            {
              id: "f2", title: "Feature Two", level: "feature", status: "pending",
            },
          ],
        },
      ];
      writePRD(tmp, makePrd(items));

      await cmdRemove(tmp, "f1", "feature", { yes: "true" });

      const treeRoot = join(tmp, ".rex", PRD_TREE_DIRNAME);
      const epicDir = join(treeRoot, slugify("Epic One", "e1"));
      expect(existsSync(join(epicDir, slugify("Feature One", "f1")))).toBe(false);
      expect(existsSync(join(epicDir, slugify("Feature Two", "f2")))).toBe(true);
    });
  });
});
