import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { CLIError } from "../../../../src/cli/errors.js";
import { cmdAdd } from "../../../../src/cli/commands/add.js";

function makePrd(items: unknown[] = []) {
  return JSON.stringify({ schema: "rex/v1", title: "test", items });
}

describe("cmdAdd", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "rex-add-test-"));
    mkdirSync(join(tmp, ".rex"));
    writeFileSync(join(tmp, ".rex", "prd.json"), makePrd());
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true });
  });

  it("throws CLIError for invalid level", async () => {
    await expect(cmdAdd(tmp, "bogus", { title: "test" })).rejects.toThrow(CLIError);
    await expect(cmdAdd(tmp, "bogus", { title: "test" })).rejects.toThrow(/Invalid level/);
  });

  it("includes valid levels in suggestion for invalid level", async () => {
    try {
      await cmdAdd(tmp, "bogus", { title: "test" });
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      expect((err as CLIError).suggestion).toContain("epic");
      expect((err as CLIError).suggestion).toContain("task");
    }
  });

  it("throws CLIError when --title is missing", async () => {
    await expect(cmdAdd(tmp, "epic", {})).rejects.toThrow(CLIError);
    await expect(cmdAdd(tmp, "epic", {})).rejects.toThrow(/Missing required flag/);
  });

  it("throws CLIError when parent is required but missing", async () => {
    await expect(cmdAdd(tmp, "task", { title: "test" })).rejects.toThrow(CLIError);
    await expect(cmdAdd(tmp, "task", { title: "test" })).rejects.toThrow(/requires a parent/);
  });

  it("throws CLIError when parent is not found", async () => {
    await expect(
      cmdAdd(tmp, "task", { title: "test", parent: "nonexistent-id" }),
    ).rejects.toThrow(CLIError);
    await expect(
      cmdAdd(tmp, "task", { title: "test", parent: "nonexistent-id" }),
    ).rejects.toThrow(/not found/);
  });

  it("includes suggestion to check status when parent not found", async () => {
    try {
      await cmdAdd(tmp, "task", { title: "test", parent: "nonexistent-id" });
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      expect((err as CLIError).suggestion).toContain("rex status");
    }
  });

  it("succeeds for valid epic with title", async () => {
    await expect(cmdAdd(tmp, "epic", { title: "My Epic" })).resolves.toBeUndefined();
  });
});

describe("cmdAdd – level inference (no explicit level)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "rex-add-infer-"));
    mkdirSync(join(tmp, ".rex"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true });
  });

  it("defaults to epic when no level and no parent", async () => {
    writeFileSync(join(tmp, ".rex", "prd.json"), makePrd());

    await cmdAdd(tmp, undefined, { title: "My Inferred Epic", format: "json" });

    const prd = JSON.parse(readFileSync(join(tmp, ".rex", "prd.json"), "utf-8"));
    const item = prd.items.find((i: { title: string }) => i.title === "My Inferred Epic");
    expect(item).toBeDefined();
    expect(item.level).toBe("epic");
  });

  it("infers feature when parent is an epic", async () => {
    writeFileSync(
      join(tmp, ".rex", "prd.json"),
      makePrd([{ id: "epic-1", title: "E", level: "epic", status: "pending", children: [] }]),
    );

    await cmdAdd(tmp, undefined, { title: "My Feature", parent: "epic-1", format: "json" });

    const prd = JSON.parse(readFileSync(join(tmp, ".rex", "prd.json"), "utf-8"));
    const epic = prd.items.find((i: { id: string }) => i.id === "epic-1");
    const feat = epic.children.find((i: { title: string }) => i.title === "My Feature");
    expect(feat).toBeDefined();
    expect(feat.level).toBe("feature");
  });

  it("infers task when parent is a feature", async () => {
    writeFileSync(
      join(tmp, ".rex", "prd.json"),
      makePrd([{
        id: "epic-1", title: "E", level: "epic", status: "pending",
        children: [{ id: "feat-1", title: "F", level: "feature", status: "pending", children: [] }],
      }]),
    );

    await cmdAdd(tmp, undefined, { title: "My Task", parent: "feat-1", format: "json" });

    const prd = JSON.parse(readFileSync(join(tmp, ".rex", "prd.json"), "utf-8"));
    const feat = prd.items[0].children.find((i: { id: string }) => i.id === "feat-1");
    const task = feat.children.find((i: { title: string }) => i.title === "My Task");
    expect(task).toBeDefined();
    expect(task.level).toBe("task");
  });

  it("infers subtask when parent is a task", async () => {
    writeFileSync(
      join(tmp, ".rex", "prd.json"),
      makePrd([{
        id: "epic-1", title: "E", level: "epic", status: "pending",
        children: [{
          id: "feat-1", title: "F", level: "feature", status: "pending",
          children: [{ id: "task-1", title: "T", level: "task", status: "pending", children: [] }],
        }],
      }]),
    );

    await cmdAdd(tmp, undefined, { title: "My Subtask", parent: "task-1", format: "json" });

    const prd = JSON.parse(readFileSync(join(tmp, ".rex", "prd.json"), "utf-8"));
    const task = prd.items[0].children[0].children.find((i: { id: string }) => i.id === "task-1");
    const sub = task.children.find((i: { title: string }) => i.title === "My Subtask");
    expect(sub).toBeDefined();
    expect(sub.level).toBe("subtask");
  });

  it("errors when parent not found during inference", async () => {
    writeFileSync(join(tmp, ".rex", "prd.json"), makePrd());

    await expect(
      cmdAdd(tmp, undefined, { title: "Orphan", parent: "nonexistent" }),
    ).rejects.toThrow(/not found/);
  });

  it("errors when parent is a subtask (cannot infer child level)", async () => {
    writeFileSync(
      join(tmp, ".rex", "prd.json"),
      makePrd([{
        id: "epic-1", title: "E", level: "epic", status: "pending",
        children: [{
          id: "feat-1", title: "F", level: "feature", status: "pending",
          children: [{
            id: "task-1", title: "T", level: "task", status: "pending",
            children: [{ id: "sub-1", title: "S", level: "subtask", status: "pending", children: [] }],
          }],
        }],
      }]),
    );

    await expect(
      cmdAdd(tmp, undefined, { title: "Cannot Infer", parent: "sub-1" }),
    ).rejects.toThrow(/Cannot infer child level/);
  });

  it("explicit level overrides inference", async () => {
    writeFileSync(
      join(tmp, ".rex", "prd.json"),
      makePrd([{ id: "epic-1", title: "E", level: "epic", status: "pending", children: [] }]),
    );

    // Pass level explicitly — even though parent is an epic, we say "feature" explicitly
    await cmdAdd(tmp, "feature", { title: "Explicit Feature", parent: "epic-1", format: "json" });

    const prd = JSON.parse(readFileSync(join(tmp, ".rex", "prd.json"), "utf-8"));
    const epic = prd.items.find((i: { id: string }) => i.id === "epic-1");
    const feat = epic.children.find((i: { title: string }) => i.title === "Explicit Feature");
    expect(feat).toBeDefined();
    expect(feat.level).toBe("feature");
  });
});
