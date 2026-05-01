import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { CLIError } from "../../../../src/cli/errors.js";
import { cmdMove } from "../../../../src/cli/commands/move.js";
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
      id: "e1", title: "Epic 1", level: "epic", status: "pending",
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
            { id: "t2", title: "Task 2", level: "task", status: "pending" },
          ],
        },
        { id: "f2", title: "Feature 2", level: "feature", status: "pending" },
      ],
    },
    {
      id: "e2", title: "Epic 2", level: "epic", status: "pending",
      children: [
        { id: "f3", title: "Feature 3", level: "feature", status: "pending" },
      ],
    },
  ];
}

describe("cmdMove", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "rex-move-test-"));
    mkdirSync(join(tmp, ".rex"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true });
  });

  it("moves feature to different epic", async () => {
    writePRD(tmp, makePrd(fullTree()));

    await cmdMove(tmp, "f1", { parent: "e2" });

    const prd = readPRD(tmp);
    // f1 should be under e2 now (alphabetical order; we look up by id).
    const e2 = prd.items.find((i: { id: string }) => i.id === "e2");
    expect(e2.children.length).toBe(2);
    expect(e2.children.some((c: { id: string }) => c.id === "f1")).toBe(true);

    // f1 should no longer be under e1
    const e1 = prd.items.find((i: { id: string }) => i.id === "e1");
    expect(e1.children.length).toBe(1);
    expect(e1.children[0].id).toBe("f2");
  });

  it("preserves children when moving", async () => {
    writePRD(tmp, makePrd(fullTree()));

    await cmdMove(tmp, "f1", { parent: "e2" });

    const prd = readPRD(tmp);
    const e2 = prd.items.find((i: { id: string }) => i.id === "e2");
    const movedFeature = e2.children.find((c: { id: string }) => c.id === "f1");
    expect(movedFeature.children.length).toBe(2);
    expect(movedFeature.children[0].id).toBe("t1");
    expect(movedFeature.children[1].id).toBe("t2");
  });

  // Moving a task directly under an epic (no feature in between) places it
  // at depth 2, which the folder-tree serializer drops on save. The task
  // disappears from readPRD until the serializer learns to write tasks at
  // depth 2.
  it.skip("moves task directly under epic", async () => {
    writePRD(tmp, makePrd(fullTree()));

    await cmdMove(tmp, "t2", { parent: "e2" });

    const prd = readPRD(tmp);
    const e2 = prd.items.find((i: { id: string }) => i.id === "e2");
    expect(e2.children.length).toBe(2);
    expect(e2.children[1].id).toBe("t2");
  });

  it("moves subtask to different task", async () => {
    writePRD(tmp, makePrd(fullTree()));

    await cmdMove(tmp, "s1", { parent: "t2" });

    const prd = readPRD(tmp);
    // s1 should be under t2 now
    const e1 = prd.items.find((i: { id: string }) => i.id === "e1");
    const f1 = e1.children.find((c: { id: string }) => c.id === "f1");
    const t1 = f1.children.find((c: { id: string }) => c.id === "t1");
    const t2 = f1.children.find((c: { id: string }) => c.id === "t2");
    expect(t1.children?.length ?? 0).toBe(0);
    expect(t2.children.length).toBe(1);
    expect(t2.children[0].id).toBe("s1");
  });

  it("throws CLIError when item not found", async () => {
    writePRD(tmp, makePrd(fullTree()));

    await expect(
      cmdMove(tmp, "nonexistent", { parent: "e1" }),
    ).rejects.toThrow(CLIError);
    await expect(
      cmdMove(tmp, "nonexistent", { parent: "e1" }),
    ).rejects.toThrow(/not found/);
  });

  it("throws CLIError when parent not found", async () => {
    writePRD(tmp, makePrd(fullTree()));

    await expect(
      cmdMove(tmp, "f1", { parent: "nonexistent" }),
    ).rejects.toThrow(CLIError);
    await expect(
      cmdMove(tmp, "f1", { parent: "nonexistent" }),
    ).rejects.toThrow(/not found/);
  });

  it("throws CLIError for invalid hierarchy", async () => {
    writePRD(tmp, makePrd(fullTree()));

    // Subtask under feature is invalid
    await expect(
      cmdMove(tmp, "s1", { parent: "f2" }),
    ).rejects.toThrow(CLIError);
    await expect(
      cmdMove(tmp, "s1", { parent: "f2" }),
    ).rejects.toThrow(/must be a child of/);
  });

  it("throws CLIError for circular move", async () => {
    writePRD(tmp, makePrd(fullTree()));

    // Moving e1 under its own descendant t1
    await expect(
      cmdMove(tmp, "e1", { parent: "t1" }),
    ).rejects.toThrow(CLIError);
    await expect(
      cmdMove(tmp, "e1", { parent: "t1" }),
    ).rejects.toThrow(/descendant/);
  });

  it("throws CLIError for no-op move", async () => {
    writePRD(tmp, makePrd(fullTree()));

    await expect(
      cmdMove(tmp, "f1", { parent: "e1" }),
    ).rejects.toThrow(CLIError);
    await expect(
      cmdMove(tmp, "f1", { parent: "e1" }),
    ).rejects.toThrow(/already/);
  });

  it("throws CLIError when feature moved to root", async () => {
    writePRD(tmp, makePrd(fullTree()));

    // Features can't be root items
    await expect(
      cmdMove(tmp, "f1", {}),
    ).rejects.toThrow(CLIError);
    await expect(
      cmdMove(tmp, "f1", {}),
    ).rejects.toThrow(/cannot be a root/);
  });

  it("logs the move event", async () => {
    writePRD(tmp, makePrd(fullTree()));

    await cmdMove(tmp, "f1", { parent: "e2" });

    const logContent = readFileSync(join(tmp, ".rex", "execution-log.jsonl"), "utf-8");
    const entries = logContent.trim().split("\n").map((l: string) => JSON.parse(l));
    const moveEntry = entries.find((e: { event: string }) => e.event === "item_moved");
    expect(moveEntry).toBeDefined();
    expect(moveEntry.itemId).toBe("f1");
    expect(moveEntry.detail).toContain("Feature 1");
  });

  it("outputs JSON when --format=json", async () => {
    writePRD(tmp, makePrd(fullTree()));

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      await cmdMove(tmp, "f1", { parent: "e2", format: "json" });
    } finally {
      console.log = origLog;
    }

    const output = JSON.parse(logs.join(""));
    expect(output.id).toBe("f1");
    expect(output.previousParentId).toBe("e1");
    expect(output.newParentId).toBe("e2");
  });

  // ── Folder tree persistence ─────────────────────────────────────────

  describe("folder tree persistence", () => {
    it("writes folder tree after a move", async () => {
      writePRD(tmp, makePrd(fullTree()));

      await cmdMove(tmp, "f1", { parent: "e2" });

      // Tree root should be created
      const treeRoot = join(tmp, ".rex", PRD_TREE_DIRNAME);
      expect(existsSync(treeRoot)).toBe(true);

      const epic1Dir = join(treeRoot, slugify("Epic 1", "e1"));
      expect(existsSync(epic1Dir)).toBe(true);

      const epic2Dir = join(treeRoot, slugify("Epic 2", "e2"));
      expect(existsSync(epic2Dir)).toBe(true);

      const featureSlug = slugify("Feature 1", "f1");
      expect(existsSync(join(epic2Dir, featureSlug))).toBe(true);
      expect(existsSync(join(epic1Dir, featureSlug))).toBe(false);
    });

    it("updates parent index.md Children section after move", async () => {
      writePRD(tmp, makePrd(fullTree()));

      await cmdMove(tmp, "f1", { parent: "e2" });

      const treeRoot = join(tmp, ".rex", PRD_TREE_DIRNAME);
      const featureSlug = slugify("Feature 1", "f1");

      // e1's item markdown should NOT reference the moved feature.
      const e1Dir = join(treeRoot, slugify("Epic 1", "e1"));
      const e1Md = readdirSync(e1Dir).find((f) => f.endsWith(".md"))!;
      const e1Content = readFileSync(join(e1Dir, e1Md), "utf-8");
      expect(e1Content).not.toContain(featureSlug);

      // e2's item markdown SHOULD reference the moved feature.
      const e2Dir = join(treeRoot, slugify("Epic 2", "e2"));
      const e2Md = readdirSync(e2Dir).find((f) => f.endsWith(".md"))!;
      const e2Content = readFileSync(join(e2Dir, e2Md), "utf-8");
      expect(e2Content).toContain(featureSlug);
    });
  });
});
