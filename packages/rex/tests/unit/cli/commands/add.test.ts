import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { CLIError } from "../../../../src/cli/errors.js";
import { cmdAdd } from "../../../../src/cli/commands/add.js";

function makePrd(items: unknown[] = []) {
  return JSON.stringify({ schema: "rex/v1", title: "test", items });
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function initRepo(dir: string): void {
  git(dir, "init", "--initial-branch=main");
  git(dir, "config", "user.email", "test@test.com");
  git(dir, "config", "user.name", "Test");
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

  it("stamps branch attribution on created items when git is available", async () => {
    initRepo(tmp);
    git(tmp, "commit", "--allow-empty", "-m", "init");
    git(tmp, "checkout", "-b", "feature/rex-add");

    await cmdAdd(tmp, "epic", { title: "My Epic" });

    const branchFile = readdirSync(join(tmp, ".rex"))
      .find((name) => name.startsWith("prd_feature-rex-add_") && name.endsWith(".json"));
    expect(branchFile).toBeDefined();

    const prd = JSON.parse(readFileSync(join(tmp, ".rex", branchFile!), "utf-8"));
    expect(prd.items[0].branch).toBe("feature/rex-add");
    expect(prd.items[0].sourceFile).toBe(branchFile!.replace(/^/, ".rex/").replace(/\.json$/, ".md"));
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

describe("cmdAdd – flexible hierarchy (tasks under epics)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "rex-add-flex-"));
    mkdirSync(join(tmp, ".rex"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true });
  });

  it("allows adding a task directly under an epic", async () => {
    writeFileSync(
      join(tmp, ".rex", "prd.json"),
      makePrd([{ id: "epic-1", title: "E", level: "epic", status: "pending", children: [] }]),
    );

    await cmdAdd(tmp, "task", { title: "Direct Task", parent: "epic-1", format: "json" });

    const prd = JSON.parse(readFileSync(join(tmp, ".rex", "prd.json"), "utf-8"));
    const epic = prd.items.find((i: { id: string }) => i.id === "epic-1");
    const task = epic.children.find((i: { title: string }) => i.title === "Direct Task");
    expect(task).toBeDefined();
    expect(task.level).toBe("task");
  });

  it("still allows adding a task under a feature", async () => {
    writeFileSync(
      join(tmp, ".rex", "prd.json"),
      makePrd([{
        id: "epic-1", title: "E", level: "epic", status: "pending",
        children: [{ id: "feat-1", title: "F", level: "feature", status: "pending", children: [] }],
      }]),
    );

    await cmdAdd(tmp, "task", { title: "Feature Task", parent: "feat-1", format: "json" });

    const prd = JSON.parse(readFileSync(join(tmp, ".rex", "prd.json"), "utf-8"));
    const feat = prd.items[0].children.find((i: { id: string }) => i.id === "feat-1");
    const task = feat.children.find((i: { title: string }) => i.title === "Feature Task");
    expect(task).toBeDefined();
    expect(task.level).toBe("task");
  });

  it("rejects adding a task under a subtask", async () => {
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
      cmdAdd(tmp, "task", { title: "Bad Task", parent: "sub-1" }),
    ).rejects.toThrow(/must be a child of/);
  });

  it("rejects adding a task without any parent", async () => {
    writeFileSync(join(tmp, ".rex", "prd.json"), makePrd());

    await expect(
      cmdAdd(tmp, "task", { title: "Orphan Task" }),
    ).rejects.toThrow(/requires a parent/);
  });

  it("infers feature (not task) when parent is an epic and no level given", async () => {
    writeFileSync(
      join(tmp, ".rex", "prd.json"),
      makePrd([{ id: "epic-1", title: "E", level: "epic", status: "pending", children: [] }]),
    );

    // Without explicit level, inference still defaults epic→feature
    await cmdAdd(tmp, undefined, { title: "Inferred Feature", parent: "epic-1", format: "json" });

    const prd = JSON.parse(readFileSync(join(tmp, ".rex", "prd.json"), "utf-8"));
    const epic = prd.items.find((i: { id: string }) => i.id === "epic-1");
    const feat = epic.children.find((i: { title: string }) => i.title === "Inferred Feature");
    expect(feat).toBeDefined();
    expect(feat.level).toBe("feature");
  });

  it("feature level remains optional — epics can have both features and tasks", async () => {
    writeFileSync(
      join(tmp, ".rex", "prd.json"),
      makePrd([{ id: "epic-1", title: "E", level: "epic", status: "pending", children: [] }]),
    );

    // Add a feature under the epic
    await cmdAdd(tmp, "feature", { title: "Feature", parent: "epic-1", format: "json" });
    // Add a task directly under the epic
    await cmdAdd(tmp, "task", { title: "Direct Task", parent: "epic-1", format: "json" });

    const prd = JSON.parse(readFileSync(join(tmp, ".rex", "prd.json"), "utf-8"));
    const epic = prd.items.find((i: { id: string }) => i.id === "epic-1");
    expect(epic.children).toHaveLength(2);
    expect(epic.children[0].level).toBe("feature");
    expect(epic.children[1].level).toBe("task");
  });
});

describe("cmdAdd – blockedBy support", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "rex-add-blocked-"));
    mkdirSync(join(tmp, ".rex"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true });
  });

  it("accepts --blockedBy as comma-separated IDs", async () => {
    writeFileSync(
      join(tmp, ".rex", "prd.json"),
      makePrd([
        { id: "t1", title: "Task 1", level: "task", status: "pending" },
        { id: "t2", title: "Task 2", level: "task", status: "pending" },
      ]),
    );

    await cmdAdd(tmp, "epic", { title: "Blocked Epic", blockedBy: "t1,t2", format: "json" });

    const prd = JSON.parse(readFileSync(join(tmp, ".rex", "prd.json"), "utf-8"));
    const item = prd.items.find((i: { title: string }) => i.title === "Blocked Epic");
    expect(item).toBeDefined();
    expect(item.blockedBy).toEqual(["t1", "t2"]);
  });

  it("accepts single blockedBy ID", async () => {
    writeFileSync(
      join(tmp, ".rex", "prd.json"),
      makePrd([
        { id: "t1", title: "Task 1", level: "task", status: "pending" },
      ]),
    );

    await cmdAdd(tmp, "epic", { title: "Blocked Epic", blockedBy: "t1", format: "json" });

    const prd = JSON.parse(readFileSync(join(tmp, ".rex", "prd.json"), "utf-8"));
    const item = prd.items.find((i: { title: string }) => i.title === "Blocked Epic");
    expect(item.blockedBy).toEqual(["t1"]);
  });

  it("rejects blockedBy with nonexistent IDs", async () => {
    writeFileSync(join(tmp, ".rex", "prd.json"), makePrd());

    await expect(
      cmdAdd(tmp, "epic", { title: "Bad Dep", blockedBy: "nonexistent" }),
    ).rejects.toThrow(CLIError);
    await expect(
      cmdAdd(tmp, "epic", { title: "Bad Dep", blockedBy: "nonexistent" }),
    ).rejects.toThrow(/not found|Orphan|unknown/i);
  });

  it("rejects blockedBy that creates a cycle", async () => {
    // t1 blocks t2, trying to add t3 that blocks t1 while t1 blocks t3
    writeFileSync(
      join(tmp, ".rex", "prd.json"),
      makePrd([
        { id: "t1", title: "Task 1", level: "task", status: "pending", blockedBy: ["t2"] },
        { id: "t2", title: "Task 2", level: "task", status: "pending" },
      ]),
    );

    // New item blocked by t1, where t1 is blocked by t2 — no cycle, should succeed
    await cmdAdd(tmp, "epic", { title: "Chained", blockedBy: "t1", format: "json" });

    const prd = JSON.parse(readFileSync(join(tmp, ".rex", "prd.json"), "utf-8"));
    const chained = prd.items.find((i: { title: string }) => i.title === "Chained");
    expect(chained).toBeDefined();
    expect(chained.blockedBy).toEqual(["t1"]);
  });
});
