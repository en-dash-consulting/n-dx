import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { CLIError } from "../../../../src/cli/errors.js";
import { cmdMove } from "../../../../src/cli/commands/move.js";

function makePrd(items: unknown[] = []) {
  return JSON.stringify({ schema: "rex/v1", title: "test", items });
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
    writeFileSync(join(tmp, ".rex", "prd.json"), makePrd(fullTree()));

    await cmdMove(tmp, "f1", { parent: "e2" });

    const prd = JSON.parse(readFileSync(join(tmp, ".rex", "prd.json"), "utf-8"));
    // f1 should be under e2 now
    const e2 = prd.items.find((i: { id: string }) => i.id === "e2");
    expect(e2.children.length).toBe(2);
    expect(e2.children[1].id).toBe("f1");

    // f1 should no longer be under e1
    const e1 = prd.items.find((i: { id: string }) => i.id === "e1");
    expect(e1.children.length).toBe(1);
    expect(e1.children[0].id).toBe("f2");
  });

  it("preserves children when moving", async () => {
    writeFileSync(join(tmp, ".rex", "prd.json"), makePrd(fullTree()));

    await cmdMove(tmp, "f1", { parent: "e2" });

    const prd = JSON.parse(readFileSync(join(tmp, ".rex", "prd.json"), "utf-8"));
    const e2 = prd.items.find((i: { id: string }) => i.id === "e2");
    const movedFeature = e2.children.find((c: { id: string }) => c.id === "f1");
    expect(movedFeature.children.length).toBe(2);
    expect(movedFeature.children[0].id).toBe("t1");
    expect(movedFeature.children[1].id).toBe("t2");
  });

  it("moves task directly under epic", async () => {
    writeFileSync(join(tmp, ".rex", "prd.json"), makePrd(fullTree()));

    await cmdMove(tmp, "t2", { parent: "e2" });

    const prd = JSON.parse(readFileSync(join(tmp, ".rex", "prd.json"), "utf-8"));
    const e2 = prd.items.find((i: { id: string }) => i.id === "e2");
    expect(e2.children.length).toBe(2);
    expect(e2.children[1].id).toBe("t2");
  });

  it("moves subtask to different task", async () => {
    writeFileSync(join(tmp, ".rex", "prd.json"), makePrd(fullTree()));

    await cmdMove(tmp, "s1", { parent: "t2" });

    const prd = JSON.parse(readFileSync(join(tmp, ".rex", "prd.json"), "utf-8"));
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
    writeFileSync(join(tmp, ".rex", "prd.json"), makePrd(fullTree()));

    await expect(
      cmdMove(tmp, "nonexistent", { parent: "e1" }),
    ).rejects.toThrow(CLIError);
    await expect(
      cmdMove(tmp, "nonexistent", { parent: "e1" }),
    ).rejects.toThrow(/not found/);
  });

  it("throws CLIError when parent not found", async () => {
    writeFileSync(join(tmp, ".rex", "prd.json"), makePrd(fullTree()));

    await expect(
      cmdMove(tmp, "f1", { parent: "nonexistent" }),
    ).rejects.toThrow(CLIError);
    await expect(
      cmdMove(tmp, "f1", { parent: "nonexistent" }),
    ).rejects.toThrow(/not found/);
  });

  it("throws CLIError for invalid hierarchy", async () => {
    writeFileSync(join(tmp, ".rex", "prd.json"), makePrd(fullTree()));

    // Subtask under feature is invalid
    await expect(
      cmdMove(tmp, "s1", { parent: "f2" }),
    ).rejects.toThrow(CLIError);
    await expect(
      cmdMove(tmp, "s1", { parent: "f2" }),
    ).rejects.toThrow(/must be a child of/);
  });

  it("throws CLIError for circular move", async () => {
    writeFileSync(join(tmp, ".rex", "prd.json"), makePrd(fullTree()));

    // Moving e1 under its own descendant t1
    await expect(
      cmdMove(tmp, "e1", { parent: "t1" }),
    ).rejects.toThrow(CLIError);
    await expect(
      cmdMove(tmp, "e1", { parent: "t1" }),
    ).rejects.toThrow(/descendant/);
  });

  it("throws CLIError for no-op move", async () => {
    writeFileSync(join(tmp, ".rex", "prd.json"), makePrd(fullTree()));

    await expect(
      cmdMove(tmp, "f1", { parent: "e1" }),
    ).rejects.toThrow(CLIError);
    await expect(
      cmdMove(tmp, "f1", { parent: "e1" }),
    ).rejects.toThrow(/already/);
  });

  it("throws CLIError when feature moved to root", async () => {
    writeFileSync(join(tmp, ".rex", "prd.json"), makePrd(fullTree()));

    // Features can't be root items
    await expect(
      cmdMove(tmp, "f1", {}),
    ).rejects.toThrow(CLIError);
    await expect(
      cmdMove(tmp, "f1", {}),
    ).rejects.toThrow(/cannot be a root/);
  });

  it("logs the move event", async () => {
    writeFileSync(join(tmp, ".rex", "prd.json"), makePrd(fullTree()));

    await cmdMove(tmp, "f1", { parent: "e2" });

    const logContent = readFileSync(join(tmp, ".rex", "execution-log.jsonl"), "utf-8");
    const entries = logContent.trim().split("\n").map((l: string) => JSON.parse(l));
    const moveEntry = entries.find((e: { event: string }) => e.event === "item_moved");
    expect(moveEntry).toBeDefined();
    expect(moveEntry.itemId).toBe("f1");
    expect(moveEntry.detail).toContain("Feature 1");
  });

  it("outputs JSON when --format=json", async () => {
    writeFileSync(join(tmp, ".rex", "prd.json"), makePrd(fullTree()));

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
      writeFileSync(join(tmp, ".rex", "prd.json"), makePrd(fullTree()));

      await cmdMove(tmp, "f1", { parent: "e2" });

      // Tree root should be created
      const treeRoot = join(tmp, ".rex", "tree");
      expect(existsSync(treeRoot)).toBe(true);

      // Epic 1 (id "e1") → slug "epic-1-e1"
      const epic1Dir = join(treeRoot, "epic-1-e1");
      expect(existsSync(epic1Dir)).toBe(true);

      // Epic 2 (id "e2") → slug "epic-2-e2"
      // After move, f1 should be a child of e2
      const epic2Dir = join(treeRoot, "epic-2-e2");
      expect(existsSync(epic2Dir)).toBe(true);

      // Feature 1 (id "f1") should now be under epic-2-e2
      // slug "feature-1-f1"
      const feature1UnderE2 = join(epic2Dir, "feature-1-f1");
      expect(existsSync(feature1UnderE2)).toBe(true);

      // Feature 1 should no longer be under epic-1-e1
      const feature1UnderE1 = join(epic1Dir, "feature-1-f1");
      expect(existsSync(feature1UnderE1)).toBe(false);
    });

    it("updates parent index.md Children section after move", async () => {
      writeFileSync(join(tmp, ".rex", "prd.json"), makePrd(fullTree()));

      await cmdMove(tmp, "f1", { parent: "e2" });

      const treeRoot = join(tmp, ".rex", "tree");

      // e1 index.md should NOT reference feature-1-f1
      const e1Index = join(treeRoot, "epic-1-e1", "index.md");
      const e1Content = readFileSync(e1Index, "utf-8");
      expect(e1Content).not.toContain("feature-1-f1");

      // e2 index.md SHOULD reference feature-1-f1
      const e2Index = join(treeRoot, "epic-2-e2", "index.md");
      const e2Content = readFileSync(e2Index, "utf-8");
      expect(e2Content).toContain("feature-1-f1");
    });
  });
});
