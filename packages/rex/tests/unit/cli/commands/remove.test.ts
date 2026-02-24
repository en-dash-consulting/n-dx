import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { CLIError } from "../../../../src/cli/errors.js";
import { cmdRemove } from "../../../../src/cli/commands/remove.js";

function makePrd(items: unknown[] = []) {
  return JSON.stringify({ schema: "rex/v1", title: "test", items });
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
      writeFileSync(join(tmp, ".rex", "prd.json"), makePrd(fullTree()));

      await cmdRemove(tmp, "e1", "epic", { yes: "true" });

      const prd = JSON.parse(readFileSync(join(tmp, ".rex", "prd.json"), "utf-8"));
      expect(prd.items.length).toBe(1);
      expect(prd.items[0].id).toBe("e2");
    });

    it("cleans up blockedBy references to deleted items", async () => {
      writeFileSync(join(tmp, ".rex", "prd.json"), makePrd(fullTree()));

      await cmdRemove(tmp, "e1", "epic", { yes: "true" });

      const prd = JSON.parse(readFileSync(join(tmp, ".rex", "prd.json"), "utf-8"));
      const t3 = prd.items[0].children[0].children[0];
      expect(t3.id).toBe("t3");
      // blockedBy should be cleaned (t1 was deleted)
      expect(t3.blockedBy ?? []).toEqual([]);
    });

    it("logs epic_removed event", async () => {
      writeFileSync(join(tmp, ".rex", "prd.json"), makePrd(fullTree()));

      await cmdRemove(tmp, "e1", "epic", { yes: "true" });

      const logContent = readFileSync(join(tmp, ".rex", "execution-log.jsonl"), "utf-8");
      const entries = logContent.trim().split("\n").map((l: string) => JSON.parse(l));
      const removeEntry = entries.find((e: { event: string }) => e.event === "epic_removed");
      expect(removeEntry).toBeDefined();
      expect(removeEntry.itemId).toBe("e1");
      expect(removeEntry.detail).toContain("Epic One");
    });

    it("outputs JSON when --format=json", async () => {
      writeFileSync(join(tmp, ".rex", "prd.json"), makePrd(fullTree()));

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
      writeFileSync(join(tmp, ".rex", "prd.json"), makePrd(fullTree()));

      await expect(
        cmdRemove(tmp, "t1", "epic", { yes: "true" }),
      ).rejects.toThrow(CLIError);
      await expect(
        cmdRemove(tmp, "t1", "epic", { yes: "true" }),
      ).rejects.toThrow(/not an epic/);
    });
  });

  // ── Task removal ────────────────────────────────────────────────────

  describe("task removal", () => {
    it("removes task and subtasks with --yes", async () => {
      writeFileSync(join(tmp, ".rex", "prd.json"), makePrd(fullTree()));

      await cmdRemove(tmp, "t1", "task", { yes: "true" });

      const prd = JSON.parse(readFileSync(join(tmp, ".rex", "prd.json"), "utf-8"));
      const f1 = prd.items[0].children[0];
      // t1 and s1 removed, only t2 remains
      expect(f1.children.length).toBe(1);
      expect(f1.children[0].id).toBe("t2");
    });

    it("cleans up blockedBy references to deleted task", async () => {
      writeFileSync(join(tmp, ".rex", "prd.json"), makePrd(fullTree()));

      await cmdRemove(tmp, "t1", "task", { yes: "true" });

      const prd = JSON.parse(readFileSync(join(tmp, ".rex", "prd.json"), "utf-8"));
      const t3 = prd.items[1].children[0].children[0];
      expect(t3.id).toBe("t3");
      expect(t3.blockedBy ?? []).toEqual([]);
    });

    it("logs task_removed event", async () => {
      writeFileSync(join(tmp, ".rex", "prd.json"), makePrd(fullTree()));

      await cmdRemove(tmp, "t1", "task", { yes: "true" });

      const logContent = readFileSync(join(tmp, ".rex", "execution-log.jsonl"), "utf-8");
      const entries = logContent.trim().split("\n").map((l: string) => JSON.parse(l));
      const removeEntry = entries.find((e: { event: string }) => e.event === "task_removed");
      expect(removeEntry).toBeDefined();
      expect(removeEntry.itemId).toBe("t1");
      expect(removeEntry.detail).toContain("Task 1");
    });

    it("outputs JSON when --format=json", async () => {
      writeFileSync(join(tmp, ".rex", "prd.json"), makePrd(fullTree()));

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
      writeFileSync(join(tmp, ".rex", "prd.json"), makePrd(fullTree()));

      await expect(
        cmdRemove(tmp, "e1", "task", { yes: "true" }),
      ).rejects.toThrow(CLIError);
      await expect(
        cmdRemove(tmp, "e1", "task", { yes: "true" }),
      ).rejects.toThrow(/not a task/);
    });
  });

  // ── Auto-detection ──────────────────────────────────────────────────

  describe("auto-detection", () => {
    it("auto-detects epic level when level is omitted", async () => {
      writeFileSync(join(tmp, ".rex", "prd.json"), makePrd(fullTree()));

      await cmdRemove(tmp, "e1", undefined, { yes: "true" });

      const prd = JSON.parse(readFileSync(join(tmp, ".rex", "prd.json"), "utf-8"));
      expect(prd.items.length).toBe(1);
      expect(prd.items[0].id).toBe("e2");
    });

    it("auto-detects task level when level is omitted", async () => {
      writeFileSync(join(tmp, ".rex", "prd.json"), makePrd(fullTree()));

      await cmdRemove(tmp, "t1", undefined, { yes: "true" });

      const prd = JSON.parse(readFileSync(join(tmp, ".rex", "prd.json"), "utf-8"));
      const f1 = prd.items[0].children[0];
      expect(f1.children.length).toBe(1);
      expect(f1.children[0].id).toBe("t2");
    });

    it("throws CLIError for non-removable level (feature)", async () => {
      writeFileSync(join(tmp, ".rex", "prd.json"), makePrd(fullTree()));

      await expect(
        cmdRemove(tmp, "f1", undefined, { yes: "true" }),
      ).rejects.toThrow(CLIError);
      await expect(
        cmdRemove(tmp, "f1", undefined, { yes: "true" }),
      ).rejects.toThrow(/Cannot remove a feature/);
    });

    it("throws CLIError for non-removable level (subtask)", async () => {
      writeFileSync(join(tmp, ".rex", "prd.json"), makePrd(fullTree()));

      await expect(
        cmdRemove(tmp, "s1", undefined, { yes: "true" }),
      ).rejects.toThrow(CLIError);
      await expect(
        cmdRemove(tmp, "s1", undefined, { yes: "true" }),
      ).rejects.toThrow(/Cannot remove a subtask/);
    });
  });

  // ── Validation errors ───────────────────────────────────────────────

  describe("validation", () => {
    it("throws CLIError when item not found", async () => {
      writeFileSync(join(tmp, ".rex", "prd.json"), makePrd(fullTree()));

      await expect(
        cmdRemove(tmp, "nonexistent", "epic", { yes: "true" }),
      ).rejects.toThrow(CLIError);
      await expect(
        cmdRemove(tmp, "nonexistent", "epic", { yes: "true" }),
      ).rejects.toThrow(/not found/);
    });

    it("throws CLIError for invalid removable level", async () => {
      writeFileSync(join(tmp, ".rex", "prd.json"), makePrd(fullTree()));

      await expect(
        cmdRemove(tmp, "f1", "feature", { yes: "true" }),
      ).rejects.toThrow(CLIError);
      await expect(
        cmdRemove(tmp, "f1", "feature", { yes: "true" }),
      ).rejects.toThrow(/Cannot remove a feature/);
    });

    it("throws CLIError when specified level doesn't match item", async () => {
      writeFileSync(join(tmp, ".rex", "prd.json"), makePrd(fullTree()));

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

      writeFileSync(join(tmp, ".rex", "prd.json"), makePrd(items));

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
});
